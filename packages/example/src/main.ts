import { Array as Arr, Option, Schema } from "effect";
import { Command, Subscription, Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import * as Flow from "@fllstck/foldkit-flow";
// The library's own stylesheet: handle boxes are geometry the engine measures,
// so a page without it has 0×0 handles and nothing to hit.
import "@fllstck/foldkit-flow/style.css";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";

const FLOW_PANE_ID = "m2-pane";
const GRID = 25;
/** Column pitch. Wide enough that a node's handles — and the reconnect ring
 *  around an edge end — sit in the gap between neighbours rather than on top of
 *  the next node's handles. */
const COLUMN_PITCH = 220;
const ROW_PITCH = 90;

const GraphNode = Schema.Struct({
  id: Schema.String,
  position: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
  data: Schema.Struct({ label: Schema.String }),
});
type GraphNode = typeof GraphNode.Type;

const GraphEdge = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
  // Optional on purpose: an edge without them anchors on the node's first
  // handle of the type, which is how M1's 624 edges keep working (§2.5.3).
  sourceHandle: Schema.optionalKey(Schema.String),
  targetHandle: Schema.optionalKey(Schema.String),
});
type GraphEdge = typeof GraphEdge.Type;

const Stats = Schema.Struct({
  paneMounts: Schema.Number,
  viewportFrames: Schema.Number,
  syncs: Schema.Number,
  failedMounts: Schema.Number,
  handleMeasurements: Schema.Number,
});
type Stats = typeof Stats.Type;

export const Model = Schema.Struct({
  flow: Flow.Model,
  graph: Schema.Struct({
    nodes: Schema.Array(GraphNode),
    edges: Schema.Array(GraphEdge),
  }),
  label: Schema.String,
  isFlowMounted: Schema.Boolean,
  // Instrumentation for the Playwright proofs: what the parent did with the
  // last connection fact, without the proof having to read the whole graph.
  lastEdge: Schema.String,
  lastReconnect: Schema.String,
  // The connection or reconnect candidate the pointer was last over, as
  // `n0:out > n1:in`. The fixture already connects every neighbour, so a
  // rejected duplicate has to be visible: `isValidConnection` drops it and the
  // library emits nothing, which reads as "connecting is broken".
  lastAttempt: Schema.String,
  stats: Stats,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
  ClickedRerender: {},
  ClickedSyncViewport: {},
  ClickedToggleFlow: {},
  ClickedSelectAll: {},
  ClickedClearSelection: {},
  ClickedZoomIn: {},
  ClickedDeleteSelection: {},
  ClickedRemeasure: {},
});
export type Message = typeof Message.Type;

const initialStats: Stats = {
  paneMounts: 0,
  viewportFrames: 0,
  syncs: 0,
  failedMounts: 0,
  handleMeasurements: 0,
};

/** A workflow-shaped playground: a 25×25 grid, one edge per neighbour. The grid
 *  keeps the M0 measurement and benchmark numbers comparable. */
const buildGraph = (label: string) => {
  const nodes: Array<GraphNode> = [];
  const edges: Array<GraphEdge> = [];

  Arr.range(0, GRID * GRID - 1).forEach((index) => {
    const row = Math.floor(index / GRID);
    const column = index % GRID;
    const id = `n${index}`;
    nodes.push({
      id,
      position: { x: column * COLUMN_PITCH, y: row * ROW_PITCH },
      data: { label: `${label} ${index}` },
    });
    if (index > 0) {
      edges.push({
        id: `e${index}`,
        source: `n${index - 1}`,
        target: id,
        sourceHandle: "out",
        targetHandle: "in",
      });
    }
  });

  return { nodes, edges };
};

export type Init = Readonly<{ model: Model }>;

export const init = (): Init => ({
  model: {
    // Far enough down that the pane's own chrome — the panel at its top-left
    // corner — does not cover the first row of nodes at the initial viewport.
    flow: Flow.init({ x: 20, y: 200, zoom: 0.9 }).model,
    graph: buildGraph("Node"),
    label: "Node",
    isFlowMounted: true,
    lastEdge: "",
    lastReconnect: "",
    lastAttempt: "",
    stats: initialStats,
  },
});

