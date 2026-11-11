import { describe, expect, test } from "vitest";

import { init } from "../model.js";
import type { Model } from "../model.js";
import { viewportRect, visibleRegion } from "./visible.js";

const model = (overrides?: Partial<Model>): Model => ({
  ...init().model,
  pane: { width: 900, height: 600, left: 0, top: 0 },
  ...overrides,
});

describe("viewportRect", () => {
  test("is the pane's box in flow space, with no overscan", () => {
    expect(viewportRect(model())).toEqual({
      left: 0,
      top: 0,
      width: 900,
      height: 600,
    });
  });

  test("follows the viewport transform", () => {
    // Panned by (-200, -100) at zoom 2: the view starts 100 flow units right of
    // the origin and shows half as much of the graph.
    expect(
      viewportRect(model({ viewport: { x: -200, y: -100, zoom: 2 } })),
    ).toEqual({ left: 100, top: 50, width: 450, height: 300 });
  });

  test("visibleRegion is exactly one screen of overscan around it", () => {
    // The two cannot disagree about where the view is, which is the trap the
    // minimap would otherwise fall into by reusing the culling region.
    const view = viewportRect(model({ viewport: { x: 40, y: 60, zoom: 1.5 } }));
    expect(
      visibleRegion(model({ viewport: { x: 40, y: 60, zoom: 1.5 } })),
    ).toEqual({
      left: view.left - view.width,
      top: view.top - view.height,
      width: view.width * 3,
      height: view.height * 3,
    });
  });
});
