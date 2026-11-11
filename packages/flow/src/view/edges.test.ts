import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import { edgePath } from "../geometry/paths.js";
import type { Message } from "../message.js";
import { Gesture, init } from "../model.js";
import type { FlowEdge, FlowNode, HandleBounds, Model } from "../model.js";
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

// a's source handle is a circle on the right edge, b's target a circle on the
// left edge, as the renderer emits them: node-local, 8×8.
const handleBounds: ReadonlyArray<HandleBounds> = [
  {
    nodeId: "a",
    handleId: Option.some("out"),
    type: "Source",
    position: "Right",
    x: 192,
    y: 16,
    width: 8,
    height: 8,
  },
  {
    nodeId: "b",
    handleId: Option.some("in"),
    type: "Target",
    position: "Left",
    x: -4,
    y: 16,
    width: 8,
    height: 8,
  },
];

const edge: FlowEdge = {
  id: "e1",
  source: "a",
  target: "b",
  sourceHandle: "out",
  targetHandle: "in",
};

/** Reconnect grab rings are opt-in, so the renderer that draws them is its own. */
const renderer = createRenderer({
  paneId: "p",
  renderNode: (n, _t, h) => h.div([], [n.id]),
  reconnect: true,
});

const plainRenderer = createRenderer({
  paneId: "p",
  renderNode: (n, _t, h) => h.div([], [n.id]),
});

const model = (overrides?: Partial<Model>): Model => ({
  ...init().model,
  pane: { width: 800, height: 600, left: 0, top: 0 },
  handleBounds,
  ...overrides,
});

const render = (
  current: Model,
  edges: ReadonlyArray<FlowEdge> = [edge],
  withRings = true,
) =>
  Effect.runPromise(
    Server.renderToString(
      {
        init: () => ({ model: current }),
        view: (state, h) => ({
          title: "edges",
          body: (withRings ? renderer : plainRenderer).view(
            {
              model: state,
              nodes,
              edges,
              toParentMessage: (message: Message) => message,
            },
            h,
          ),
        }),
      },
      { isHydratable: false },
    ),
  );

/** The `d` of the one edge path: the preview, when present, is in a separate
 *  `fflow__connection` layer. */
const edgePathOf = (html: string): string => {
  const match = /<path d="([^"]+)" class="fflow__edge-path"/.exec(html);
  if (match === null) throw new Error("no edge path rendered");
  return match[1] ?? "";
};

describe("edge geometry", () => {
  test("an edge between two measured handles starts and ends at them", async () => {
    const html = (await render(model())).html;

    // a's `out` handle centre is (296,70) with position Right; b's `in` is
    // (400,220) with position Left.
    expect(edgePathOf(html)).toBe(
      edgePath("Bezier", {
        sourceX: 296,
        sourceY: 70,
        sourcePosition: "Right",
        targetX: 400,
        targetY: 220,
        targetPosition: "Left",
      }).d,
    );
  });

  test("an unmeasured graph keeps the node-border anchor", async () => {
    const html = (await render(model({ handleBounds: [] }))).html;

    expect(edgePathOf(html)).toBe(
      edgePath("Bezier", {
        sourceX: 200,
        sourceY: 90,
        sourcePosition: "Bottom",
        targetX: 500,
        targetY: 200,
        targetPosition: "Top",
      }).d,
    );
  });

  test("each edge end carries a reconnect handle", async () => {
    const html = (await render(model())).html;

    // The grab handle is anchored where the path starts and ends, and it opts
    // out of pane panning for the same reason a node does (§M1-FINDINGS §8).
    expect(html).toContain('class="fflow__edge-endpoint fflow__nopan"');
    expect(html).toContain('data-edgeend="Source"');
    expect(html).toContain('cx="296"');
    expect(html).toContain('cy="70"');
    expect(html).toContain('data-edgeend="Target"');
    expect(html).toContain('cx="400"');
    expect(html).toContain('cy="220"');
  });

  test("the rings are opt-in: a renderer without them draws none", async () => {
    const html = (await render(model(), [edge], false)).html;
    expect(html).not.toContain("fflow__edge-endpoint");
    // The path is unaffected: the flag is about the affordance, not geometry.
    expect(edgePathOf(html)).toBe(edgePathOf((await render(model())).html));
  });
});

describe("reconnect preview", () => {
  const reconnecting = (edgeId: string): Model =>
    model({
      gesture: Gesture.Reconnecting({
        pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
        edgeId,
        end: "Target",
        current: { x: 700, y: 500 },
        maybeTarget: Option.none(),
      }),
    });

  test("starts at the end that is not moving", async () => {
    const html = (await render(reconnecting("e1"))).html;
    // The preview renders its path inside the `<g>` that carries the viewport
    // transform (proof 32), so the pattern spans that element.
    const match = /fflow__connection[^>]*>.*?<path d="([^"]+)"/.exec(html);
    if (match === null) throw new Error("no reconnect preview rendered");

    // The source end stays put: a's handle centre, with the handle's position.
    expect(match[1]).toBe(
      edgePath("Bezier", {
        sourceX: 296,
        sourceY: 70,
        sourcePosition: "Right",
        targetX: 700,
        targetY: 500,
        targetPosition: "Top",
      }).d,
    );
  });

  test("no preview for an edge the parent no longer has", async () => {
    const html = (await render(reconnecting("gone"))).html;
    expect(html).not.toContain("fflow__connection");
  });
});

describe("edge geometry during a node drag", () => {
  const dragging = (nodeIds: ReadonlyArray<string>, deltaX: number): Model =>
    model({
      gesture: Gesture.DraggingNodes({
        pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
        nodeIds,
        origin: { x: 0, y: 0 },
        anchor: { x: 0, y: 0 },
        snapGrid: Option.none(),
        delta: { x: deltaX, y: deltaX / 2 },
        hasMoved: true,
      }),
    });

  test("an edge follows the node the overlay is moving", async () => {
    // The parent's positions are untouched until release (§4.5), so the edge has
    // to apply the same delta the wrapper applies — otherwise it hangs behind.
    const html = (await render(dragging(["b"], 40))).html;

    expect(edgePathOf(html)).toBe(
      edgePath("Bezier", {
        sourceX: 296,
        sourceY: 70,
        sourcePosition: "Right",
        targetX: 440,
        targetY: 240,
        targetPosition: "Left",
      }).d,
    );
  });

  test("only the ends attached to dragged nodes move", async () => {
    // Dragging `a` moves the source end and leaves the target where it is.
    const html = (await render(dragging(["a"], 10))).html;

    expect(edgePathOf(html)).toBe(
      edgePath("Bezier", {
        sourceX: 306,
        sourceY: 75,
        sourcePosition: "Right",
        targetX: 400,
        targetY: 220,
        targetPosition: "Left",
      }).d,
    );
  });

  test("an edge between two untouched nodes is unchanged", async () => {
    const still = edgePathOf((await render(model())).html);
    const dragged = edgePathOf(
      (await render(dragging(["elsewhere"], 40))).html,
    );
    expect(dragged).toBe(still);
  });
});
