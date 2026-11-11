import { describe, expect, test } from "vitest";

import { init } from "../model.js";
import type { Model } from "../model.js";
import { fitViewport } from "./fit.js";

const node = (
  id: string,
  x: number,
  y: number,
  size?: { width: number; height: number },
) => ({
  id,
  position: { x, y },
  ...(size === undefined ? {} : { size }),
  data: null,
});

/** A 1000×800 pane showing flow space 1:1 from the origin. */
const model = (overrides?: Partial<Model>): Model => ({
  ...init().model,
  pane: { width: 1000, height: 800, left: 0, top: 0 },
  ...overrides,
});

/** One 100×100 node at (0, 0): the graph's centre is (50, 50), so a fitted
 *  viewport centres that point and leaves 10% padding on each side. */
const square = model();

describe("fitViewport", () => {
  test("centres the graph's bounding box and clamps to the pane", () => {
    const fitted = fitViewport(square, [
      node("a", 0, 0, { width: 100, height: 100 }),
    ]);

    // The smaller of the two padded ratios wins: 800 / 100 = 8 → clamped to the
    // Model's maxZoom (2), and the pane centre lands on the node centre.
    expect(fitted.zoom).toBe(2);
    expect(fitted.x).toBe(500 - 50 * 2);
    expect(fitted.y).toBe(400 - 50 * 2);
  });

  test("padding is a fraction of the pane, and it shrinks the zoom", () => {
    const nodes = [node("a", 0, 0, { width: 2000, height: 100 })];
    const none = fitViewport(square, nodes, 0);
    const generous = fitViewport(square, nodes, 0.5);

    // 0.5 of the pane on each side is 166px of the 1000px width (the engine
    // floors its padding), so the zoom is (1000 - 332) / 2000.
    expect(none.zoom).toBeCloseTo(0.5, 5);
    expect(generous.zoom).toBeCloseTo(0.334, 5);
    expect(generous.zoom).toBeLessThan(none.zoom);
  });

  test("an empty graph returns the current viewport, not a fabricated zoom", () => {
    const current = model({ viewport: { x: 12, y: 34, zoom: 0.75 } });
    expect(fitViewport(current, [])).toEqual({ x: 12, y: 34, zoom: 0.75 });
  });

  test("an unmeasured pane returns the current viewport", () => {
    const unmeasured = model({
      pane: { width: 0, height: 0, left: 0, top: 0 },
      viewport: { x: 5, y: 6, zoom: 1 },
    });
    expect(fitViewport(unmeasured, [node("a", 0, 0)])).toEqual({
      x: 5,
      y: 6,
      zoom: 1,
    });
  });

  test("an unmeasured node is fitted at its size hint, then the fallback", () => {
    const hinted = fitViewport(square, [
      node("a", 0, 0, { width: 100, height: 40 }),
    ]);
    const fallback = fitViewport(square, [node("a", 0, 0)]);

    // 151×40 is `fallbackSize`, which is what the edge paths use too, so the
    // fitted zoom is a fact about the same geometry the renderer drew.
    expect(hinted.zoom).toBe(2);
    expect(fallback.zoom).toBe(2);
    expect(fallback.x).toBe(500 - (151 / 2) * 2);
  });

  test("the Model's zoom bounds are the only clamp", () => {
    const bounded = model({ minZoom: 0.5, maxZoom: 0.75 });
    const fitted = fitViewport(bounded, [
      node("a", 0, 0, { width: 10, height: 10 }),
    ]);
    expect(fitted.zoom).toBe(0.75);

    const floor = fitViewport(model({ minZoom: 0.6, maxZoom: 2 }), [
      node("a", 0, 0, { width: 10000, height: 10000 }),
    ]);
    expect(floor.zoom).toBe(0.6);
  });

  test("two nodes fit together, including the second one's own box", () => {
    const fitted = fitViewport(square, [
      node("a", 0, 0, { width: 100, height: 100 }),
      node("b", 900, 700, { width: 100, height: 100 }),
    ]);

    // The graph is 1000×800 with padding on top, so the padded width exceeds the
    // pane and the zoom drops below 1.
    expect(fitted.zoom).toBeLessThan(1);
    expect(fitted.zoom).toBeGreaterThan(0.1);
  });
});
