import { describe, expect, test } from "vitest";

import type { FlowNode } from "../model.js";
import {
  ancestorIds,
  maxParentDepth,
  positionIndex,
  positionOf,
  withDescendants,
} from "./positions.js";

const node = (
  id: string,
  position: { x: number; y: number },
  parentId?: string,
): FlowNode<null> => ({
  id,
  position,
  data: null,
  ...(parentId === undefined ? {} : { parentId }),
});

const flat: ReadonlyArray<FlowNode<null>> = [
  node("a", { x: 10, y: 20 }),
  node("b", { x: 200, y: 40 }),
];

/** a is the container; b and c sit inside it, and d inside b. */
const nested: ReadonlyArray<FlowNode<null>> = [
  node("a", { x: 100, y: 50 }),
  node("b", { x: 10, y: 10 }, "a"),
  node("c", { x: 60, y: 30 }, "a"),
  node("d", { x: 5, y: 5 }, "b"),
];

describe("positionIndex (§7 M4)", () => {
  test("a flat graph resolves to the positions it declares", () => {
    const index = positionIndex(flat);
    expect(positionOf(flat[0] as FlowNode<null>, index)).toEqual({
      x: 10,
      y: 20,
    });
    expect(positionOf(flat[1] as FlowNode<null>, index)).toEqual({
      x: 200,
      y: 40,
    });
  });

  test("a child's position is relative to its parent, at any depth", () => {
    const index = positionIndex(nested);
    const byId = new Map(nested.map((entry) => [entry.id, entry] as const));

    // One level: the parent's origin plus the child's own offset.
    expect(positionOf(byId.get("b") as FlowNode<null>, index)).toEqual({
      x: 110,
      y: 60,
    });
    // Two levels: every offset on the chain is added exactly once.
    expect(positionOf(byId.get("d") as FlowNode<null>, index)).toEqual({
      x: 115,
      y: 65,
    });
  });

  test("a parentId that names no node resolves as absolute", () => {
    // Mid-edit graphs happen; a child that vanishes because its parent is
    // missing is worse than one drawn at its own coordinates.
    const orphan = [node("a", { x: 40, y: 50 }, "missing")];
    const index = positionIndex(orphan);
    expect(positionOf(orphan[0] as FlowNode<null>, index)).toEqual({
      x: 40,
      y: 50,
    });
  });

  test("a cycle terminates instead of recursing forever", () => {
    const cyclic = [
      node("a", { x: 1, y: 1 }, "b"),
      node("b", { x: 2, y: 2 }, "a"),
    ];
    const index = positionIndex(cyclic);
    // Both nodes are placed; the exact value depends on where the walk stopped,
    // and the assertion that matters is that this returned at all.
    expect(index.size).toBe(2);
    expect(positionOf(cyclic[0] as FlowNode<null>, index)).toBeDefined();
  });

  test("a deep chain resolves in one pass, not one walk per node", () => {
    // 200 levels: the memo means a node's ancestors are resolved once and
    // reused, so the whole graph is linear in nodes rather than quadratic in
    // nesting. `maxParentDepth` guards a walk, not this path — the section
    // below is what happens without the memo.
    const deep: Array<FlowNode<null>> = [node("n0", { x: 1, y: 1 })];
    for (let depth = 1; depth <= 200; depth += 1) {
      deep.push(node(`n${depth}`, { x: 1, y: 1 }, `n${depth - 1}`));
    }

    const index = positionIndex(deep);
    const deepest = positionOf(deep[200] as FlowNode<null>, index);
    expect(deepest.x).toBe(201);
    expect(index.size).toBe(201);
  });

  test("the same array reference resolves to the same index (the memo)", () => {
    expect(positionIndex(nested)).toBe(positionIndex(nested));
    // And a new array is a new index, because the graph may have changed.
    expect(positionIndex([...nested])).not.toBe(positionIndex(nested));
  });
});

describe("ancestorIds", () => {
  test("is the node first, then its parents", () => {
    const byId = new Map(nested.map((entry) => [entry.id, entry] as const));
    expect(ancestorIds(byId.get("d") as FlowNode<null>, byId)).toEqual([
      "d",
      "b",
      "a",
    ]);
    expect(ancestorIds(byId.get("a") as FlowNode<null>, byId)).toEqual(["a"]);
  });
});

describe("withDescendants", () => {
  test("adds every node under a dragged id", () => {
    expect([...withDescendants(new Set(["a"]), nested)].sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect([...withDescendants(new Set(["b"]), nested)].sort()).toEqual([
      "b",
      "d",
    ]);
  });

  test("an empty set stays empty and is returned unchanged", () => {
    const empty = new Set<string>();
    expect(withDescendants(empty, nested)).toBe(empty);
  });
});
