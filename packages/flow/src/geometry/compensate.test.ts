import { describe, expect, test } from "vitest";

import type { Rect } from "../model.js";
import { compensateChildPositions } from "./compensate.js";

/** A 400×300 container at (100, 100) holding two children. */
const before: Rect = { left: 100, top: 100, width: 400, height: 300 };

const children = [
  { nodeId: "c1", position: { x: 20, y: 60 } },
  { nodeId: "c2", position: { x: 240, y: 60 } },
];

describe("compensateChildPositions (§7 M7)", () => {
  test("a top-left resize keeps the children where they were on screen", () => {
    // The parent's top-left moved right 40 and down 20, so the children's
    // relative positions shrink by the same amount: their absolute positions are
    // unchanged, which is what "visually still" means.
    const after: Rect = { left: 140, top: 120, width: 360, height: 280 };
    expect(
      compensateChildPositions({
        parentBefore: before,
        parentAfter: after,
        children,
      }),
    ).toEqual([
      { nodeId: "c1", x: -20, y: 40 },
      { nodeId: "c2", x: 200, y: 40 },
    ]);
  });

  test("a bottom-right resize compensates nothing", () => {
    // The anchor did not move: the children are already in the right place, and
    // the helper says so instead of inventing a delta from the size change.
    const after: Rect = { left: 100, top: 100, width: 560, height: 420 };
    expect(
      compensateChildPositions({
        parentBefore: before,
        parentAfter: after,
        children,
      }),
    ).toEqual([
      { nodeId: "c1", x: 20, y: 60 },
      { nodeId: "c2", x: 240, y: 60 },
    ]);
  });

  test("only the direct children passed in are answered", () => {
    // A grandchild is its own parent's business: it is not in this list, and the
    // helper does not walk for it.
    const after: Rect = { left: 60, top: 100, width: 440, height: 300 };
    const result = compensateChildPositions({
      parentBefore: before,
      parentAfter: after,
      children: [{ nodeId: "c1", position: { x: 20, y: 60 } }],
    });
    expect(result.map((child) => child.nodeId)).toEqual(["c1"]);
  });

  test("no children is no work", () => {
    const after: Rect = { left: 140, top: 120, width: 360, height: 280 };
    expect(
      compensateChildPositions({
        parentBefore: before,
        parentAfter: after,
        children: [],
      }),
    ).toEqual([]);
  });

  test("the inputs are not mutated", () => {
    const after: Rect = { left: 140, top: 120, width: 360, height: 280 };
    const input = {
      parentBefore: { ...before },
      parentAfter: { ...after },
      children: children.map((child) => ({
        ...child,
        position: { ...child.position },
      })),
    };
    const snapshot = JSON.stringify(input);
    compensateChildPositions(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
