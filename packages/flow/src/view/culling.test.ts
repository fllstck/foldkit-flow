import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import type { Message } from "../message.js";
import { Gesture, init } from "../model.js";
import type { FlowNode, Model } from "../model.js";
import { createRenderer } from "./view.js";

const node = (id: string, x: number, y: number): FlowNode => ({
  id,
  position: { x, y },
  size: { width: 150, height: 40 },
  data: null,
});

// The pane shows flow x ∈ [-1000, 1000] × y ∈ [-700, 700]; culling adds one
// screen of overscan on every side, so the rendered region reaches x = 2000.
const pane = { width: 900, height: 600, left: 0, top: 0 };
const viewport = { x: 0, y: 0, zoom: 1 };

const inside = node("inside", 100, 100);
const overscan = node("overscan", 1500, 100);
const beyond = node("beyond", 4000, 100);

const renderer = createRenderer({
  paneId: "culled",
  cull: true,
  renderNode: (current, _tools, h) => h.div([h.Class("body")], [current.id]),
});

const render = async (
  model: Model,
  nodes: ReadonlyArray<FlowNode>,
): Promise<string> =>
  (
    await Effect.runPromise(
      Server.renderToString(
        {
          init: () => ({ model }),
          view: (current, h) => ({
            title: "culling",
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
    )
  ).html;

const base: Model = {
  ...init(viewport).model,
  pane,
};

const renderedIds = (html: string): ReadonlyArray<string> =>
  ["inside", "overscan", "beyond"].filter((id) =>
    html.includes(`data-nodeid="${id}"`),
  );

const dragging = (model: Model, nodeIds: ReadonlyArray<string>): Model => ({
  ...model,
  gesture: Gesture.DraggingNodes({
    pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
    nodeIds,
    origin: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    snapGrid: Option.none(),
    delta: { x: 3000, y: 0 },
    hasMoved: true,
  }),
});

describe("culling", () => {
  test("renders the viewport plus one screen of overscan", async () => {
    const html = await render(base, [inside, overscan, beyond]);
    expect(renderedIds(html)).toEqual(["inside", "overscan"]);
  });

  test("a dragged node stays rendered while its graph position is outside", async () => {
    // The overlay moves a node without touching its graph position, so culling
    // and the drag overlay disagree about where the node is. A node under an
    // active drag must not disappear from under the pointer that owns it.
    const html = await render(dragging(base, ["beyond"]), [
      inside,
      overscan,
      beyond,
    ]);
    expect(renderedIds(html)).toEqual(["inside", "overscan", "beyond"]);
  });

  test("an idle node outside the region stays culled", async () => {
    const html = await render({ ...base, selectedNodeIds: ["beyond"] }, [
      inside,
      beyond,
    ]);
    expect(renderedIds(html)).toEqual(["inside"]);
  });

  test("an edge carried by a dragged node is rendered with it", async () => {
    const wide = createRenderer({
      paneId: "culled-edges",
      cull: true,
      renderNode: (_current, _tools, h) => h.div([], []),
    });

    const html = (
      await Effect.runPromise(
        Server.renderToString(
          {
            init: () => ({ model: dragging(base, ["beyond"]) }),
            view: (current, h) => ({
              title: "culling",
              body: wide.view(
                {
                  model: current,
                  nodes: [inside, beyond],
                  edges: [
                    { id: "e-inside", source: "inside", target: "inside" },
                    { id: "e-dragged", source: "beyond", target: "beyond" },
                  ],
                  toParentMessage: (message: Message) => message,
                },
                h,
              ),
            }),
          },
          { isHydratable: false },
        ),
      )
    ).html;

    expect(html).toContain('data-edgeid="e-inside"');
    expect(html).toContain('data-edgeid="e-dragged"');
  });
});
