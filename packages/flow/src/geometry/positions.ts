import { Array as Arr } from "effect";

import type { FlowNode, Point } from "../model.js";

/**
 * Absolute flow-space position per node id (§7 M4).
 *
 * A child carries a position **relative to its parent** — upstream's model, and
 * the only one where a parent can move without rewriting every descendant's
 * coordinates. Everything in this library that reads a position reads it through
 * this map, so the parent chain is resolved in exactly one place: `nodeRect`,
 * `nodeBounds`, `visibleNodes`, `visibleEdges`, the edge anchors, hit-testing,
 * the drag overlay, the minimap, the description and `fitViewport`.
 *
 * Three rules, and each of them is a bug that would otherwise be silent:
 *
 * - A node with no `parentId` is absolute, so a flat graph pays one map insert
 *   per node and nothing else.
 * - A `parentId` that names no node in the graph resolves as absolute: the
 *   parent's data may be mid-edit, and a child that vanishes because its parent
 *   is missing is worse than one drawn at its own coordinates.
 * - A cycle in the parent chain stops at the node the walk re-enters. Long chains
 *   are fine; `maxParentDepth` bounds a pathological one.
 */
export type PositionIndex = ReadonlyMap<string, Point>;

/** Twelve levels of nesting is far beyond any container layout, and a chain
 *  longer than this is a cycle the visited set missed rather than a real graph. */
export const maxParentDepth = 12;

const offset = (origin: Point, position: Point): Point => ({
  x: origin.x + position.x,
  y: origin.y + position.y,
});

type Resolved = Readonly<{
  resolved: Map<string, Point>;
  visiting: Set<string>;
}>;

/**
 * One node's absolute position, memoized into `state`. Recursion is over the
 * parent chain and bounded twice — by `maxParentDepth` and by `visiting`, which
 * breaks a cycle by taking the re-entered node's own position.
 */
const resolveNode = <NodeData>(
  node: FlowNode<NodeData>,
  byId: ReadonlyMap<string, FlowNode<NodeData>>,
  depth: number,
  state: Resolved,
): Point => {
  const known = state.resolved.get(node.id);
  if (known !== undefined) return known;

  const parent =
    node.parentId === undefined ? undefined : byId.get(node.parentId);
  if (
    parent === undefined ||
    depth >= maxParentDepth ||
    state.visiting.has(node.id)
  ) {
    state.resolved.set(node.id, node.position);
    return node.position;
  }

  const position = offset(
    resolveNode(parent, byId, depth + 1, {
      resolved: state.resolved,
      visiting: new Set([...state.visiting, node.id]),
    }),
    node.position,
  );

  state.resolved.set(node.id, position);
  return position;
};

const buildIndex = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): PositionIndex => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const resolved: Map<string, Point> = new Map();

  nodes.forEach((node) =>
    resolveNode(node, byId, 0, { resolved, visiting: new Set() }),
  );

  return resolved;
};

/**
 * The memo is keyed by the array reference, which Foldkit's frozen Model makes a
 * sound identity for "this graph, unchanged": a parent that edits the graph
 * produces a new array. It is a memo, not state — the same input reference always
 * resolves to the same output — and it keeps the hot paths (a hit test per
 * pointermove, a render per frame) at O(1) after the first call, which is the
 * M2 §2.5 lesson about per-frame graph scans applied to positions.
 */
const indexMemo: WeakMap<
  ReadonlyArray<FlowNode<unknown>>,
  PositionIndex
> = new WeakMap();

export const positionIndex = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): PositionIndex => {
  // SAFETY: the memo is keyed by reference only; the element type never reaches
  // the stored value, which is a plain `Map<string, Point>`.
  const key = nodes as ReadonlyArray<FlowNode<unknown>>;
  const cached = indexMemo.get(key);
  if (cached !== undefined) return cached;

  const built = buildIndex(nodes);
  indexMemo.set(key, built);
  return built;
};

/** A node's absolute position in flow space. */
export const positionOf = <NodeData>(
  node: FlowNode<NodeData>,
  index: PositionIndex,
): Point => index.get(node.id) ?? node.position;

/**
 * The chain a node's movement comes from: itself first, then its ancestors. A
 * drag of `a` moves `b` (a child of `a`) too, because `b`'s absolute position is
 * built from `a`'s.
 */
export const ancestorIds = <NodeData>(
  node: FlowNode<NodeData>,
  byId: ReadonlyMap<string, FlowNode<NodeData>>,
): ReadonlyArray<string> => {
  const start: ReadonlyArray<string> = [node.id];
  const chain = Arr.reduce(Arr.range(0, maxParentDepth - 1), start, (ids) => {
    const last = ids[ids.length - 1];
    const parent = last === undefined ? undefined : byId.get(last);
    if (parent === undefined) return ids;
    const next = byId.get(parent.parentId ?? "");
    if (next === undefined || ids.includes(next.id)) return ids;
    return [...ids, next.id];
  });

  return chain;
};

/**
 * `ids` plus every descendant of those ids, in one pass over the graph: the set
 * of nodes a drag of `ids` actually moves (§7 M4). A child's absolute position is
 * built from its parent's, so dragging a parent moves the subtree without the
 * child being dragged itself — and a child must not also be in the *dragged* set,
 * or the delta would be applied twice.
 *
 * The fixed point is reached in at most `maxParentDepth` rounds, because a
 * descendant is at most that far from the node that was grabbed.
 */
export const withDescendants = <NodeData>(
  ids: ReadonlySet<string>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlySet<string> => {
  if (ids.size === 0) return ids;

  const moving = new Set(ids);

  // One round per level of nesting, mutating the local set: a copy per added
  // node would be quadratic on the 10k subtree this exists for.
  Arr.range(0, maxParentDepth - 1).forEach(() =>
    nodes.forEach((node) => {
      const parentId = node.parentId;
      if (
        parentId !== undefined &&
        !moving.has(node.id) &&
        moving.has(parentId)
      ) {
        moving.add(node.id);
      }
    }),
  );

  return moving;
};
