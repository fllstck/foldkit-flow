import { Option } from "effect";
import { describe, expect, test } from "vitest";

import type { Context, HandleBounds, Model } from "../model.js";
import { init } from "../model.js";
import { connectionRadius, hitTestHandle } from "./hitTest.js";

const handle = (
  nodeId: string,
  type: "Source" | "Target",
  x: number,
  y: number,
): HandleBounds => ({
  nodeId,
  handleId: Option.some(`${nodeId}-${type}`),
  type,
  position: type === "Source" ? "Right" : "Left",
  x,
  y,
  width: 8,
  height: 8,
});

// Two nodes stacked 40 flow units apart, so the handle boxes are centred on
// (104, 20) and (104, 60) in flow space: close enough to overlap under slack,
// far enough that the nearest one is unambiguous.
const context: Context = {
  nodes: [
    { id: "a", position: { x: 0, y: 0 }, data: null },
    { id: "b", position: { x: 0, y: 40 }, data: null },
  ],
  edges: [],
};

const model = (zoom: number): Model => ({
  ...init({ x: 0, y: 0, zoom }).model,
  handleBounds: [
    handle("a", "Source", 100, 16),
    // Node `b` sits at y 40, so its handle box lands on 56..64 — centred (104, 60).
    handle("b", "Target", 100, 16),
  ],
});

describe("hitTestHandle", () => {
  test("an exact hit needs no slack", () => {
    const hit = hitTestHandle(model(1), { x: 104, y: 20 }, context);
    expect(hit).toEqual(
      Option.some({
        nodeId: "a",
        handleId: Option.some("a-Source"),
        type: "Source",
      }),
    );
  });

  test("without slack, a point near the box misses", () => {
    // 12 flow units to the right of the box's edge.
    expect(hitTestHandle(model(1), { x: 124, y: 20 }, context)).toEqual(
      Option.none(),
    );
  });

  test("with slack, a near miss resolves to that handle", () => {
    const hit = hitTestHandle(model(1), { x: 124, y: 20 }, context, {
      tolerance: connectionRadius,
    });
    expect(Option.isSome(hit)).toBe(true);
  });

  test("with overlapping slack the nearest handle wins, not the last one", () => {
    // Both boxes are within a large slack, and the point is closer to `a`, which
    // comes first in DOM order — last-match-wins would pick `b`.
    const hit = hitTestHandle(model(1), { x: 106, y: 20 }, context, {
      tolerance: 200,
    });
    expect(hit).toEqual(
      Option.some({
        nodeId: "a",
        handleId: Option.some("a-Source"),
        type: "Source",
      }),
    );
  });

  test("the radius is in screen pixels: zooming out widens it in flow units", () => {
    // 30 flow units away: outside a 20-unit flow slack, inside 20 screen pixels
    // at zoom 0.5 (which is 40 flow units).
    expect(
      Option.isNone(
        hitTestHandle(model(1), { x: 134, y: 20 }, context, { tolerance: 20 }),
      ),
    ).toBe(true);
    expect(
      Option.isSome(
        hitTestHandle(model(0.5), { x: 134, y: 20 }, context, {
          tolerance: 40,
        }),
      ),
    ).toBe(true);
  });

  test("accept still filters before the distance is considered", () => {
    // The nearest handle to this point is `a` (Source, ~38 units away); asking
    // for a Target must still find `b` instead.
    const hit = hitTestHandle(model(1), { x: 106, y: 58 }, context, {
      accept: (bounds) => bounds.type === "Target",
      tolerance: connectionRadius,
    });
    expect(Option.map(hit, (ref) => ref.nodeId)).toEqual(Option.some("b"));
  });
});
