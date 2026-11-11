import { Option, Schema } from "effect";
import { Command, type Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";

const FLOW_PANE_ID = "m0-pane";

const Stats = Schema.Struct({
  measuredNodes: Schema.Number,
  paneMounts: Schema.Number,
  viewportFrames: Schema.Number,
  syncs: Schema.Number,
  failedMounts: Schema.Number,
});
type Stats = typeof Stats.Type;

export const Model = Schema.Struct({
  flow: Flow.Model,
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
});
export type Message = typeof Message.Type;

const initialStats: Stats = {
  measuredNodes: 0,
  paneMounts: 0,
  viewportFrames: 0,
  syncs: 0,
  failedMounts: 0,
};

export type Init = Readonly<{ model: Model }>;

export const init = (): Init => ({
  model: {
    flow: Flow.init({ x: 20, y: 30, zoom: 0.9 }).model,
    label: "Node",
    isFlowMounted: true,
    stats: initialStats,
  },
});

const toParentMessage = (message: Flow.Message): Message =>
  Message.GotFlowMessage({ message });

type UpdateReturn = Update.Return<Model, Message>;

const countMessage = (stats: Stats, message: Flow.Message): Stats =>
  Flow.Message.match(message, {
    MeasuredNode: () => ({
      ...stats,
      measuredNodes: stats.measuredNodes + 1,
    }),
    MountedPane: () => ({ ...stats, paneMounts: stats.paneMounts + 1 }),
    MovedViewport: () => ({
      ...stats,
      viewportFrames: stats.viewportFrames + 1,
    }),
    CompletedSyncViewport: () => ({ ...stats, syncs: stats.syncs + 1 }),
    FailedMountPane: () => ({
      ...stats,
      failedMounts: stats.failedMounts + 1,
    }),
    ResizedPane: () => stats,
    FailedSyncViewport: () => stats,
  });

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotFlowMessage: ({ message: flowMessage }) => {
      const result = Flow.update(model.flow, flowMessage, {
        nodes: [],
        edges: [],
      });

      return {
        model: {
          ...model,
          flow: result.model,
          stats: countMessage(model.stats, flowMessage),
        },
        commands: Command.mapMessages(result.commands, toParentMessage),
      };
    },
    ClickedRerender: () => ({
      model: {
        ...model,
        label: model.label === "Node" ? "Rerendered" : "Node",
      },
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
  });

type Graph = Readonly<{
  nodes: ReadonlyArray<FlowNode<{ label: string }>>;
  edges: ReadonlyArray<FlowEdge>;
}>;

const buildGraph = (label: string): Graph => {
  const nodes: Array<FlowNode<{ label: string }>> = [];
  const edges: Array<FlowEdge> = [];

  for (let row = 0; row < 25; row += 1) {
    for (let column = 0; column < 25; column += 1) {
      const index = row * 25 + column;
      const id = `n${index}`;
      nodes.push({
        id,
        position: { x: column * 190, y: row * 90 },
        size: { width: 150, height: 36 },
        data: { label: `${label} ${index}` },
      });
      if (index > 0) {
        edges.push({ id: `e${index}`, source: `n${index - 1}`, target: id });
      }
    }
  }

  return { nodes, edges };
};

const renderNode = (
  node: FlowNode<{ label: string }>,
  _tools: Flow.NodeTools,
  h: HtmlBuilder<any>,
): Html => h.div([h.Class("fflow__node-label")], [node.data.label]);

const renderer = Flow.createRenderer<{ label: string }, unknown>({
  paneId: FLOW_PANE_ID,
  renderNode,
});

const stat = (h: HtmlBuilder<Message>, key: string, value: number) =>
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
  const graph = buildGraph(model.label);

  return {
    title: "Foldkit Flow — M0",
    body: h.main(
      [
        h.Class("app"),
        h.DataAttribute("label", model.label),
        h.DataAttribute(
          "viewport",
          `${model.flow.viewport.x},${model.flow.viewport.y},${model.flow.viewport.zoom}`,
        ),
        h.DataAttribute("measured-nodes", String(model.stats.measuredNodes)),
        h.DataAttribute("pane-mounts", String(model.stats.paneMounts)),
        h.DataAttribute("viewport-frames", String(model.stats.viewportFrames)),
        h.DataAttribute("syncs", String(model.stats.syncs)),
        h.DataAttribute("failed-mounts", String(model.stats.failedMounts)),
      ],
      [
        h.header(
          [h.Class("toolbar")],
          [
            h.h1([h.Class("title")], [`Foldkit Flow — M0 — ${model.label}`]),
            h.div(
              [h.Class("stats")],
              [
                stat(h, "measured-nodes", model.stats.measuredNodes),
                stat(h, "pane-mounts", model.stats.paneMounts),
                stat(h, "viewport-frames", model.stats.viewportFrames),
                stat(h, "syncs", model.stats.syncs),
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
                    model: model.flow,
                    nodes: graph.nodes,
                    edges: graph.edges,
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
