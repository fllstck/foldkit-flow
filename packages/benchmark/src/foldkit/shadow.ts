import { Option, Schema } from "effect";
import { Command, Runtime, Subscription } from "foldkit";
import type { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";

/**
 * ShadowRoot host (proof: subscriptions resolve the pane's root, not
 * `document`). The flow renders into a container inside a shadow root, so
 * `element.getRootNode()` is the ShadowRoot and the pointer listeners must
 * attach there for a drag to work at all.
 */
const paneId = "shadow-pane";

const nodes: ReadonlyArray<FlowNode<{ label: string }>> = [
  {
    id: "s1",
    position: { x: 40, y: 40 },
    size: { width: 150, height: 36 },
    data: { label: "Shadow node" },
  },
];
const edges: ReadonlyArray<FlowEdge> = [];

const Model = Schema.Struct({ flow: Flow.Model });
type Model = typeof Model.Type;

const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
});
type Message = typeof Message.Type;

const toParentMessage = (message: Flow.Message): Message =>
  Message.GotFlowMessage({ message });

const init = (): Update.Return<Model, Message> => ({
  model: {
    flow: Flow.init({ x: 0, y: 0, zoom: 1 }).model,
  },
});

const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match(message, {
    GotFlowMessage: ({ message: flowMessage }) => {
      const result = Flow.update(model.flow, flowMessage, { nodes, edges });
      return {
        model: { flow: result.model },
        commands: Command.mapMessages(result.commands ?? [], toParentMessage),
      };
    },
  });

const subscriptions = Subscription.lift(Flow.subscriptions)<Model, Message>({
  read: (model) => Option.some(model.flow),
  toParentMessage,
});

const renderer = Flow.createRenderer<{ label: string }, unknown>({
  paneId,
  renderNode: (node, _tools, h) =>
    h.div([h.Class("fflow__node-label")], [node.data.label]),
});

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class("bench-root"),
      h.DataAttribute("bench-ready", "true"),
      h.DataAttribute("node-x", String(nodes[0]?.position.x ?? 0)),
    ],
    [renderer.view({ model: model.flow, nodes, edges, toParentMessage }, h)],
  );

const host = document.getElementById("shadow-host");

if (host !== null) {
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  // The pane is 100% × 100% of its containing block, so the shadow host must
  // have a definite box; a percentage height against an auto-height parent
  // collapses to zero.
  style.textContent =
    ":host { display: block; width: 900px; height: 500px; } .bench-root { height: 100%; } .fflow__pane { width: 100%; height: 100%; }";
  const container = document.createElement("div");
  container.id = "shadow-root";
  shadow.append(style, container);

  Runtime.run(
    Runtime.makeElement({
      Model,
      init,
      update,
      view,
      subscriptions,
      container,
    }),
  );
}