const toParentMessage = (message: Flow.Message): Message =>
  Message.GotFlowMessage({ message });

/** The graph reaches the flow per dispatch and is never stored by it (§2.5.1). */
const contextFrom = (model: Model): Flow.Context => ({
  nodes: model.graph.nodes,
  edges: model.graph.edges,
  isValidConnection: (connection) => isValidConnection(model, connection),
});

/**
 * The parent's policy, asked in `update` before a connection becomes a fact
 * (§7 M2): no self-loops, no duplicates. It judges a reconnect too, and it
 * cannot tell "the edge being moved" apart from any other edge — so dropping an
 * end back onto its own handle is rejected as a duplicate, which leaves the
 * edge exactly as it was.
 */
const isValidConnection = (
  model: Model,
  connection: Flow.Connection,
): boolean => {
  if (connection.source === connection.target) return false;

  return !model.graph.edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? null) === connection.sourceHandle &&
      (edge.targetHandle ?? null) === connection.targetHandle,
  );
};

const countMessage = (stats: Stats, message: Flow.Message): Stats =>
  Flow.Message.match<Stats>(message, {
    MountedPane: () => ({ ...stats, paneMounts: stats.paneMounts + 1 }),
    FailedMountPane: () => ({
      ...stats,
      failedMounts: stats.failedMounts + 1,
    }),
    ResizedPane: () => stats,
    MeasuredNode: () => stats,
    MeasuredHandles: () => ({
      ...stats,
      handleMeasurements: stats.handleMeasurements + 1,
    }),
    MergedHandleBounds: () => stats,
    RemovedNodeMeasurement: () => stats,
    FailedMeasureHandles: () => stats,
    PressedPane: () => stats,
    PressedNode: () => stats,
    MovedPointer: () => stats,
    ReleasedPointer: () => stats,
    CancelledGesture: () => stats,
    PressedDeleteKey: () => stats,
    PressedEscape: () => stats,
    ChangedModifierState: () => stats,
    StartedConnection: () => stats,
    StartedReconnect: () => stats,
    MovedViewport: () => ({
      ...stats,
      viewportFrames: stats.viewportFrames + 1,
    }),
    CompletedSyncViewport: () => ({ ...stats, syncs: stats.syncs + 1 }),
    FailedSyncViewport: () => stats,
    ClickedZoomIn: () => stats,
    ClickedZoomOut: () => stats,
    ClickedFitView: () => stats,
    NudgedNode: () => stats,
    ActivatedNode: () => stats,
  });

const applyPositions = (
  model: Model,
  moved: ReadonlyArray<{ nodeId: string; x: number; y: number }>,
): Model => ({
  ...model,
  graph: {
    ...model.graph,
    nodes: model.graph.nodes.map((node) => {
      const next = moved.find((entry) => entry.nodeId === node.id);
      return next === undefined
        ? node
        : { ...node, position: { x: next.x, y: next.y } };
    }),
  },
});

const nextEdgeId = (edges: ReadonlyArray<GraphEdge>): string =>
  `e-${edges.length + 1}-${edges.reduce((total, edge) => total + edge.id.length, 0)}`;

type EdgeHandles = { sourceHandle?: string; targetHandle?: string };

/** Optional handle ids are omitted rather than set to `undefined`, so the edge
 *  satisfies `exactOptionalPropertyTypes` at the library boundary. */
const handlesOf = (
  sourceHandle: string | undefined,
  targetHandle: string | undefined,
): EdgeHandles => {
  const handles: EdgeHandles = {};
  if (sourceHandle !== undefined) handles.sourceHandle = sourceHandle;
  if (targetHandle !== undefined) handles.targetHandle = targetHandle;
  return handles;
};

const handleIdLabel = (handle: Flow.HandleRef): string =>
  Option.getOrElse(handle.handleId, () => "");

/** The parent owns edge identity (§M2-HANDOFF): the flow reports the connection,
 *  the demo mints the id. Duplicates never reach here — `isValidConnection`
 *  rejected them before `ConnectedHandles` was emitted. */
