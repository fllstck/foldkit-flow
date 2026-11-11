import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import type { Message } from "../message.js";
import { Gesture, init } from "../model.js";
import type { FlowNode, HandleBounds, Model } from "../model.js";
import { createRenderer } from "./view.js";

const nodes: ReadonlyArray<FlowNode> = [
  {
    id: "a",
    position: { x: 100, y: 50 },
    size: { width: 200, height: 40 },
    data: null,
  },
];

const sourceHandle = (handleId: string, x: number): HandleBounds => ({
  nodeId: "a",
  handleId: Option.some(handleId),
  type: "Source",
  position: "Right",
  x,
  y: 16,
  width: 8,
  height: 8,
});

// Two source handles on one node: x=0 (center 104,70) and x=100 (center 204,70).
const handleBounds: ReadonlyArray<HandleBounds> = [
  sourceHandle("out-a", 0),
  sourceHandle("out-b", 100),
];

const renderer = createRenderer({
  paneId: "p",
  renderNode: (n, _t, h) => h.div([], [n.id]),
});

const connecting = (handleId: string): Model => ({
  ...init().model,
  pane: { width: 800, height: 600, left: 0, top: 0 },
  handleBounds,
  gesture: Gesture.Connecting({
    pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
    from: { nodeId: "a", handleId: Option.some(handleId), type: "Source" },
    current: { x: 0, y: 0 },
    maybeTarget: Option.none(),
  }),
});

const render = (model: Model) =>
  Effect.runPromise(
    Server.renderToString(
      {
        init: () => ({ model }),
        view: (current, h) => ({
          title: "connection",
          body: renderer.view(
            {
              model: current,
              nodes,
              edges: [],
              toParentMessage: (message: Message) => message,
            },
            h,
          ),
        }),
      },
      { isHydratable: false },
    ),
  );

describe("connection preview", () => {
  test("anchors on the selected handle, not the first of its type", async () => {
    const rendered = await render(connecting("out-b"));
    expect(rendered.html).toContain('d="M204,70 L0,0"');
  });

  test("a different handle id moves the anchor", async () => {
    const rendered = await render(connecting("out-a"));
    expect(rendered.html).toContain('d="M104,70 L0,0"');
  });

  test("no connection line while the gesture is idle", async () => {
    const rendered = await render({ ...init().model, handleBounds });
    expect(rendered.html).not.toContain("fflow__connection");
  });
});
