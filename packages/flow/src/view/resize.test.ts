import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import { Message } from "../message.js";
import { Gesture, init } from "../model.js";
import type { FlowNode, Model } from "../model.js";
import { createRenderer } from "./view.js";

type Data = Readonly<{ label: string }>;

const sized: ReadonlyArray<FlowNode<Data>> = [
  {
    id: "a",
    position: { x: 10, y: 20 },
    // The flow draws this box when resizing is enabled, which is how a persisted
    // resize survives the render after the gesture.
    size: { width: 120, height: 60 },
    data: { label: "A" },
  },
  {
    id: "b",
    position: { x: 300, y: 20 },
    data: { label: "B" },
  },
];

const model = init().model;

const render = (
  current: Model,
  resize: boolean,
  nodes: ReadonlyArray<FlowNode<Data>> = sized,
) => {
  const renderer = createRenderer<Data, unknown>({
    paneId: "pane-resize",
    renderNode: (node, _tools, h) =>
      h.div([h.Class("demo-node")], [node.data.label]),
    resize,
  });

  return Effect.runPromise(
    Server.renderToString(
      {
        init: () => ({ model: current }),
        view: (state, h) => ({
          title: "resize",
          body: renderer.view(
            {
              model: state,
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
};

const resizing = (
  current: Model,
  box: { left: number; top: number; width: number; height: number },
): Model => ({
  ...current,
  gesture: Gesture.Resizing({
    pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
    nodeId: "a",
    control: "bottom-right",
    start: { left: 10, top: 20, width: 120, height: 60 },
    current: box,
    snapGrid: Option.none(),
  }),
});

describe("resize handles (§7 M4)", () => {
  test("no handles unless the renderer opts in", async () => {
    const rendered = await render(model, false);
    expect(rendered.html).not.toContain("fflow__resize");
  });

  test("four corner handles, each named by its control", async () => {
    const rendered = await render(model, true);
    ["top-left", "top-right", "bottom-right", "bottom-left"].forEach(
      (control) => {
        expect(rendered.html).toContain(`data-resize="${control}"`);
      },
    );
    // The edge midpoints belong to the port handles: a resize control there
    // would swallow the press that starts a connection (§7 M4).
    ["top", "right", "bottom", "left"].forEach((control) => {
      expect(rendered.html).not.toContain(`data-resize="${control}"`);
    });
    // A handle press is chrome: it must not pan the pane and must not arm a node
    // drag, or one press would resize *and* start a drag.
    expect(rendered.html).toContain("fflow__nopan fflow__nodrag");
  });

  test("the flow draws a declared size as the node's box", async () => {
    const rendered = await render(model, true);
    expect(rendered.html).toContain("width: 120px; height: 60px");
    // A node with no declared size stays auto: it is measured, not boxed.
    const withoutSize = await render(model, true, [
      { id: "b", position: { x: 0, y: 0 }, data: { label: "B" } },
    ]);
    expect(withoutSize.html).not.toContain("height: 60px");
  });

  test("the live gesture's box overrides the declared one", async () => {
    const rendered = await render(
      resizing(model, { left: 10, top: 20, width: 200, height: 90 }),
      true,
    );
    expect(rendered.html).toContain("width: 200px; height: 90px");
    expect(rendered.html).not.toContain("width: 120px");
  });

  test("a resize from the top-left moves the node as it grows", async () => {
    const rendered = await render(
      resizing(model, { left: 4, top: 8, width: 126, height: 72 }),
      true,
    );
    expect(rendered.html).toContain("translate(4px, 8px)");
  });

  test("an edge attached to the resized node follows its origin shift", async () => {
    const renderer = createRenderer<Data, unknown>({
      paneId: "pane-resize-edge",
      renderNode: (_node, _tools, h) => h.div([], []),
      resize: true,
    });
    const nodes: ReadonlyArray<FlowNode<Data>> = [
      sized[0] as FlowNode<Data>,
      sized[1] as FlowNode<Data>,
    ];

    const rendered = await Effect.runPromise(
      Server.renderToString(
        {
          init: () => ({
            model: resizing(model, {
              left: 14,
              top: 10,
              width: 116,
              height: 70,
            }),
          }),
          view: (state, h) => ({
            title: "resize-edge",
            body: renderer.view(
              {
                model: state,
                nodes,
                edges: [{ id: "e1", source: "a", target: "b" }],
                toParentMessage: (message: Message) => message,
              },
              h,
            ),
          }),
        },
        { isHydratable: false },
      ),
    );

    // Without the shift the source anchor would be (70, 80) — the committed
    // box — and the edge would lag the node for the whole gesture.
    expect(rendered.html).toContain("M74,70 C");
  });
});
