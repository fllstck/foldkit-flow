import { Array as Arr, Match, Option, Schema } from "effect";
import { Command, Subscription, Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import * as Flow from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";
import type { FlowNode } from "@fllstck/foldkit-flow";

import "./example.css";
import { exampleSource } from "./source";

/**
 * The example page (M5): a small, real workflow — a release pipeline — rather
 * than the 630-node instrumented playground at `/`.
 *
 * It is written the way the documentation says to write a flow: the graph is the
 * parent's data, the flow is a submodel whose OutMessages are folded back into
 * that data, effects are the Commands `Flow.update` returns, and the renderer is
 * created once at module scope. The source beside it *is* this file.
 */
const PANE_ID = "pipeline-pane";
const QA_ID = "qa";
/** The frame's contents: what "collapse" hides. The frame itself stays drawn —
 *  a container that disappears takes the affordance with it. */
const QA_CHILDREN = ["review", "smoke"] as const;
const QA_BOX = { width: 660, height: 260 } as const;
const QA_COLLAPSED_BOX = { width: 660, height: 96 } as const;

type Status = "ready" | "running" | "failing";

const NodeData = Schema.Struct({
  title: Schema.String,
  subtitle: Schema.String,
  status: Schema.Literals(["ready", "running", "failing"]),
  /** A frame holds other nodes; a step is a leaf the pipeline runs. */
  kind: Schema.Literals(["step", "frame"]),
});
type NodeData = typeof NodeData.Type;

const GraphNode = Schema.Struct({
  id: Schema.String,
  position: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
  data: NodeData,
  parentId: Schema.optionalKey(Schema.String),
  hidden: Schema.optionalKey(Schema.Boolean),
  size: Schema.optionalKey(
    Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  ),
});
type GraphNode = typeof GraphNode.Type;

const GraphEdge = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
  sourceHandle: Schema.optionalKey(Schema.String),
  targetHandle: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
  markerEnd: Schema.optionalKey(Schema.Literals(["Arrow", "ArrowClosed"])),
});
type GraphEdge = typeof GraphEdge.Type;

const step = (
  id: string,
  x: number,
  y: number,
  title: string,
  subtitle: string,
  status: Status,
): GraphNode => ({
  id,
  position: { x, y },
  data: { title, subtitle, status, kind: "step" },
  size: { width: 220, height: 92 },
});

/** The workflow: two stages that can run in parallel, a QA frame with two checks
 *  inside it, then deploy and the path back out. */
type Graph = Readonly<{
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
}>;

const buildGraph = (): Graph => ({
  nodes: [
    step("commit", 250, 0, "Commit", "main · 4f2a", "ready"),
    step("build", 60, 170, "Build", "2m 14s", "running"),
    step("test", 500, 170, "Test", "1 284 checks", "running"),
    {
      id: QA_ID,
      position: { x: 60, y: 340 },
      data: {
        title: "QA",
        subtitle: "2 checks",
        status: "ready",
        kind: "frame",
      },
      size: QA_BOX,
    },
    {
      id: "review",
      position: { x: 20, y: 50 },
      parentId: QA_ID,
      data: {
        title: "Review",
        subtitle: "2 approvals",
        status: "ready",
        kind: "step",
      },
      size: { width: 300, height: 80 },
    },
    {
      id: "smoke",
      position: { x: 340, y: 50 },
      parentId: QA_ID,
      data: {
        title: "Smoke",
        subtitle: "12 suites",
        status: "ready",
        kind: "step",
      },
      size: { width: 300, height: 80 },
    },
    step("deploy", 250, 680, "Deploy", "eu-west-1", "ready"),
    step("rollback", 250, 850, "Rollback", "one click", "failing"),
  ],
  edges: [
    {
      id: "e-build",
      source: "commit",
      target: "build",
      sourceHandle: "out",
      targetHandle: "in",
      label: "push",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-test",
      source: "commit",
      target: "test",
      sourceHandle: "out",
      targetHandle: "in",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-review",
      source: "build",
      target: "review",
      sourceHandle: "out",
      targetHandle: "in",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-smoke",
      source: "test",
      target: "smoke",
      sourceHandle: "out",
      targetHandle: "in",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-ship",
      source: "review",
      target: "deploy",
      sourceHandle: "out",
      targetHandle: "in",
      label: "ship",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-rollback",
      source: "deploy",
      target: "rollback",
      sourceHandle: "out",
      targetHandle: "in",
      label: "on failure",
    },
  ],
});

