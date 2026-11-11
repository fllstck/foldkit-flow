import { describe, expect, test } from "vitest";

import { init } from "../model.js";
import type { FlowEdge, FlowNode, Model } from "../model.js";
import { hiddenIds } from "./hidden.js";
import { shownNodes, visibleEdges, visibleNodes } from "./visible.js";

const node = (
  id: string,
  position: { x: number; y: number },
  extra?: { parentId?: string; hidden?: boolean },
): FlowNode<null> => ({
  id,
  position,
  data: null,
  ...extra,
});

/** `a` is an open container holding `b`; `c` is a collapsed one holding `d`. */
const graph: ReadonlyArray<FlowNode<null>> = [
  node("a", { x: 0, y: 0 }, { hidden: false }),
  node("b", { x: 20, y: 20 }, { parentId: "a" }),
  node("c", { x: 400, y: 0 }, { hidden: true }),
  node("d", { x: 10, y: 10 }, { parentId: "c" }),
  node("e", { x: 800, y: 0 }),
];

const edges: ReadonlyArray<FlowEdge> = [
  { id: "e-ab", source: "a", target: "b" },
  { id: "e-cd", source: "c", target: "d" },
  { id: "e-de", source: "d", target: "e" },
  { id: "e-ae", source: "a", target: "e" },
];

const model = (overrides?: Partial<Model>): Model => ({
  ...init().model,
  pane: { width: 4000, height: 4000, left: 0, top: 0 },
  ...overrides,
});

describe("hiddenIds (§7 M4)", () => {
  test("a hidden node is hidden, and so is everything under it", () => {
    // "Collapsed", not "not drawn": a container's children have no visible cause
    // once the container is gone, so they go with it.
    expect([...hiddenIds(graph)].sort()).toEqual(["c", "d"]);
  });

  test("an open container keeps its children", () => {
    expect(hiddenIds(graph).has("b")).toBe(false);
  });

  test("a hidden grandchild does not hide its ancestors", () => {
    const nested = [
      node("a", { x: 0, y: 0 }),
      node("b", { x: 0, y: 0 }, { parentId: "a" }),
      node("c", { x: 0, y: 0 }, { parentId: "b", hidden: true }),
    ];
    expect([...hiddenIds(nested)]).toEqual(["c"]);
  });

  test("the set is memoized on the graph array", () => {
    expect(hiddenIds(graph)).toBe(hiddenIds(graph));
    expect(hiddenIds([...graph])).not.toBe(hiddenIds(graph));
  });
});

describe("collapsing is reductive at every zoom", () => {
  test("a hidden subtree is not visible even with the whole graph in view", () => {
    const visible = visibleNodes(model(), graph).map((entry) => entry.id);
    expect(visible).toEqual(["a", "b", "e"]);
  });

  test("collapsing applies with culling irrelevant to the answer", () => {
    // The same graph seen through a tiny pane: culling removes `e`, collapsing
    // still removes `c` and `d`.
    const narrow = visibleNodes(
      model({ pane: { width: 100, height: 100, left: 0, top: 0 } }),
      graph,
    ).map((entry) => entry.id);
    expect(narrow).toEqual(["a", "b"]);
  });

  test("shownNodes is the graph without collapsing and without culling", () => {
    expect(shownNodes(graph).map((entry) => entry.id)).toEqual(["a", "b", "e"]);
  });

  test("an edge with a collapsed end is not drawn", () => {
    const visible = visibleEdges(model(), edges, graph).map((edge) => edge.id);
    // `e-cd` has two collapsed ends and `e-de` one; both are drawn from nodes
    // the canvas refuses to render.
    expect(visible).toEqual(["e-ab", "e-ae"]);
  });
});
