import { Schema } from "effect";
import { Command, Runtime, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";

import {
  edges as benchEdges,
  initialViewport,
  nodes as benchNodes,
} from "../fixture";

const PANE_ID = "bench-pane";

const flowNodes: ReadonlyArray<FlowNode<{ label: string }>> = benchNodes.map(
  (node) => ({
    id: node.id,
    position: node.position,
    size: { width: 150, height: 36 },
    data: node.data,
  }),
);

const flowEdges: ReadonlyArray<FlowEdge> = benchEdges;

const Model = Schema.Struct({
  flow: Flow.Model,
  measured: Schema.Number,
});
type Model = typeof Model.Type;

const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
});
type Message = typeof Message.Type;

const toParentMessage = (message: Flow.Message): Message =>
  Message.GotFlowMessage({ message });

const init = (): Update.Return<Model, Message> => ({
  model: { flow: Flow.init(initialViewport).model, measured: 0 },
});

const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match(message, {
    GotFlowMessage: ({ message: flowMessage }) => {
      const result = Flow.update(model.flow, flowMessage, {
        nodes: flowNodes,
        edges: flowEdges,
      });
      const measured = Flow.Message.match(flowMessage, {
        MeasuredNode: () => model.measured + 1,
        MountedPane: () => model.measured,
        FailedMountPane: () => model.measured,
        ResizedPane: () => model.measured,
        MovedViewport: () => model.measured,
        CompletedSyncViewport: () => model.measured,
        FailedSyncViewport: () => model.measured,
      });

      return {
        model: { flow: result.model, measured },
        commands: Command.mapMessages(result.commands, toParentMessage),
      };
    },
  });

const renderNode = (
  node: FlowNode<{ label: string }>,
  _tools: Flow.NodeTools,
  h: HtmlBuilder<Message>,
): Html => h.div([h.Class("fflow__node-label")], [node.data.label]);

const renderer = Flow.createRenderer<{ label: string }, unknown>({
  paneId: PANE_ID,
  renderNode,
});

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class("bench-root"),
      h.DataAttribute("bench-ready", "true"),
      h.DataAttribute("measured", String(model.measured)),
    ],
    [
      renderer.view(
        {
          model: model.flow,
          nodes: flowNodes,
          edges: flowEdges,
          toParentMessage,
        },
        h,
      ),
    ],
  );

const container = document.getElementById("root");

if (container !== null) {
  Runtime.run(
    Runtime.makeElement({
      Model,
      init,
      update,
      view,
      container,
    }),
  );
}