export const Model = Schema.Struct({
  flow: Flow.Model,
  graph: Schema.Struct({
    nodes: Schema.Array(GraphNode),
    edges: Schema.Array(GraphEdge),
  }),
  /** The last fact the flow reported, written where the panel can read it. */
  lastFact: Schema.String,
  /** The first fit waits for the pane's measured box — it is the one fit that has
   *  to happen without the user asking, so it is folded from `ResizedPane`. */
  isFitted: Schema.Boolean,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
  ClickedToggleQa: {},
  ClickedFitView: {},
});
export type Message = typeof Message.Type;

const toParentMessage = (message: Flow.Message): Message =>
  Message.GotFlowMessage({ message });

/** What `Flow.update` is told about the graph. Rebuilt per dispatch from the
 *  Model, never stored: a copy inside the flow would be the second source of
 *  truth this library exists to avoid (§2.5, `foldkit-constraints`). */
const contextFrom = (model: Model): Flow.Context => ({
  nodes: model.graph.nodes,
  edges: model.graph.edges,
  // A pipeline is a DAG: refuse a release that would create a cycle.
  isValidConnection: (connection) => connection.source !== connection.target,
});

const initial = buildGraph();

export const init = (): Update.Return<Model, Message> => ({
  model: {
    flow: Flow.init({ x: 40, y: 40, zoom: 0.6 }).model,
    graph: initial,
    lastFact: "Nothing yet — drag a node, connect a handle, or resize one.",
    isFitted: false,
  },
});

const replaceNode = (
  nodes: ReadonlyArray<GraphNode>,
  next: GraphNode,
): ReadonlyArray<GraphNode> =>
  nodes.map((node) => (node.id === next.id ? next : node));