const addEdge = (
  model: Model,
  source: Flow.HandleRef,
  target: Flow.HandleRef,
): Model => {
  const edge: GraphEdge = {
    id: nextEdgeId(model.graph.edges),
    source: source.nodeId,
    target: target.nodeId,
    ...handlesOf(
      Option.getOrUndefined(source.handleId),
      Option.getOrUndefined(target.handleId),
    ),
  };

  return {
    ...model,
    lastEdge: `${edge.source}:${edge.sourceHandle ?? ""}>${edge.target}:${edge.targetHandle ?? ""}`,
    graph: { ...model.graph, edges: [...model.graph.edges, edge] },
  };
};

/** Reconnect rewrites one end of an existing edge and nothing else. */
const reconnectEdge = (
  model: Model,
  { edgeId, end, handle }: Flow.ReconnectedEdge,
): Model => {
  const handleId = Option.getOrUndefined(handle.handleId);

  return {
    ...model,
    lastReconnect: `${edgeId}:${end}:${handle.nodeId}:${handleIdLabel(handle)}`,
    graph: {
      ...model.graph,
      edges: model.graph.edges.map((edge) =>
        edge.id !== edgeId
          ? edge
          : {
              id: edge.id,
              source: end === "Source" ? handle.nodeId : edge.source,
              target: end === "Target" ? handle.nodeId : edge.target,
              ...handlesOf(
                end === "Source" ? handleId : edge.sourceHandle,
                end === "Target" ? handleId : edge.targetHandle,
              ),
            },
      ),
    },
  };
};

const deleteElements = (
  model: Model,
  nodeIds: ReadonlyArray<string>,
  edgeIds: ReadonlyArray<string>,
): Model => {
  const isDeletedNode = (id: string) => nodeIds.includes(id);
  const isDeletedEdge = (id: string) => edgeIds.includes(id);

  const next: Model = {
    ...model,
    graph: {
      nodes: model.graph.nodes.filter((node) => !isDeletedNode(node.id)),
      edges: model.graph.edges.filter(
        (edge) =>
          !isDeletedEdge(edge.id) &&
          !isDeletedNode(edge.source) &&
          !isDeletedNode(edge.target),
      ),
    },
  };

  // The flow never sees a parent-side removal, so the parent reconciles it in
  // the same step (§2.5.9).
  return modifyFields(next, {
    flow: () => Flow.informGraphChanged(next.flow, contextFrom(next)).model,
  });
};

/** Rebuilt per dispatch: one closure and one config object per Message, and no
 *  stored copy of the graph (§2.5.1). */
const foldFlow = (context: Flow.Context) =>
  Update.foldChild({
    update: (flowModel: Flow.Model, message: Flow.Message) =>
      Flow.update(flowModel, message, context),
    read: (model: Model) => Option.some(model.flow),
    write: (model, flow) => modifyFields(model, { flow: () => flow }),
    toParentMessage,
    foldOutMessage: (outMessage: Flow.OutMessage) =>
      Flow.OutMessage.match(outMessage, {
        MovedNodes:
          ({ nodes }) =>
          (model: Model) => ({ model: applyPositions(model, nodes) }),
        ConnectedHandles:
          ({ source, target }) =>
          (model: Model) => ({ model: addEdge(model, source, target) }),
        ReconnectedEdge: (fact) => (model: Model) => ({
          model: reconnectEdge(model, fact),
        }),
        DeletedElements:
          ({ nodeIds, edgeIds }) =>
          (model: Model) => ({
            model: deleteElements(model, nodeIds, edgeIds),
          }),
        SelectedElements: () => (model: Model) => ({ model }),
        ChangedViewport: () => (model: Model) => ({ model }),
      }),
  });

/** The application root emits no OutMessage: the flow's facts are folded above. */
type UpdateReturn = Update.Return<Model, Message>;

