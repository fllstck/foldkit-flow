import { Option } from "effect";
import { describe, expect, test } from "vitest";

import { nodeBounds } from "./bounds.js";
import { hitTestHandle, oppositeHandleType } from "./hitTest.js";
import { dragDelta, flowToScreen, screenToFlow } from "./screen.js";
import { visibleEdges, visibleNodes } from "./visible.js";
import { Gesture, init } from "../model.js";
import type { Context, FlowEdge, FlowNode, HandleBounds } from "../model.js";

const node = (
  id: string,
  x: number,
  y: number,
  size = { width: 100, height: 40 },
): FlowNode => ({ id, position: { x, y }, size, data: null });

const context: Context = { nodes: [], edges: [] };

const measured: HandleBounds = {
  nodeId: "a",
  handleId: Option.none(),
  type: "Source",
  position: "Right",
  x: 92,
  y: 16,
  width: 8,
  height: 8,
};

describe("screen and flow coordinates", () => {
  const model = {
    ...init({ x: 100, y: 50, zoom: 2 }).model,
    pane: { width: 800, height: 600, left: 10, top: 20 },
  };

  test("screenToFlow inverts the pane origin and the viewport transform", () => {
    expect(screenToFlow(model, { screenX: 210, screenY: 170 })).toEqual({
      x: 50,
      y: 50,
    });
  });

  test("flowToScreen round-trips", () => {
    const point = { x: 37, y: -12 };
    const screen = flowToScreen(model, point);
    expect(
      screenToFlow(model, { screenX: screen.x, screenY: screen.y }),
    ).toEqual(point);
  });

  test("dragDelta is the overlay offset, and the shared zero otherwise", () => {
    expect(dragDelta(model)).toEqual({ x: 0, y: 0 });

    const dragging = {
      ...model,
      gesture: Gesture.DraggingNodes({
        pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
        nodeIds: ["a"],
        origin: { x: 0, y: 0 },
        delta: { x: 12, y: -4 },
        hasMoved: true,
      }),
    };
    expect(dragDelta(dragging)).toEqual({ x: 12, y: -4 });
  });
});

describe("culling", () => {
  const model = {
    ...init({ x: 0, y: 0, zoom: 1 }).model,
    pane: { width: 400, height: 300, left: 0, top: 0 },
  };

  test("keeps the visible nodes plus one screen of overscan", () => {
    const inside = node("inside", 10, 10);
    const overscan = node("overscan", 700, 10);
    const outside = node("outside", 1400, 10);

    expect(
      visibleNodes(model, [inside, overscan, outside]).map((n) => n.id),
    ).toEqual(["inside", "overscan"]);
  });

  test("follows the viewport", () => {
    const far = node("far", 1000, 1000);
    expect(visibleNodes(model, [far])).toEqual([]);

    const panned = { ...model, viewport: { x: -900, y: -900, zoom: 1 } };
    expect(visibleNodes(panned, [far]).map((n) => n.id)).toEqual(["far"]);
  });

  test("keeps an edge whose endpoints box crosses the viewport", () => {
    const nodes = [node("a", -300, 100), node("b", 300, 100)];
    const edges: ReadonlyArray<FlowEdge> = [
      { id: "crossing", source: "a", target: "b" },
      { id: "far", source: "a", target: "missing" },
    ];

    expect(visibleEdges(model, edges, nodes).map((e) => e.id)).toEqual([
      "crossing",
    ]);
  });

  test("nodeBounds spans every node box", () => {
    expect(nodeBounds(model, [node("a", 0, 0), node("b", 200, 100)])).toEqual({
      left: 0,
      top: 0,
      width: 300,
      height: 140,
    });
  });
});

describe("handle hit-testing", () => {
  const withBounds = { ...init().model, handleBounds: [measured] };
  const graph: Context = { nodes: [node("a", 100, 50)], edges: [] };

  test("resolves the node-local bounds against the node position", () => {
    expect(hitTestHandle(withBounds, { x: 195, y: 70 }, graph)).toEqual(
      Option.some({ nodeId: "a", handleId: Option.none(), type: "Source" }),
    );
  });

  test("misses a point outside every handle", () => {
    expect(hitTestHandle(withBounds, { x: 5, y: 5 }, graph)).toEqual(
      Option.none(),
    );
  });

  test("ignores bounds whose node left the graph", () => {
    expect(hitTestHandle(withBounds, { x: 195, y: 70 }, context)).toEqual(
      Option.none(),
    );
  });

  test("accept filters candidates by handle type", () => {
    expect(
      hitTestHandle(withBounds, { x: 195, y: 70 }, graph, {
        accept: (bounds) => bounds.type === oppositeHandleType("Source"),
      }),
    ).toEqual(Option.none());
  });
});