const foldFlow = (context: Flow.Context) =>
  Update.foldChild({
    update: (flowModel: Flow.Model, message: Flow.Message) =>
      Flow.update(flowModel, message, context),
    read: (model: Model) => Option.some(model.flow),
    write: (model, flow) => modifyFields(model, { flow: () => flow }),
    toParentMessage,
    // Every fact the flow reports is applied to the parent's own data, and the
    // panel's line is written from the same message: one place, no state copies.
    foldOutMessage: (outMessage: Flow.OutMessage) =>
      Flow.OutMessage.match(outMessage, {
        MovedNodes:
          ({ nodes }) =>
          (model: Model) => ({
            model: {
              ...model,
              lastFact: `Moved ${nodes.map((node) => node.nodeId).join(", ")}`,
              graph: {
                ...model.graph,
                nodes: model.graph.nodes.map((node) => {
                  const moved = nodes.find((entry) => entry.nodeId === node.id);
                  return moved === undefined
                    ? node
                    : {
                        ...node,
                        position: { x: moved.x, y: moved.y },
                      };
                }),
              },
            },
          }),
        ConnectedHandles:
          ({ source, target }) =>
          (model: Model) => {
            const edge: GraphEdge = {
              id: `e-${source.nodeId}-${target.nodeId}-${model.graph.edges.length}`,
              source: source.nodeId,
              target: target.nodeId,
              markerEnd: "ArrowClosed",
            };
            return {
              model: {
                ...model,
                lastFact: `Connected ${source.nodeId} → ${target.nodeId}`,
                graph: { ...model.graph, edges: [...model.graph.edges, edge] },
              },
            };
          },
        ReconnectedEdge:
          ({ edgeId, end, handle }) =>
          (model: Model) => ({
            model: {
              ...model,
              lastFact: `Reconnected the ${end === "Source" ? "start" : "end"} of ${edgeId}`,
              graph: {
                ...model.graph,
                edges: model.graph.edges.map((edge) =>
                  edge.id !== edgeId
                    ? edge
                    : end === "Source"
                      ? { ...edge, source: handle.nodeId }
                      : { ...edge, target: handle.nodeId },
                ),
              },
            },
          }),
        DeletedElements:
          ({ nodeIds, edgeIds }) =>
          (model: Model) => ({
            model: {
              ...model,
              lastFact: `Deleted ${nodeIds.length} nodes and ${edgeIds.length} edges`,
              graph: {
                nodes: model.graph.nodes.filter(
                  (node) => !nodeIds.includes(node.id),
                ),
                edges: model.graph.edges.filter(
                  (edge) => !edgeIds.includes(edge.id),
                ),
              },
            },
          }),
        ResizedNodes:
          ({ nodes }) =>
          (model: Model) => ({
            model: {
              ...model,
              lastFact: `Resized ${nodes.map((node) => node.nodeId).join(", ")}`,
              graph: {
                ...model.graph,
                nodes: nodes.reduce<ReadonlyArray<GraphNode>>((acc, box) => {
                  const node = acc.find((entry) => entry.id === box.nodeId);
                  return node === undefined
                    ? acc
                    : replaceNode(acc, {
                        ...node,
                        position: { x: box.x, y: box.y },
                        size: { width: box.width, height: box.height },
                      });
                }, model.graph.nodes),
              },
            },
          }),
        SelectedElements:
          ({ nodeIds }) =>
          (model: Model) => ({
            model: {
              ...model,
              lastFact: Arr.isReadonlyArrayEmpty(nodeIds)
                ? "Nothing selected"
                : `Selected ${nodeIds.join(", ")}`,
            },
          }),
        ChangedViewport: () => (model: Model) => ({ model }),
      }),
  });

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match(message, {
    GotFlowMessage: ({ message: flowMessage }) => {
      const result = foldFlow(contextFrom(model))(model, flowMessage);
      const commands = result.commands ?? [];

      // The pane's box is only known once it has been measured, so the opening
      // fit is folded from that Message — the same two steps a consumer writes
      // for its own fit button, run once.
      const isResizedPane = Match.value(flowMessage).pipe(
        Match.when({ _tag: "ResizedPane" }, () => true),
        Match.orElse(() => false),
      );
      if (!isResizedPane || result.model.isFitted) {
        return { model: result.model, commands };
      }

      const viewport = Flow.fitViewport(
        result.model.flow,
        result.model.graph.nodes,
        {
          padding: 0.16,
          maxZoom: 1,
        },
      );
      const fitted = Flow.setViewport(result.model.flow, viewport);
      return {
        model: {
          ...result.model,
          flow: fitted.model,
          isFitted: true,
          lastFact: "Fitted the pipeline",
        },
        commands: [
          ...commands,
          ...Command.mapMessages(fitted.commands ?? [], toParentMessage),
        ],
      };
    },
    // The parent owns the collapse: it edits its own node and then tells the flow
    // the graph changed, which prunes the collapsed subtree's measurement. The
    // flow never sees a mutation made behind its back (§2.5.9).
    // Collapsing is the parent editing its own graph: the frame stays, its
    // contents and the edges touching them go, and the frame's box shrinks to a
    // summary band. Then `informGraphChanged` prunes what the flow can no longer
    // see — the flow never sees a mutation made behind its back (§2.5.9).
    ClickedToggleQa: () => {
      const isCollapsed = isQaCollapsed(model);
      const isCheck = (id: string): boolean =>
        QA_CHILDREN.some((child) => child === id);
      const nodes = model.graph.nodes.map((node) => {
        if (isCheck(node.id)) {
          if (!isCollapsed) return { ...node, hidden: true };
          const { hidden: _hidden, ...rest } = node;
          return rest;
        }
        if (node.id !== QA_ID) return node;
        return {
          ...node,
          size: isCollapsed ? QA_BOX : QA_COLLAPSED_BOX,
          data: {
            ...node.data,
            subtitle: isCollapsed ? "2 checks" : "collapsed · 2 hidden",
          },
        };
      });
      const next: Model = {
        ...model,
        graph: { ...model.graph, nodes },
        lastFact: isCollapsed
          ? "Expanded QA"
          : "Collapsed QA — the frame stays, its two checks go",
      };
      return {
        model: modifyFields(next, {
          flow: () =>
            Flow.informGraphChanged(next.flow, contextFrom(next)).model,
        }),
      };
    },
    ClickedFitView: () => {
      const viewport = Flow.fitViewport(model.flow, model.graph.nodes, {
        padding: 0.12,
        maxZoom: 1,
      });
      const fitted = Flow.setViewport(model.flow, viewport);
      return {
        model: { ...model, flow: fitted.model, lastFact: "Fitted the view" },
        commands: Command.mapMessages(fitted.commands ?? [], toParentMessage),
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

const statusClass = (status: Status): string => `ex-node-status ${status}`;

/** A custom node: a title, a detail line, and a status dot. Handles come from
 *  `tools.handle`, so hit-testing, edge anchors and the connection gesture all
 *  read the same measured geometry the rest of the library does. */
const renderNode = (
  node: FlowNode<NodeData>,
  tools: Flow.NodeTools,
  h: HtmlBuilder<Message>,
): Html => {
  const isFrame = node.data.kind === "frame";
  return h.div(
    [h.Class(isFrame ? "ex-node ex-node--frame" : "ex-node")],
    [
      h.div(
        [h.Class("ex-node-head")],
        [
          h.span([h.Class(statusClass(node.data.status))], []),
          h.span([h.Class("ex-node-title")], [node.data.title]),
        ],
      ),
      h.span([h.Class("ex-node-subtitle")], [node.data.subtitle]),
      // Handle positions are geometry the library measures, not styling: the
      // pipeline runs top to bottom, so `in` is on the top edge and `out` on the
      // bottom one, and every edge anchor is that measurement (§2.5.3).
      ...(isFrame
        ? []
        : [
            tools.handle({ id: "in", type: "Target", position: "Top" }),
            tools.handle({ id: "out", type: "Source", position: "Bottom" }),
          ]),
    ],
  );
};

const renderer = Flow.createRenderer<NodeData, unknown>({
  paneId: PANE_ID,
  renderNode,
  background: { variant: "dots" },
  controls: true,
  // The flow draws each node's declared `size` as its box, and the stylesheet's
  // one line makes the consumer's content fill it — the M4 contract, shown here
  // rather than described (M4-FINDINGS §14).
  resize: true,
  snapGrid: { x: 10, y: 10 },
  fitView: { padding: 0.12, maxZoom: 1, duration: 200 },
  accessibleName: (node) => `${node.data.title}, ${node.data.subtitle}`,
});

const isQaCollapsed = (model: Model): boolean =>
  model.graph.nodes.find((node) => node.id === "review")?.hidden === true;

const panel = (model: Model, h: HtmlBuilder<Message>): Html =>
  Flow.panel(
    { position: "BottomLeft", label: "Pipeline actions" },
    panelChildren(model, h),
    h,
  );

const panelChildren = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.span([h.Class("ex-panel-title")], ["Release pipeline"]),
  h.span([h.Class("ex-panel-fact")], [model.lastFact]),
  h.div(
    [h.Class("ex-panel-actions")],
    [
      h.button(
        [h.Class("ex-button"), h.OnClick(Message.ClickedToggleQa())],
        [isQaCollapsed(model) ? "Expand QA" : "Collapse QA"],
      ),
      h.button(
        [h.Class("ex-button"), h.OnClick(Message.ClickedFitView())],
        ["Fit view"],
      ),
    ],
  ),
];

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Foldkit Flow — a release pipeline",
  body: h.main(
    [h.Class("ex-page")],
    [
      h.header(
        [h.Class("ex-header")],
        [
          h.h1([h.Class("ex-title")], ["A release pipeline"]),
          h.p(
            [h.Class("ex-lede")],
            [
              "Drag the boxes, connect a handle to the next stage, resize one, or collapse the QA frame. Every gesture is a Message; every result is your data, changed where you keep it.",
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("ex-split")],
        [
          h.section(
            [h.Class("ex-stage")],
            [
              renderer.view(
                {
                  model: model.flow,
                  nodes: model.graph.nodes,
                  edges: model.graph.edges,
                  toParentMessage,
                  panel: panel(model, h),
                },
                h,
              ),
            ],
          ),
          h.aside(
            [h.Class("ex-source")],
            [
              h.span([h.Class("ex-source-label")], ["app.ts"]),
              h.pre([h.Class("ex-code")], [h.code([], [exampleSource])]),
            ],
          ),
        ],
      ),
    ],
  ),
});
