import { describe, expect, test } from "vitest";

import { Message } from "./message.js";
import { init } from "./model.js";
import type { Context } from "./model.js";
import { update } from "./update.js";

const context: Context = { nodes: [], edges: [] };
const initial = init({ x: 20, y: 30, zoom: 0.9 }).model;

describe("Flow.update viewport commit", () => {
  test("MovedViewport writes the terminal viewport", () => {
    const viewport = { x: -200, y: -100, zoom: 1.25 };
    const next = update(
      initial,
      Message.MovedViewport({ viewport, isGestureEnd: true }),
      context,
    );
    expect(next.model.viewport).toEqual(viewport);
  });

  test("CompletedSyncViewport commits the viewport reported by the command", () => {
    const viewport = { x: -200, y: -100, zoom: 1.25 };
    const next = update(
      initial,
      Message.CompletedSyncViewport({ viewport }),
      context,
    );
    expect(next.model.viewport).toEqual(viewport);
  });

  test("MeasuredNode replaces that node's size instead of appending", () => {
    const measured = update(
      initial,
      Message.MeasuredNode({
        nodeId: "n1",
        size: { width: 150, height: 36 },
      }),
      context,
    );
    const remeasured = update(
      measured.model,
      Message.MeasuredNode({
        nodeId: "n1",
        size: { width: 160, height: 40 },
      }),
      context,
    );
    expect(remeasured.model.nodeSizes).toEqual([
      { nodeId: "n1", width: 160, height: 40 },
    ]);
  });
});