const withFlowCommand = (
  model: Model,
  result: ReturnType<typeof Flow.selectAll>,
): UpdateReturn => ({
  model: { ...model, flow: result.model },
  commands: Command.mapMessages(result.commands ?? [], toParentMessage),
});

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotFlowMessage: ({ message: flowMessage }) => {
      // Armed from the gesture *before* the message is folded, so the indicator
      // shows what the pointer was over while it is over it. A successful
      // connection clears it below, by observing the fact the fold produced:
      // the library emits nothing on a rejected release, so "no new edge" is
      // the only signal there is.
      const attempt = attemptLabel(model.flow.gesture);
      const seeded: Model =
        attempt === "" || attempt === model.lastAttempt
          ? model
          : { ...model, lastAttempt: attempt };

      const result = foldFlow(contextFrom(seeded))(seeded, flowMessage);
      const connected =
        result.model.graph.edges.length !== seeded.graph.edges.length ||
        result.model.lastReconnect !== seeded.lastReconnect;

      const folded: Model = {
        ...result.model,
        stats: countMessage(model.stats, flowMessage),
      };
      // The Model is readonly: a success is a new object, not a mutation.
      const next: Model = connected ? { ...folded, lastAttempt: "" } : folded;

      return { model: next, commands: result.commands ?? [] };
    },
    ClickedRerender: () => ({
      model: modifyFields(
        {
          ...model,
          label: model.label === "Node" ? "Rerendered" : "Node",
        },
        {
          graph: () =>
            buildGraph(model.label === "Node" ? "Rerendered" : "Node"),
        },
      ),
    }),
    ClickedToggleFlow: () => ({
      model: { ...model, isFlowMounted: !model.isFlowMounted },
    }),
    ClickedSyncViewport: () => ({
      model,
      commands: Command.mapMessages(
        [
          Flow.SyncViewport({
            paneId: FLOW_PANE_ID,
            viewport: { x: -200, y: -100, zoom: 1.25 },
            duration: Option.some(120),
          }),
        ],
        toParentMessage,
      ),
    }),
    ClickedSelectAll: () =>
      withFlowCommand(model, Flow.selectAll(model.flow, contextFrom(model))),
    ClickedClearSelection: () =>
      withFlowCommand(model, Flow.clearSelection(model.flow)),
    ClickedZoomIn: () => withFlowCommand(model, Flow.zoomBy(model.flow, 1.2)),
    ClickedRemeasure: () => ({
      model,
      commands: Command.mapMessages(
        [
          // §2.5.3: the answer to a stylesheet-only layout change. Same
          // `MeasureHandles` Command under a public name, so it inherits
          // merge-and-prune semantics.
          Flow.Remeasure(
            FLOW_PANE_ID,
            model.graph.nodes.map((node) => node.id),
          ),
        ],
        toParentMessage,
      ),
    }),
    ClickedDeleteSelection: () => {
      const selectedNodeIds = model.flow.selectedNodeIds;
      const selectedEdgeIds = model.flow.selectedEdgeIds;
      const next: Model = {
        ...model,
        flow: Flow.clearSelection(model.flow).model,
      };
      return {
        model: deleteElements(next, selectedNodeIds, selectedEdgeIds),
      };
    },
  });

export const subscriptions = Subscription.lift(Flow.subscriptions)<
  Model,
  Message
>({
  read: (model) => Option.some(model.flow),
  toParentMessage,
});

/** The handle the pointer is currently over during a connection or reconnect.
 *  Instrumentation for the proofs: a rejected connection has to be shown to have
 *  had a target, not just to have produced no edge. */
const hoveredHandle = (
  gesture: Flow.ModelType["gesture"],
): Option.Option<Flow.HandleRef> =>
  Flow.Gesture.guards.Connecting(gesture)
    ? gesture.maybeTarget
    : Flow.Gesture.guards.Reconnecting(gesture)
      ? gesture.maybeTarget
      : Option.none();

const gestureTarget = (gesture: Flow.ModelType["gesture"]): string =>
  Option.getOrElse(
    Option.map(
      hoveredHandle(gesture),
      (handle) =>
        `${handle.nodeId}:${Option.getOrElse(handle.handleId, () => "")}`,
    ),
    () => "",
  );

/** The hovered connection candidate as `from > to`, or `""` when the pointer is
 *  not over a handle. Read from the gesture, so it needs no Model state of its
 *  own — only the demo's "what did I just try" indicator. */
