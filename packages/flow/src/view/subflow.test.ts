import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import { Message } from "../message.js";
import { Gesture, init } from "../model.js";
import type { FlowEdge, FlowNode, Model } from "../model.js";
import { createRenderer } from "./view.js";

type Data = Readonly<{ label: string }>;

/** `parent` is a container at (100, 50); `child` sits at (10, 10) inside it, so
 *  its absolute origin is (110, 60). `outside` is a plain node at (400, 300). */
const nodes: ReadonlyArray<FlowNode<Data>> = [
  {
    id: "parent",
    position: { x: 100, y: 50 },
    size: { width: 300, height: 200 },
    data: { label: "Parent" },
  },
  {
    id: "child",
    position: { x: 10, y: 10 },
    size: { width: 100, height: 40 },
    parentId: "parent",
    data: { label: "Child" },
  },
  {
    id: "outside",
    position: { x: 400, y: 300 },
    size: { width: 100, height: 40 },
    data: { label: "Outside" },
  },
];

const edges: ReadonlyArray<FlowEdge> = [
  { id: "e-child", source: "child", target: "outside" },
];

const renderer = createRenderer<Data, unknown>({
  paneId: "pane-sub",
  renderNode: (node, _tools, h) =>
    h.div([h.Class("demo-node")], [node.data.label]),
});

const model = init({ x: 0, y: 0, zoom: 1 }).model;

const render = (current: Model = model, graph = nodes, links = edges) =>
  Effect.runPromise(
    Server.renderToString(
      {
        init: () => ({ model: current }),
        view: (state, h) => ({
          title: "sub-flow",
          body: h.div(
            [h.Class("root")],
            [
              renderer.view(
                {
                  model: state,
                  nodes: graph,
                  edges: links,
                  toParentMessage: (message: Message) => message,
                },
                h,
              ),
            ],
          ),
        }),
      },
      { isHydratable: false },
    ),
  );

const dragging = (
  nodeIds: ReadonlyArray<string>,
  delta: { x: number; y: number },
) => ({
  ...model,
  gesture: Gesture.DraggingNodes({
    pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
    nodeIds,
    origin: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    snapGrid: Option.none(),
    delta,
    hasMoved: true,
  }),
});

describe("parent/child positions (§7 M4)", () => {
  test("a child renders at its parent's origin plus its own offset", async () => {
    const rendered = await render();
    expect(rendered.html).toContain("translate(100px, 50px)");
    // (100 + 10, 50 + 10) — not the relative (10, 10).
    expect(rendered.html).toContain("translate(110px, 60px)");
  });

  test("an edge from a child anchors where the child is drawn", async () => {
    const rendered = await render();
    // The child's border anchor: bottom centre of (110, 60) + 100×40 =
    // (160, 100), leaving downwards to the target's top centre (450, 300).
    expect(rendered.html).toContain("M160,100 C160,200 450,200 450,300");
    // The bug this replaces: the same anchor at the relative (10, 10) → (60, 50).
    expect(rendered.html).not.toContain("M60,50 C");
  });

  test("dragging a parent moves its children without dragging them", async () => {
    const rendered = await render(dragging(["parent"], { x: 30, y: 20 }));
    // The parent is drawn at its origin plus the delta…
    expect(rendered.html).toContain("translate(130px, 70px)");
    // …and the child follows, because its absolute position is built from the
    // parent's, even though only `parent` is in the gesture's node list.
    expect(rendered.html).toContain("translate(140px, 80px)");
  });

  test("dragging a child moves only the child", async () => {
    const rendered = await render(dragging(["child"], { x: 30, y: 20 }));
    expect(rendered.html).toContain("translate(100px, 50px)");
    expect(rendered.html).toContain("translate(140px, 80px)");
  });
});

describe("hidden collapsing (§7 M4)", () => {
  const collapsed = (hiddenId: string, graph = nodes) =>
    graph.map((node) =>
      node.id === hiddenId ? { ...node, hidden: true } : node,
    );

  test("a collapsed container is not rendered", async () => {
    const rendered = await render(model, collapsed("parent"));
    expect(rendered.html).not.toContain('data-nodeid="parent"');
    // …and neither is anything under it: "collapsed", not "not drawn".
    expect(rendered.html).not.toContain('data-nodeid="child"');
    expect(rendered.html).toContain('data-nodeid="outside"');
  });

  test("the edges of a collapsed subtree are not rendered", async () => {
    const rendered = await render(model, collapsed("parent"));
    expect(rendered.html).not.toContain('data-edgeid="e-child"');
  });

  test("the description describes what is shown, not the collapsed edges (M4-REVIEW 3)", async () => {
    // The group is collapsed, so its child — and the edge out of it — are not on
    // the canvas; the accessibility description must agree with the picture.
    const rendered = await render(model, collapsed("parent"));
    // `parent` and its child are gone, so only `outside` is left — and the edge
    // that left the collapsed subtree is not counted.
    expect(rendered.html).toContain("Flow graph: 1 nodes and 0 connections.");
    expect(rendered.html).not.toContain("Child");
  });

  test("collapsing is not culling: it applies with culling off", async () => {
    // This renderer is unculled, so the assertion above is about `hidden` alone.
    const rendered = await render(model, collapsed("child"));
    expect(rendered.html).toContain('data-nodeid="parent"');
    expect(rendered.html).not.toContain('data-nodeid="child"');
  });
});
