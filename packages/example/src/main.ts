import { Array as Arr, Option, Schema } from "effect";
import { Command, Subscription, Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";

const FLOW_PANE_ID = "m1-pane";
const GRID = 25;

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
      position: { x: column * 190, y: row * 90 },
      data: { label: `${label} ${index}` },
    });
    if (index > 0) {
      edges.push({ id: `e${index}`, source: `n${index - 1}`, target: id });
    }
  });

  return { nodes, edges };
};

export type Init = Readonly<{ model: Model }>;

export const init = (): Init => ({
  model: {
    flow: Flow.init({ x: 20, y: 30, zoom: 0.9 }).model,
    graph: buildGraph("Node"),
    label: "Node",
    isFlowMounted: true,
    stats: initialStats,
  },
});

const toParentMessage = (message: Flow.Message): Message =>
  Message.GotFlowMessage({ message });

/** The graph reaches the flow per dispatch and is never stored by it (§2.5.1). */
const contextFrom = (model: Model): Flow.Context => ({
  nodes: model.graph.nodes,
  edges: model.graph.edges,
});

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
    StartedConnection: () => stats,
    HoveredHandle: () => stats,
    MovedViewport: () => ({
      ...stats,
      viewportFrames: stats.viewportFrames + 1,
    }),
    CompletedSyncViewport: () => ({ ...stats, syncs: stats.syncs + 1 }),
    FailedSyncViewport: () => stats,
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

const addEdge = (
  model: Model,
  source: Flow.HandleRef,
  target: Flow.HandleRef,
): Model => {
  const isDuplicate = model.graph.edges.some(
    (edge) => edge.source === source.nodeId && edge.target === target.nodeId,
  );
  if (isDuplicate) return model;

  return {
    ...model,
    graph: {
      ...model.graph,
      edges: [
        ...model.graph.edges,
        {
          id: nextEdgeId(model.graph.edges),
          source: source.nodeId,
          target: target.nodeId,
        },
      ],
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
      const result = foldFlow(contextFrom(model))(model, flowMessage);
      return {
        model: {
          ...result.model,
          stats: countMessage(model.stats, flowMessage),
        },
        commands: result.commands ?? [],
      };
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
      h.div([h.Class("fflow__nowheel")], ["no zoom"]),
      tools.handle({ id: "in", type: "Target", position: "Left" }),
      tools.handle({ id: "out", type: "Source", position: "Right" }),
    ],
  );

const renderer = Flow.createRenderer<{ label: string }, unknown>({
  paneId: FLOW_PANE_ID,
  renderNode,
});

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
    title: "Foldkit Flow — M1",
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
        h.DataAttribute("selected-nodes", flow.selectedNodeIds.join(",")),
        h.DataAttribute("selected-edges", flow.selectedEdgeIds.join(",")),
        h.DataAttribute("gesture", flow.gesture._tag),
      ],
      [
        h.header(
          [h.Class("toolbar")],
          [
            h.h1([h.Class("title")], [`Foldkit Flow — M1 — ${model.label}`]),
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
                stat(h, "cache", renderer.cacheSize()),
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