const attemptLabel = (gesture: Flow.ModelType["gesture"]): string => {
  const target = hoveredHandle(gesture);
  if (Option.isNone(target)) return "";

  const handleLabel = (handle: Flow.HandleRef): string =>
    `${handle.nodeId}:${Option.getOrElse(handle.handleId, () => "")}`;
  const to = handleLabel(target.value);

  if (Flow.Gesture.guards.Connecting(gesture)) {
    return `${handleLabel(gesture.from)} > ${to}`;
  }
  if (Flow.Gesture.guards.Reconnecting(gesture)) {
    return `${gesture.edgeId}:${gesture.end} > ${to}`;
  }
  return "";
};

const nodesOf = (model: Model): ReadonlyArray<FlowNode<{ label: string }>> =>
  model.graph.nodes;

const edgesOf = (model: Model): ReadonlyArray<FlowEdge> => model.graph.edges;

const renderNode = (
  node: FlowNode<{ label: string }>,
  tools: Flow.NodeTools,
  h: HtmlBuilder<any>,
): Html =>
  h.div(
    [h.Class("node-shell")],
    [
      h.span([h.Class("node-label")], [node.data.label]),
      // Three things a real node contains, each with a different relationship to
      // the flow's keyboard and pointer layers: a scroll region that must not
      // zoom, a focusable no-key region that must not nudge, and a text input
      // that must not nudge either (§7 M3).
      h.div([h.Class("fflow__nowheel fflow__nokey"), h.Tabindex(0)], []),
      h.input([
        h.Class("node-input fflow__nokey"),
        h.Type("text"),
        h.AriaLabel(`Note for ${node.data.label}`),
        h.Placeholder("note"),
      ]),
      tools.handle({ id: "in", type: "Target", position: "Left" }),
      tools.handle({ id: "out", type: "Source", position: "Right" }),
    ],
  );

/** Unculled on purpose: the demo's readiness proof counts 625 measured nodes, so
 *  every node must render at least once. Culling is exercised by the benchmark's
 *  `/large.html`, which is client-only and therefore cannot skew hydration. */
const renderer = Flow.createRenderer<{ label: string }, unknown>({
  paneId: FLOW_PANE_ID,
  renderNode,
  // The demo folds `ReconnectedEdge`, so it opts into the grab rings.
  reconnect: true,
  // Chrome (§7 M3). The reason a screen reader gets a name instead of "div".
  background: { variant: "dots" },
  controls: true,
  minimap: true,
  accessibleName: (node) => node.data.label,
});

/** Consumer chrome inside the pane, composed with the library's own positioned
 *  container. Its button dispatches a *parent* Message: the panel's markup is
 *  built in the parent's boundary, which is the whole point of threading it
 *  through `ViewInput.panel` rather than through the renderer's config. */
const demoPanel = (h: HtmlBuilder<Message>) =>
  Flow.panel(
    { position: "TopRight", label: "Graph actions" },
    [
      h.span([h.Class("panel-title")], ["Graph"]),
      h.button(
        [h.Id("panel-select-all"), h.OnClick(Message.ClickedSelectAll())],
        ["Select all"],
      ),
    ],
    h,
  );

