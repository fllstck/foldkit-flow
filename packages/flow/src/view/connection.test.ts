import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import { edgePath } from "../geometry/paths.js";
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
  {
    id: "b",
    position: { x: 400, y: 200 },
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

const targetHandle: HandleBounds = {
  nodeId: "b",
  handleId: Option.some("in"),
  type: "Target",
  position: "Left",
  x: -4,
  y: 16,
  width: 8,
  height: 8,
};

// Two source handles on one node: x=0 (center 104,70) and x=100 (center 204,70).
const handleBounds: ReadonlyArray<HandleBounds> = [
  sourceHandle("out-a", 0),
  sourceHandle("out-b", 100),
  targetHandle,
];

const renderer = createRenderer({
  paneId: "p",
  renderNode: (n, _t, h) => h.div([], [n.id]),
});

const connecting = (
  handleId: string,
  current = { x: 0, y: 0 },
  maybeTarget: Option.Option<{
    nodeId: string;
    handleId: Option.Option<string>;
    type: "Target";
  }> = Option.none(),
): Model => ({
  ...init().model,
  pane: { width: 800, height: 600, left: 0, top: 0 },
  handleBounds,
  gesture: Gesture.Connecting({
    pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
    from: { nodeId: "a", handleId: Option.some(handleId), type: "Source" },
    current,
    maybeTarget,
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

const connectionPath = async (model: Model): Promise<string> => {
  const rendered = await render(model);
  const match = /fflow__connection[^>]*><path d="([^"]+)"/.exec(rendered.html);
  if (match === null) throw new Error("no connection path rendered");
  return match[1] ?? "";
};

describe("connection preview", () => {
  test("anchors on the selected handle, not the first of its type", async () => {
    const d = await connectionPath(connecting("out-b"));
    expect(d.startsWith("M204,70 ")).toBe(true);
  });

  test("a different handle id moves the anchor", async () => {
    const d = await connectionPath(connecting("out-a"));
    expect(d.startsWith("M104,70 ")).toBe(true);
  });

  test("leaves the handle and enters the pointer from the sides they face", async () => {
    // A path, not a straight line: the source leaves from the handle's own
    // `position`, and the free end is entered from the side it approaches.
    expect(await connectionPath(connecting("out-a"))).toBe(
      edgePath("Bezier", {
        sourceX: 104,
        sourceY: 70,
        sourcePosition: "Right",
        targetX: 0,
        targetY: 0,
        targetPosition: "Right",
      }).d,
    );

    // Below the source handle, the pointer end is entered from the top.
    expect(await connectionPath(connecting("out-a", { x: 104, y: 400 }))).toBe(
      edgePath("Bezier", {
        sourceX: 104,
        sourceY: 70,
        sourcePosition: "Right",
        targetX: 104,
        targetY: 400,
        targetPosition: "Top",
      }).d,
    );
  });

  test("snaps to the hovered target handle and uses its position", async () => {
    const d = await connectionPath(
      connecting(
        "out-b",
        { x: 300, y: 300 },
        Option.some({
          nodeId: "b",
          handleId: Option.some("in"),
          type: "Target" as const,
        }),
      ),
    );

    // b sits at (400,200) and its `in` handle at node-local (-4,16): its centre
    // is flow (400,220), and its own `position` is `Left`.
    expect(d).toBe(
      edgePath("Bezier", {
        sourceX: 204,
        sourceY: 70,
        sourcePosition: "Right",
        targetX: 400,
        targetY: 220,
        targetPosition: "Left",
      }).d,
    );
  });

  test("no connection line while the gesture is idle", async () => {
    const rendered = await render({ ...init().model, handleBounds });
    expect(rendered.html).not.toContain("fflow__connection");
  });
});
