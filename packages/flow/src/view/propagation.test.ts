// @vitest-environment jsdom
import { Option } from "effect";
import { Scene } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { describe, test } from "vitest";

import { Message } from "../message.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode } from "../model.js";
import { OutMessage } from "../outMessage.js";
import { MeasureHandles } from "../runtime/command.js";
import { MountNode } from "../runtime/mountNode.js";
import { MountPane } from "../runtime/mountPane.js";
import { update } from "../update.js";
import { createRenderer } from "../view/view.js";
import type { NodeTools } from "../view/view.js";

const paneId = "scene-pane";

const nodes: ReadonlyArray<FlowNode<{ label: string }>> = [
  {
    id: "n1",
    position: { x: 0, y: 0 },
    size: { width: 160, height: 60 },
    data: { label: "Node one" },
  },
];

const edges: ReadonlyArray<FlowEdge> = [];

const renderNode = (
  node: FlowNode<{ label: string }>,
  tools: NodeTools,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("node-shell")],
    [
      h.span([h.Class("node-title")], [node.data.label]),
      h.button(
        [h.Class("node-button"), h.OnClick(Message.PressedDeleteKey())],
        ["Delete"],
      ),
      h.div([h.Class("fflow__nodrag")], ["No drag here"]),
      tools.handle({ id: "out", type: "Source", position: "Right" }),
      tools.handle({ id: "in", type: "Target", position: "Left" }),
    ],
  );

const renderer = createRenderer<{ label: string }, unknown>({
  paneId,
  renderNode,
});

const toParentMessage = (message: Message): Message => message;

const initModel = {
  ...init().model,
  pane: { width: 800, height: 600, left: 0, top: 0 },
  paneId: Option.some(paneId),
};

const view = (model: typeof initModel, h: HtmlBuilder<Message>): Html =>
  renderer.view({ model, nodes, edges, toParentMessage }, h);

const sceneUpdate = (model: typeof initModel, message: Message) =>
  update(model, message, { nodes, edges });

const { scene, given, pointerDown, expectOutMessage, expectNoOutMessage } =
  Scene;

const { Command } = Scene;

/** Typed as the whole Message union so `Command.resolve` can infer a result
 *  type the Command's own result union is assignable to. */
const failedMeasure: Message = Message.FailedMeasureHandles({
  reason: "scene",
});

/** Every Mount in the rendered tree has to be acknowledged before Scene lets an
 *  interaction dispatch a Message. */
const resolveMounts = () => [
  Scene.Mount.resolve(MountPane, Message.MountedPane({ paneId })),
  Scene.Mount.resolve(
    MountNode,
    Message.MeasuredNode({
      nodeId: "n1",
      size: { width: 160, height: 60 },
    }),
  ),
];

describe("event propagation", () => {
  test("a handle press starts a connection and never selects", () => {
    scene(
      { update: sceneUpdate, view },
      given(initModel),
      ...resolveMounts(),
      pointerDown('[data-handleid="out"]'),
      Command.expectHas(MeasureHandles),
      Command.resolve<"MeasureHandles", Message>(MeasureHandles, failedMeasure),
      expectNoOutMessage(),
    );
  });

  test("a node press selects the node and arms no connection", () => {
    scene(
      { update: sceneUpdate, view },
      given(initModel),
      ...resolveMounts(),
      pointerDown(".node-title"),
      Command.expectNone(),
      expectOutMessage(
        OutMessage.SelectedElements({ nodeIds: ["n1"], edgeIds: [] }),
      ),
    );
  });

  test("a nested control inside a node arms neither a drag nor a connection", () => {
    scene(
      { update: sceneUpdate, view },
      given(initModel),
      ...resolveMounts(),
      pointerDown(".node-button"),
      Scene.expectIgnored(),
      Command.expectNone(),
      expectNoOutMessage(),
    );
  });

  test("a pane press clears the selection", () => {
    scene(
      { update: sceneUpdate, view },
      given({ ...initModel, selectedNodeIds: ["n1"] }),
      ...resolveMounts(),
      pointerDown(".fflow__pane"),
      expectOutMessage(
        OutMessage.SelectedElements({ nodeIds: [], edgeIds: [] }),
      ),
    );
  });

  test("handles and nodes render with the engine's geometry contract", () => {
    scene(
      { update: sceneUpdate, view },
      given(initModel),
      ...resolveMounts(),
      Scene.expect(Scene.selector('[data-handleid="out"]')).toExist(),
      Scene.expect(Scene.selector('[data-nodeid="n1"]')).toContainText(
        "Node one",
      ),
    );
  });
});
