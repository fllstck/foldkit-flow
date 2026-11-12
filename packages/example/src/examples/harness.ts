import { Array as Arr, Match, Option, Schema } from "effect";
import { Command, Subscription, Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import * as Flow from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";
import type { FlowNode } from "@fllstck/foldkit-flow";

import "./examples.css";
import type { ExampleNode, ExampleSpec, FactSummary } from "./spec";

/**
 * The Foldkit app every example page runs.
 *
 * This file is the *wiring* — the part that is identical for every example and
 * that a reader should learn once — and `specs/*.ts` is the part that changes. The
 * page shows both, side by side, from their own source (`?raw`), so the example on
 * the left and the file on the right cannot drift apart.
 */
const PANE_ID = "example-pane";

const NodeData = Schema.Struct({
  title: Schema.String,
  subtitle: Schema.String,
  status: Schema.String,
});
type NodeData = typeof NodeData.Type;

/** The edge shape these examples own. Written out rather than imported because
 *  the Model is a concrete Schema and this is the only place the example needs
 *  one — the library's `FlowEdge` type is the contract, not a schema. */
const EdgeData = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
  type: Schema.optionalKey(
    Schema.Literals(["Bezier", "Straight", "Step", "SmoothStep"]),
  ),
  label: Schema.optionalKey(Schema.String),
  markerEnd: Schema.optionalKey(Schema.Literals(["Arrow", "ArrowClosed"])),
});

const GraphNode = Schema.Struct({
  id: Schema.String,
  position: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
  data: NodeData,
  size: Schema.optionalKey(
    Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  ),
  parentId: Schema.optionalKey(Schema.String),
  hidden: Schema.optionalKey(Schema.Boolean),
});

type GraphNodeType = typeof GraphNode.Type;
type GraphEdge = typeof EdgeData.Type;

/** Optional fields are assigned after construction rather than spread from a
 *  `{}`: an absent key and a key set to `undefined` are different things under
 *  `exactOptionalPropertyTypes`, and only the first one means "not set". */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const Model = Schema.Struct({
  flow: Flow.Model,
  graph: Schema.Struct({
    nodes: Schema.Array(GraphNode),
    edges: Schema.Array(EdgeData),
  }),
  lastFact: Schema.String,
  isFitted: Schema.Boolean,
});
type Model = typeof Model.Type;

const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
  ClickedFit: {},
  ClickedToggleCollapse: {},
});
export type ExampleMessage = typeof Message.Type;
type Message = ExampleMessage;

/** What `createExampleApp` hands the route: one Foldkit application, typed once
 *  for every example. */
export type ExampleApp = Readonly<{
  renderNode: (
    node: FlowNode<NodeData>,
    tools: Flow.NodeTools,
    h: HtmlBuilder<Message>,
  ) => Html;
  Model: typeof Model;
  Message: typeof Message;
  init: () => Update.Return<Model, Message>;
  update: (model: Model, message: Message) => Update.Return<Model, Message>;
  view: (model: Model, h: HtmlBuilder<Message>) => Document;
  subscriptions: ReturnType<typeof Subscription.lift<never>>;
}>;

export type ExampleSources = Readonly<{
  /** The spec file: the graph and the policy. */
  spec: string;
  /** This file: the wiring, identical for every example. */
  harness: string;
  /** The stylesheet the example's markup uses. */
  css: string;
}>;

const toFlowNode = (node: ExampleNode): GraphNodeType => {
  const mapped: Mutable<GraphNodeType> = {
    id: node.id,
    position: { x: node.x, y: node.y },
    size: { width: node.width, height: node.height },
    data: {
      title: node.title,
      subtitle: node.subtitle ?? "",
      status: node.status ?? "ready",
    },
  };
  if (node.parentId !== undefined) mapped.parentId = node.parentId;
  if (node.hidden === true) mapped.hidden = true;
  return mapped;
};

const toFlowEdge = (edge: ExampleSpec["edges"][number]): GraphEdge => {
  const mapped: Mutable<GraphEdge> = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
  };
  if (edge.kind !== undefined) mapped.type = edge.kind;
  if (edge.label !== undefined) mapped.label = edge.label;
  if (edge.markerEnd !== undefined) mapped.markerEnd = edge.markerEnd;
  return mapped;
};

