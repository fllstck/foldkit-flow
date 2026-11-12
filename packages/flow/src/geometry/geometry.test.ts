import { Option } from "effect";
import { describe, expect, test } from "vitest";

import { nodeBounds, nodeSizeOf } from "./bounds.js";
import { findHandle, handleCenter, isSameHandle } from "./handles.js";
import { hitTestHandle, oppositeHandleType } from "./hitTest.js";
import { dragDelta, flowToScreen, screenToFlow } from "./screen.js";
import { visibleEdges, visibleNodes } from "./visible.js";
import { Gesture, init } from "../model.js";
import type {
  Context,
  FlowEdge,
  FlowNode,
  HandleBounds,
  NodeSize,
} from "../model.js";

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
        anchor: { x: 0, y: 0 },
        snapGrid: Option.none(),
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

describe("the measured-size index (M4-FINDINGS §6, §7)", () => {
  test("the first measurement for an id wins, as the linear find did", () => {
    const sizes: ReadonlyArray<NodeSize> = [
      { nodeId: "a", width: 10, height: 20 },
      { nodeId: "a", width: 30, height: 40 },
    ];

    expect(nodeSizeOf(node("a", 0, 0), sizes)).toEqual({
      width: 10,
      height: 20,
    });
  });

  test("an unmeasured node uses its own size, then the shared fallback", () => {
    expect(nodeSizeOf(node("a", 0, 0), [])).toEqual({ width: 100, height: 40 });
    expect(
      nodeSizeOf({ id: "b", position: { x: 0, y: 0 }, data: null }, []),
    ).toEqual({ width: 151, height: 40 });
  });

  /**
   * The 10k fixture, with the *measurement array* wrapped so reads through it can
   * be counted. Counting is what replaced a wall-clock threshold here: the old
   * scan did a linear `find` per node, so it touched the array O(N²) times, and a
   * read counter says that deterministically — no machine, no flakiness
   * (`docs/TEST-STRATEGY-REVIEW.md`, "Test that should move out of ordinary unit
   * tests"). The frame cost in a real browser is the gate's business now.
   */
  const countingSizes = (sizes: ReadonlyArray<NodeSize>) => {
    const reads = { count: 0 };
    const proxy = new Proxy(sizes as Array<NodeSize>, {
      get: (target, property, receiver) => {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          reads.count += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    return { sizes: proxy as ReadonlyArray<NodeSize>, reads };
  };

  const readCountFor = (): { first: number; second: number } => {
    const large: ReadonlyArray<FlowNode> = Array.from(
      { length: 10_000 },
      (_, index) =>
        node(`n${index}`, (index % 100) * 200, Math.floor(index / 100) * 100),
    );
    const { sizes, reads } = countingSizes(
      large.map((entry) => ({ nodeId: entry.id, width: 100, height: 40 })),
    );
    const model = {
      ...init({ x: 0, y: 0, zoom: 1 }).model,
      pane: { width: 900, height: 600, left: 0, top: 0 },
      nodeSizes: sizes,
    };

    visibleNodes(model, large);
    const first = reads.count;
    // A viewport change is what a pan frame is; the sizes array is unchanged, so
    // the index must not be rebuilt.
    visibleNodes({ ...model, viewport: { x: 7, y: 0, zoom: 1 } }, large);
    return { first, second: reads.count - first };
  };

  test("a culling scan reads each measurement once, not once per node", () => {
    const { first } = readCountFor();

    // One pass over the measurements (~10,000 reads), not one `find` per node
    // (which is what this fixture measured as 9.8 seconds of wall clock before the
    // index, and which this assertion now pins without any clock at all).
    expect(first).toBeGreaterThan(9_000);
    expect(first).toBeLessThan(20_000);
  });

  test("a viewport change reuses the index instead of re-reading the measurements", () => {
    const { second } = readCountFor();

    // Zero: the memo is keyed on the array's reference, and a pan changes the
    // viewport, not the graph.
    expect(second).toBe(0);
  });
});

describe("handle identity", () => {
  const first: HandleBounds = {
    ...measured,
    handleId: Option.some("out-a"),
    x: 0,
  };
  const second: HandleBounds = {
    ...measured,
    handleId: Option.some("out-b"),
    x: 100,
  };
  const bounds = [first, second];

  test("compares node, type, and handle id", () => {
    expect(
      isSameHandle(
        { nodeId: "a", handleId: Option.some("out-b"), type: "Source" },
        second,
      ),
    ).toBe(true);
    expect(
      isSameHandle(
        { nodeId: "a", handleId: Option.some("out-b"), type: "Source" },
        first,
      ),
    ).toBe(false);
    expect(
      isSameHandle(
        { nodeId: "a", handleId: Option.some("out-b"), type: "Target" },
        second,
      ),
    ).toBe(false);
  });

  test("an unset handle id matches an unset measured id", () => {
    expect(
      isSameHandle(
        { nodeId: "a", handleId: Option.none(), type: "Source" },
        measured,
      ),
    ).toBe(true);
  });

  test("finds the requested handle among same-type siblings", () => {
    expect(
      Option.map(
        findHandle(bounds, {
          nodeId: "a",
          handleId: Option.some("out-b"),
          type: "Source",
        }),
        (entry) => entry.x,
      ),
    ).toEqual(Option.some(100));
  });

  test("centers the requested handle in flow space", () => {
    expect(
      handleCenter(
        bounds,
        { x: 100, y: 50 },
        {
          nodeId: "a",
          handleId: Option.some("out-b"),
          type: "Source",
        },
      ),
    ).toEqual(Option.some({ x: 204, y: 70 }));
  });

  test("a missing handle yields None", () => {
    expect(
      findHandle(bounds, {
        nodeId: "a",
        handleId: Option.some("missing"),
        type: "Source",
      }),
    ).toEqual(Option.none());
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
