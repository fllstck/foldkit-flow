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

const buildIndex = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): PositionIndex => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const resolved: Map<string, Point> = new Map();
  const visiting = new Set<string>();

  const resolve = (node: FlowNode<NodeData>, depth: number): Point => {
    const known = resolved.get(node.id);
    if (known !== undefined) return known;

    const parent =
      node.parentId === undefined ? undefined : byId.get(node.parentId);
    // `visiting` breaks a cycle: the node already being resolved contributes its
    // own position, so the walk terminates with a placed, not a missing, node.
    if (
      parent === undefined ||
      depth >= maxParentDepth ||
      visiting.has(node.id)
    ) {
      resolved.set(node.id, node.position);
      return node.position;
    }

    visiting.add(node.id);
    const position = offset(resolve(parent, depth + 1), node.position);
    visiting.delete(node.id);

    resolved.set(node.id, position);
    return position;
  };

  nodes.forEach((node) => resolve(node, 0));
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
  const ids: Array<string> = [node.id];
  let current = node.parentId;
  let depth = 0;

  while (current !== undefined && depth < maxParentDepth) {
    const parent = byId.get(current);
    if (parent === undefined || ids.includes(parent.id)) break;
    ids.push(parent.id);
    current = parent.parentId;
    depth += 1;
  }

  return ids;
};

/**
 * `ids` plus every descendant of those ids, in one pass over the graph: the set
 * of nodes a drag of `ids` actually moves (§7 M4). A child's absolute position is
 * built from its parent's, so dragging a parent moves the subtree without the
 * child being dragged itself — and a child must not also be in the *dragged* set,
 * or the delta would be applied twice.
 */
export const withDescendants = <NodeData>(
  ids: ReadonlySet<string>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlySet<string> => {
  if (ids.size === 0) return ids;

  const moving = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (moving.has(node.id)) return;
      if (node.parentId !== undefined && moving.has(node.parentId)) {
        moving.add(node.id);
        changed = true;
      }
    });
  }

  return moving;
};