const stat = (h: HtmlBuilder<Message>, key: string, value: number | string) =>
  h.span(
    [h.DataAttribute("stat", key), h.Class("stat")],
    [
      h.span([h.Class("stat-key")], [`${key}: `]),
      h.span(
        [h.DataAttribute("stat-value", key), h.Class("stat-value")],
        [String(value)],
      ),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const flow = model.flow;

  return {
    title: "Foldkit Flow — M2",
    body: h.main(
      [
        h.Class("app"),
        h.DataAttribute("label", model.label),
        h.DataAttribute(
          "viewport",
          `${flow.viewport.x},${flow.viewport.y},${flow.viewport.zoom}`,
        ),
        h.DataAttribute("measured-nodes", String(flow.nodeSizes.length)),
        h.DataAttribute("handle-nodes", String(flow.handleBounds.length)),
        h.DataAttribute("pane-mounts", String(model.stats.paneMounts)),
        h.DataAttribute("viewport-frames", String(model.stats.viewportFrames)),
        h.DataAttribute("syncs", String(model.stats.syncs)),
        h.DataAttribute("failed-mounts", String(model.stats.failedMounts)),
        h.DataAttribute(
          "handle-measurements",
          String(model.stats.handleMeasurements),
        ),
        h.DataAttribute("nodes", String(model.graph.nodes.length)),
        h.DataAttribute("edges", String(model.graph.edges.length)),
        h.DataAttribute("last-edge", model.lastEdge),
        h.DataAttribute("last-reconnect", model.lastReconnect),
        h.DataAttribute("last-attempt", model.lastAttempt),
        h.DataAttribute("connection-target", gestureTarget(flow.gesture)),
        h.DataAttribute("selected-nodes", flow.selectedNodeIds.join(",")),
        h.DataAttribute("selected-edges", flow.selectedEdgeIds.join(",")),
        h.DataAttribute("gesture", flow.gesture._tag),
        h.DataAttribute("additive", String(flow.isAdditiveModifier)),
      ],
      [
        h.header(
          [h.Class("toolbar")],
          [
            h.h1([h.Class("title")], [`Foldkit Flow — M2 — ${model.label}`]),
            h.div(
              [h.Class("stats")],
              [
                stat(h, "measured-nodes", flow.nodeSizes.length),
                stat(h, "handle-nodes", flow.handleBounds.length),
                stat(h, "pane-mounts", model.stats.paneMounts),
                stat(h, "viewport-frames", model.stats.viewportFrames),
                stat(h, "syncs", model.stats.syncs),
                stat(h, "selected", flow.selectedNodeIds.length),
                stat(h, "edges", model.graph.edges.length),
                stat(
                  h,
                  "attempt",
                  model.lastAttempt === "" ? "—" : model.lastAttempt,
                ),
                // No `renderer.cacheSize()` here on purpose: it reads mutable
                // renderer state during `view`, so the dev server's reused SSR
                // renderer renders a populated count while the client's first
                // view renders 0. That is a hydration mismatch on every load
                // (Foldkit reconciles it and warns). The cache size is a
                // diagnostic — read it from a test or from devtools.
              ],
            ),
            h.div(
              [h.Class("buttons")],
              [
                h.button(
                  [h.Id("rerender"), h.OnClick(Message.ClickedRerender())],
                  ["Re-render"],
                ),
                h.button(
                  [
                    h.Id("sync-viewport"),
                    h.OnClick(Message.ClickedSyncViewport()),
                  ],
                  ["Sync viewport"],
                ),
                h.button(
                  [h.Id("toggle-flow"), h.OnClick(Message.ClickedToggleFlow())],
                  [model.isFlowMounted ? "Unmount flow" : "Mount flow"],
                ),
                h.button(
                  [h.Id("select-all"), h.OnClick(Message.ClickedSelectAll())],
                  ["Select all"],
                ),
                h.button(
                  [
                    h.Id("clear-selection"),
                    h.OnClick(Message.ClickedClearSelection()),
                  ],
                  ["Clear selection"],
                ),
                h.button(
                  [h.Id("zoom-in"), h.OnClick(Message.ClickedZoomIn())],
                  ["Zoom in"],
                ),
                h.button(
                  [
                    h.Id("delete-selection"),
                    h.OnClick(Message.ClickedDeleteSelection()),
                  ],
                  ["Delete selection"],
                ),
                h.button(
                  [h.Id("remeasure"), h.OnClick(Message.ClickedRemeasure())],
                  ["Remeasure"],
                ),
              ],
            ),
          ],
        ),
        h.div(
          [
            h.Id("flow-container"),
            h.Style({ width: "900px", height: "600px" }),
          ],
          [
            model.isFlowMounted
              ? renderer.view(
                  {
                    model: flow,
                    nodes: nodesOf(model),
                    edges: edgesOf(model),
                    toParentMessage,
                    // Consumer chrome inside the pane (§7 M3): built in this
                    // boundary, so its button dispatches a parent Message.
                    panel: demoPanel(h),
                  },
                  h,
                )
              : h.p([h.Class("placeholder")], ["Flow unmounted"]),
          ],
        ),
      ],
    ),
  };
};
