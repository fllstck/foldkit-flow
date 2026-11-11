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
 * - A cycle in the parent chain stops at the node the walk re-enters: placement of
 *   a cyclic graph is not meaningful, but the walk terminates.
 * - **There is no depth limit.** The walk is bounded by the graph's own size, so a
 *   deep container layout resolves exactly and the result does not depend on the
 *   order the nodes appear in (M4-REVIEW 4).
 */
export type PositionIndex = ReadonlyMap<string, Point>;

/** Twelve levels of nesting is far beyond any container layout, and a chain
const offset = (origin: Point, position: Point): Point => ({
  x: origin.x + position.x,
  y: origin.y + position.y,
});


/**
 * One walk up a node's parent chain, as a value rather than a loop: `path` is the
 * chain discovered so far (nearest first), `current` is the node whose parent is
 * about to be visited, and `done` freezes the walk once it has an answer.
 *
 * The ceiling is `nodes.length`, not a fixed depth. A chain cannot be longer than
 * the graph, so this is a bound on the walk, not on valid nesting — a 40-level
 * container layout resolves exactly, and an order that lists children before
 * parents resolves exactly too, because `resolved` is checked at every step
 * (M4-REVIEW 4).
 */
const offset = (origin: Point, position: Point): Point => ({
  x: origin.x + position.x,
  y: origin.y + position.y,
});

type Walk<NodeData> = Readonly<{
  path: ReadonlyArray<FlowNode<NodeData>>;
  current: FlowNode<NodeData> | undefined;
  done: boolean;
}>;

const advance = <NodeData>(
  byId: ReadonlyMap<string, FlowNode<NodeData>>,
  resolved: Map<string, Point>,
  walk: Walk<NodeData>,
): Walk<NodeData> => {
  if (walk.done || walk.current === undefined) return walk;

  const node = walk.current;
  const parent =
    node.parentId === undefined ? undefined : byId.get(node.parentId);
  if (parent === undefined || resolved.has(parent.id)) {
    // The chain ends at a root (its own position is absolute) or at an ancestor
    // an earlier walk already placed.
    return { path: walk.path, current: parent, done: true };
  }
  if (walk.path.some((entry) => entry.id === parent.id)) {
    // A cycle: stop where it closes. Placement of a cyclic graph is not
    // meaningful, but it terminates and is deterministic from the walk's start.
    return { path: [...walk.path, parent], current: undefined, done: true };
  }

  return { path: [...walk.path, parent], current: parent, done: false };
};

const buildIndex = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): PositionIndex => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const resolved: Map<string, Point> = new Map();

  nodes.forEach((start) => {
    if (resolved.has(start.id)) return;

    const initial: Walk<NodeData> = {
      path: [start],
      current: start,
      done: false,
    };
    const walk = Arr.range(0, nodes.length).reduce(
      (current) => advance(byId, resolved, current),
      initial,
    );

    // The base is the resolved ancestor the chain reached, or the origin when the
    // chain ended at a root: a root's absolute position is then its own position,
    // and every node below it adds its offset on the way back down.
    const base =
      walk.current === undefined
        ? { x: 0, y: 0 }
        : (resolved.get(walk.current.id) ?? { x: 0, y: 0 });

    // `path` is nearest-first; positions accumulate from the root down.
    Arr.reverse([...walk.path]).reduce<Point>((origin, node) => {
      if (resolved.has(node.id)) return origin;
      const position = offset(origin, node.position);
      resolved.set(node.id, position);
      return position;
    }, base);
  });

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
  // `byId.size` is the ceiling: a chain cannot be longer than the graph, so this
  // bounds the walk rather than valid nesting (M4-REVIEW 4).
  return Arr.reduce(Arr.range(0, byId.size - 1), start, (ids) => {
    const last = ids[ids.length - 1];
    const parent = last === undefined ? undefined : byId.get(last);
    if (parent === undefined) return ids;
    const next = byId.get(parent.parentId ?? "");
    if (next === undefined || ids.includes(next.id)) return ids;
    return [...ids, next.id];
  });
};

/**
 * `ids` plus every descendant of those ids, in one pass over the graph: the set
 * of nodes a drag of `ids` actually moves (§7 M4). A child's absolute position is
 * built from its parent's, so dragging a parent moves the subtree without the
 * child being dragged itself — and a child must not also be in the *dragged* set,
 * or the delta would be applied twice.
 *
 * The fixed point is reached in at most one round per node, because a descendant
 * is at most `nodes.length` levels from the node that was grabbed — a bound on the
 * iteration, not on valid nesting (M4-REVIEW 4).
 */
export const withDescendants = <NodeData>(
  ids: ReadonlySet<string>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlySet<string> => {
  if (ids.size === 0) return ids;

  const moving = new Set(ids);

  // One round per level of nesting, mutating the local set: a copy per added
  // node would be quadratic on the 10k subtree this exists for.
  Arr.range(0, nodes.length).forEach(() =>
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