const defaultDescribe = (fact: FactSummary): string =>
  Match.value(fact.kind).pipe(
    Match.when("move", () => `Moved ${fact.detail}`),
    Match.when("connect", () => `Connected ${fact.detail}`),
    Match.when("reconnect", () => `Reconnected ${fact.detail}`),
    Match.when("delete", () => `Deleted ${fact.detail}`),
    Match.when("resize", () => `Resized ${fact.detail}`),
    Match.orElse(() => fact.detail),
  );

/**
 * One example, as a Foldkit application.
 *
 * The Model is the spec's graph plus the last fact; every OutMessage the flow
 * reports is folded back into that graph in one place, which is the pattern the
 * docs describe and the one this page demonstrates.
 */
export const createExampleApp = (
  spec: ExampleSpec,
  sources: ExampleSources,
): ExampleApp => {
  const baseNodes: ReadonlyArray<GraphNodeType> = spec.nodes.map(toFlowNode);
  const baseEdges: ReadonlyArray<GraphEdge> = spec.edges.map(toFlowEdge);

  const toParentMessage = (message: Flow.Message): Message =>
    Message.GotFlowMessage({ message });

  const describe = spec.describeFact ?? defaultDescribe;

  const contextFrom = (model: Model): Flow.Context => {
    const context: Mutable<Flow.Context> = {
      nodes: model.graph.nodes,
      edges: model.graph.edges,
    };
    // The policy travels with the graph rather than living in the flow: a rejected
    // release emits nothing, so this is the only place it can be decided.
    if (spec.isValidConnection !== undefined) {
      context.isValidConnection = spec.isValidConnection;
    }
    return context;
  };

  const init = (): Update.Return<Model, Message> => ({
    model: {
      flow: Flow.init(
        spec.viewport === "fit" ? { x: 0, y: 0, zoom: 1 } : spec.viewport,
      ).model,
      graph: { nodes: baseNodes, edges: baseEdges },
      lastFact: "Nothing yet — drag a node, connect a handle, resize one.",
      isFitted: false,
    },
  });

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
            (model: Model) => ({
              model: {
                ...model,
                lastFact: describe({
                  kind: "move",
                  detail: nodes.map((node) => node.nodeId).join(", "),
                }),
                graph: {
                  ...model.graph,
                  nodes: model.graph.nodes.map((node) => {
                    const moved = nodes.find(
                      (entry) => entry.nodeId === node.id,
                    );
                    return moved === undefined
                      ? node
                      : { ...node, position: { x: moved.x, y: moved.y } };
                  }),
                },
              },
            }),
          ConnectedHandles:
            ({ source, target }) =>
            (model: Model) => ({
              model: {
                ...model,
                lastFact: describe({
                  kind: "connect",
                  detail: `${source.nodeId} → ${target.nodeId}`,
                }),
                graph: {
                  ...model.graph,
                  edges: [
                    ...model.graph.edges,
                    {
                      id: `e-${source.nodeId}-${target.nodeId}-${model.graph.edges.length}`,
                      source: source.nodeId,
                      target: target.nodeId,
                      markerEnd: "ArrowClosed" as const,
                    },
                  ],
                },
              },
            }),
          ReconnectedEdge:
            ({ edgeId, end, handle }) =>
            (model: Model) => ({
              model: {
                ...model,
                lastFact: describe({
                  kind: "reconnect",
                  detail: `${edgeId} (${end === "Source" ? "start" : "end"}) → ${handle.nodeId}`,
                }),
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
                lastFact: describe({
                  kind: "delete",
                  detail: `${nodeIds.length} nodes, ${edgeIds.length} edges`,
                }),
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
                lastFact: describe({
                  kind: "resize",
                  detail: nodes.map((node) => node.nodeId).join(", "),
                }),
                graph: {
                  ...model.graph,
                  nodes: model.graph.nodes.map((node) => {
                    const box = nodes.find((entry) => entry.nodeId === node.id);
                    return box === undefined
                      ? node
                      : {
                          ...node,
                          position: { x: box.x, y: box.y },
                          size: { width: box.width, height: box.height },
                        };
                  }),
                },
              },
            }),
          SelectedElements:
            ({ nodeIds }) =>
            (model: Model) => ({
              model: {
                ...model,
                lastFact: describe({
                  kind: "select",
                  detail: Arr.isReadonlyArrayEmpty(nodeIds)
                    ? "Nothing selected"
                    : `Selected ${nodeIds.join(", ")}`,
                }),
              },
            }),
          ChangedViewport: () => (model: Model) => ({ model }),
        }),
    });

  const collapseIds = spec.controls?.collapseIds ?? [];

  const update = (
    model: Model,
    message: Message,
  ): Update.Return<Model, Message> =>
    Message.match(message, {
      GotFlowMessage: ({ message: flowMessage }) => {
        const result = foldFlow(contextFrom(model))(model, flowMessage);
        const commands = result.commands ?? [];

        // The opening fit waits for the pane's measured box — the documented
        // pattern, and the reason `MountedPane` precedes the first `ResizedPane`.
        const isResizedPane = Match.value(flowMessage).pipe(
          Match.when({ _tag: "ResizedPane" }, () => true),
          Match.orElse(() => false),
        );
        if (
          spec.viewport !== "fit" ||
          !isResizedPane ||
          result.model.isFitted
        ) {
          return { model: result.model, commands };
        }

        const viewport = Flow.fitViewport(
          result.model.flow,
          result.model.graph.nodes,
          {
            padding: spec.padding ?? 0.14,
            maxZoom: 1,
          },
        );
        const fitted = Flow.setViewport(result.model.flow, viewport);
        return {
          model: { ...result.model, flow: fitted.model, isFitted: true },
          commands: [
            ...commands,
            ...Command.mapMessages(fitted.commands ?? [], toParentMessage),
          ],
        };
      },
      ClickedFit: () => {
        const viewport = Flow.fitViewport(model.flow, model.graph.nodes, {
          padding: spec.padding ?? 0.14,
          maxZoom: 1,
        });
        const fitted = Flow.setViewport(model.flow, viewport);
        return {
          model: {
            ...model,
            flow: fitted.model,
            lastFact: describe({ kind: "viewport", detail: "Fitted the view" }),
          },
          commands: Command.mapMessages(fitted.commands ?? [], toParentMessage),
        };
      },
      // Collapsing is the parent's edit: flip `hidden` on the ids the spec names,
      // then tell the flow the graph changed so the collapsed measurement is
      // pruned (§2.5.9). The flow never sees a mutation made behind its back.
      ClickedToggleCollapse: () => {
        const isCollapsed = model.graph.nodes.some(
          (node) => collapseIds.includes(node.id) && node.hidden === true,
        );
        const nodes = model.graph.nodes.map((node) => {
          if (!collapseIds.includes(node.id)) return node;
          if (isCollapsed) {
            const { hidden: _hidden, ...rest } = node;
            return rest;
          }
          return { ...node, hidden: true };
        });
        const next: Model = {
          ...model,
          graph: { ...model.graph, nodes },
          lastFact: isCollapsed ? "Expanded" : "Collapsed",
        };
        return {
          model: modifyFields(next, {
            flow: () =>
              Flow.informGraphChanged(next.flow, contextFrom(next)).model,
          }),
        };
      },
    });

  const subscriptions = Subscription.lift(Flow.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.flow),
    toParentMessage,
  });

  const defaultRenderNode = (
    node: FlowNode<NodeData>,
    tools: Flow.NodeTools,
    h: HtmlBuilder<Message>,
  ): Html =>
    h.div(
      [h.Class("ex2-node")],
      [
        h.div(
          [h.Class("ex2-node-head")],
          [
            h.span([h.Class(`ex2-node-status ${node.data.status}`)], []),
            h.span([h.Class("ex2-node-title")], [node.data.title]),
          ],
        ),
        h.span([h.Class("ex2-node-subtitle")], [node.data.subtitle]),
        // Handles are measured geometry, not markup the flow guesses at.
        tools.handle({ id: "in", type: "Target", position: "Top" }),
        tools.handle({ id: "out", type: "Source", position: "Bottom" }),
      ],
    );

  // A spec may supply its own markup. The cast is between two functions with the
  // same signature reached through different modules — `ExampleNodeData` in
  // `spec.ts` is this file's `NodeData` — so nothing about the call is unchecked.
  // SAFETY: `ExampleNodeData` is declared as `NodeData`'s structural twin, and the
  // flow passes the same two arguments to either function.
  const renderNode: ExampleApp["renderNode"] =
    spec.renderNode ?? (defaultRenderNode as ExampleApp["renderNode"]);
  const rendererOptions = spec.renderer ?? {};
  const rendererConfig: Mutable<Flow.RendererConfig<NodeData, unknown>> = {
    paneId: PANE_ID,
    renderNode,
    resize: rendererOptions.resize === true,
    reconnect: rendererOptions.reconnect === true,
    cull: rendererOptions.cull === true,
    controls: rendererOptions.controls === true,
    minimap: rendererOptions.minimap === true,
    fitView: { padding: spec.padding ?? 0.14, maxZoom: 1, duration: 200 },
    accessibleName: (node) => `${node.data.title}, ${node.data.subtitle}`,
  };
  if (rendererOptions.snapGrid !== undefined) {
    rendererConfig.snapGrid = rendererOptions.snapGrid;
  }
  if (rendererOptions.background === true) {
    rendererConfig.background = { variant: "dots" };
  }
  const renderer = Flow.createRenderer<NodeData, unknown>(rendererConfig);

  const isCollapsed = (model: Model): boolean =>
    model.graph.nodes.some(
      (node) => collapseIds.includes(node.id) && node.hidden === true,
    );

  const panel = (model: Model, h: HtmlBuilder<Message>): Html =>
    Flow.panel(
      { position: "BottomLeft", label: "Example actions" },
      [
        h.span([h.Class("ex2-panel-fact")], [model.lastFact]),
        h.div(
          [h.Class("ex2-panel-actions")],
          [
            ...(Arr.isReadonlyArrayEmpty(collapseIds)
              ? []
              : [
                  h.button(
                    [
                      h.Class("ex2-button"),
                      h.OnClick(Message.ClickedToggleCollapse()),
                    ],
                    [isCollapsed(model) ? "Expand" : "Collapse"],
                  ),
                ]),
            ...(spec.viewport === "fit" || spec.controls?.fit === true
              ? [
                  h.button(
                    [h.Class("ex2-button"), h.OnClick(Message.ClickedFit())],
                    ["Fit view"],
                  ),
                ]
              : []),
          ],
        ),
      ],
      h,
    );

  const sourceBlocks = (h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
    [
      { label: `${spec.name}.ts`, body: sources.spec, isOpen: true },
      { label: "harness.ts", body: sources.harness, isOpen: false },
      { label: "examples.css", body: sources.css, isOpen: false },
    ].map((file) =>
      h.details(
        [
          h.Class("ex2-file"),
          ...(file.isOpen ? [h.Attribute("open", "")] : []),
        ],
        [
          h.summary([h.Class("ex2-file-label")], [file.label]),
          h.pre([h.Class("ex2-code")], [h.code([], [file.body])]),
        ],
      ),
    );

  const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
    title: `${spec.title} — Foldkit Flow example`,
    body: h.main(
      [
        h.Class("ex2-page"),
        h.DataAttribute("example-name", spec.name),
        h.DataAttribute("example-category", spec.category),
        h.DataAttribute("example-fact", model.lastFact),
        h.DataAttribute("example-nodes", String(model.graph.nodes.length)),
      ],
      [
        h.header(
          [h.Class("ex2-header")],
          [
            h.div(
              [h.Class("ex2-heading")],
              [
                h.span([h.Class("ex2-category")], [spec.category]),
                h.h1([h.Class("ex2-title")], [spec.title]),
              ],
            ),
            h.p([h.Class("ex2-description")], [spec.description]),
            h.nav(
              [h.Class("ex2-nav")],
              [
                h.a(
                  [h.Class("ex2-link"), h.Href("/examples/")],
                  ["All examples"],
                ),
              ],
            ),
          ],
        ),
        h.div(
          [h.Class("ex2-split")],
          [
            h.section(
              [h.Class("ex2-stage")],
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
            h.aside([h.Class("ex2-source")], sourceBlocks(h)),
          ],
        ),
      ],
    ),
  });

  return { renderNode, Model, Message, init, update, view, subscriptions };
};
