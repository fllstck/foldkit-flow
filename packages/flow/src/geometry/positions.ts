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
 * The resolution is a **downward breadth-first pass**, not a per-node walk up the
 * chain: roots are placed first, then each level is computed from its parent's
 * resolved origin. One visit per node, no depth limit, no recursion, and no
 * dependence on the order the nodes appear in (M4-REVIEW 4, and the flat-graph
 * cost in M4-REVIEW-2) — a 10,000-node flat graph is 10,000 map inserts, and a
 * 40-level chain is 40 rounds over a frontier of one.
 *
 * Three rules, each of which would otherwise be a silent bug:
 *
 * - A node with no `parentId` is absolute.
 * - A `parentId` that names no node in the graph resolves as absolute: the
 *   parent's data may be mid-edit, and a child that vanishes because its parent is
 *   missing is worse than one drawn at its own coordinates.
 * - A node in a parent **cycle** is unreachable from any root, so it keeps its own
 *   position: placement of a cyclic graph is not meaningful, but it terminates and
 *   does not depend on array order.
 */
export type PositionIndex = ReadonlyMap<string, Point>;

const offset = (origin: Point, position: Point): Point => ({
  x: origin.x + position.x,
  y: origin.y + position.y,
});

/** Children grouped by parent id, in one pass over the graph. */
const childrenOf = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyMap<string, ReadonlyArray<FlowNode<NodeData>>> => {
  const children = new Map<string, Array<FlowNode<NodeData>>>();

  nodes.forEach((node) => {
    const parentId = node.parentId;
    if (parentId === undefined) return;
    const bucket = children.get(parentId);
    if (bucket === undefined) children.set(parentId, [node]);
    else bucket.push(node);
  });

  return children;
};

/**
 * Every id reachable from `roots` by following children, including the roots.
 *
 * One frontier expansion per level of nesting, and an empty frontier costs one
 * no-op round — so a flat graph finishes in one round and does not pay for the
 * `nodes.length` ceiling (M4-REVIEW-2). The same helper answers `hidden`'s
 * "every descendant of a collapsed node" and a drag's "every node that moves with
 * the one you grabbed", so the two cannot disagree about what a subtree is.
 */
const closureDown = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
  roots: Iterable<string>,
): ReadonlySet<string> => {
  const children = childrenOf(nodes);
  const reached = new Set(roots);

  Arr.range(0, nodes.length).reduce<ReadonlyArray<string>>(
    (frontier) => {
      if (Arr.isReadonlyArrayEmpty(frontier)) return frontier;

      const next: Array<string> = [];
      frontier.forEach((nodeId) =>
        (children.get(nodeId) ?? []).forEach((child) => {
          if (reached.has(child.id)) return;
          reached.add(child.id);
          next.push(child.id);
        }),
      );

      return next;
    },
    [...reached],
  );

  return reached;
};

/** Roots first, then one round per level of nesting. */
const buildIndex = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): PositionIndex => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const children = childrenOf(nodes);
  const positions: Map<string, Point> = new Map();

  const roots = nodes.filter(
    (node) => node.parentId === undefined || !byId.has(node.parentId),
  );
  roots.forEach((root) => positions.set(root.id, root.position));

  Arr.range(0, nodes.length).reduce<ReadonlyArray<FlowNode<NodeData>>>(
    (frontier) => {
      if (Arr.isReadonlyArrayEmpty(frontier)) return frontier;

      const next: Array<FlowNode<NodeData>> = [];
      frontier.forEach((parent) => {
        const origin = positions.get(parent.id) ?? parent.position;
        (children.get(parent.id) ?? []).forEach((child) => {
          if (positions.has(child.id)) return;
          positions.set(child.id, offset(origin, child.position));
          next.push(child);
        });
      });

      return next;
    },
    roots,
  );

  // Unreachable from a root means a parent cycle: place it where it says it is.
  nodes.forEach((node) => {
    if (!positions.has(node.id)) positions.set(node.id, node.position);
  });

  return positions;
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
 * The chain a node's movement comes from: itself first, then its ancestors.
 *
 * Only used for a press (`hasDraggedAncestor`) and for tests, so it walks
 * recursively and costs one step per level — it is not on a per-frame path, and it
 * is not what resolves positions (that is `positionIndex`). A cycle stops at the
 * node the walk re-enters; the recursion is therefore bounded by the chain length.
 */
export const ancestorIds = <NodeData>(
  node: FlowNode<NodeData>,
  byId: ReadonlyMap<string, FlowNode<NodeData>>,
): ReadonlyArray<string> => {
  const walk = (
    current: FlowNode<NodeData>,
    seen: ReadonlySet<string>,
  ): ReadonlyArray<string> => {
    const parent =
      current.parentId === undefined ? undefined : byId.get(current.parentId);
    if (parent === undefined || seen.has(parent.id)) return [];
    return [parent.id, ...walk(parent, new Set([...seen, parent.id]))];
  };

  return [node.id, ...walk(node, new Set([node.id]))];
};

/**
 * `ids` plus every descendant of those ids: the set of nodes a drag of `ids`
 * actually moves (§7 M4). A child's absolute position is built from its parent's,
 * so dragging a parent moves the subtree without the child being dragged itself —
 * and a child must not also be in the *dragged* set, or the delta would be applied
 * twice.
 */
export const withDescendants = <NodeData>(
  ids: ReadonlySet<string>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlySet<string> => (ids.size === 0 ? ids : closureDown(nodes, ids));
