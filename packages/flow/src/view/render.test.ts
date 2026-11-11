import { Effect } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import { Message } from "../message.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode } from "../model.js";
import { createRenderer } from "./view.js";

type Data = Readonly<{ label: string }>;

const nodes: ReadonlyArray<FlowNode<Data>> = [
  {
    id: "a",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
    data: { label: "A" },
  },
  {
    id: "b",
    position: { x: 200, y: 120 },
    size: { width: 100, height: 40 },
    data: { label: "B" },
  },
];

const edges: ReadonlyArray<FlowEdge> = [{ id: "e1", source: "a", target: "b" }];

const renderer = createRenderer<Data, unknown>({
  paneId: "pane-1",
  renderNode: (node, _tools, h) =>
    h.div([h.Class("demo-node")], [node.data.label]),
});

const model = init({ x: 12, y: 34, zoom: 1.5 }).model;

const view = (
  current: typeof model,
  h: Parameters<typeof renderer.view>[1],
) => ({
  title: "M0 render",
  body: h.div(
    [h.Class("root")],
    [
      renderer.view(
        {
          model: current,
          nodes,
          edges,
          toParentMessage: (message: Message) => message,
        },
        h,
      ),
    ],
  ),
});

const render = () =>
  Effect.runPromise(
    Server.renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false },
    ),
  );

describe("static render (proof 1)", () => {
  test("viewport transform comes from the Model", async () => {
    const rendered = await render();
    expect(rendered.html).toContain(
      "transform: translate(12px, 34px) scale(1.5)",
    );
  });

  test("edges are SVG paths with the engine d string", async () => {
    const rendered = await render();
    expect(rendered.html).toContain('d="M50,40 C50,80 250,80 250,120"');
  });

  test("every node renders as a positioned div", async () => {
    const rendered = await render();
    expect(rendered.html).toContain('data-nodeid="a"');
    expect(rendered.html).toContain('data-nodeid="b"');
    expect(rendered.html).toContain("translate(200px, 120px)");
  });
});
