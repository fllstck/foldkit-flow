import type { FlowNode, Rect } from "../model.js";
import type { Model, NodeSize, Size } from "../model.js";
import { positionIndex, positionOf } from "./positions.js";
import type { PositionIndex } from "./positions.js";

/** Used for edge paths and culling before the node Mount has measured a box. */
export const fallbackSize: Size = { width: 151, height: 40 };

/**
 * Measured sizes by node id, memoized on the `nodeSizes` array's reference —
 * the same shape as `positionIndex`, and for the same reason: a measurement
 * commits by replacing the array, so identity is a sound "unchanged".
 *
 * Without it `nodeSizeOf` is a linear `find`, and a culling scan is
 * O(N × measured): 2.8–3.9 ms at 625 nodes and 6.2–6.8 ms at 1k, about a third
 * of a 16.7 ms frame, with every edge's two endpoints paying the same find
 * again (M4-FINDINGS §6, §7). The first entry wins, as `find`'s did.
 *
 * The stored `Size` is handed out as-is, so callers treat it as read-only — the
 * rule the Model's own sizes already follow.
 */
const sizeMemo: WeakMap<
  ReadonlyArray<NodeSize>,
  ReadonlyMap<string, Size>
> = new WeakMap();

const buildSizeIndex = (
  nodeSizes: ReadonlyArray<NodeSize>,
): ReadonlyMap<string, Size> => {
  const index = new Map<string, Size>();
  nodeSizes.forEach((size) => {
    if (!index.has(size.nodeId)) {
      index.set(size.nodeId, { width: size.width, height: size.height });
    }
  });
  return index;
};

const sizeIndexOf = (
  nodeSizes: ReadonlyArray<NodeSize>,
): ReadonlyMap<string, Size> => {
  const cached = sizeMemo.get(nodeSizes);
  if (cached !== undefined) return cached;

  const built = buildSizeIndex(nodeSizes);
  sizeMemo.set(nodeSizes, built);
  return built;
};

/**
 * Measured size → the node's own size hint → the shared fallback.
 *
 * The signature is the public one (`Flow.nodeSizeOf`), so the
 * lookup behind it is an index rather than a scan: see `sizeIndexOf`.
 */
export const nodeSizeOf = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
): Size => {
  const measured = sizeIndexOf(nodeSizes).get(node.id);
  if (measured !== undefined) return measured;
  if (node.size !== undefined) return node.size;
  return fallbackSize;
};

/**
 * The node's box in **absolute flow space**: `left`/`top` come from the position
 * index, which has already added the parent chain's offsets (§7 M4). A child
 * therefore lands where its parent puts it, and every consumer of a rect — the
 * culling test, the minimap, the fit, the edge anchors — shares that one rule.
 */
export const nodeRect = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
  positions: PositionIndex,
): Rect => {
  const size = nodeSizeOf(node, nodeSizes);
  const position = positionOf(node, positions);
  return {
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
  };
};

export const intersects = (a: Rect, b: Rect): boolean =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

/** The union of some boxes. An empty list gives a zero rect. */
export const boundsOfRects = (rects: ReadonlyArray<Rect>): Rect => {
  const [first, ...rest] = rects;
  if (first === undefined) return { left: 0, top: 0, width: 0, height: 0 };

  return rest.reduce<Rect>(
    (acc, rect) => {
      const left = Math.min(acc.left, rect.left);
      const top = Math.min(acc.top, rect.top);
      const right = Math.max(acc.left + acc.width, rect.left + rect.width);
      const bottom = Math.max(acc.top + acc.height, rect.top + rect.height);
      return { left, top, width: right - left, height: bottom - top };
    },
    { ...first },
  );
};

/** Bounding box of every node, in absolute flow space. */
export const nodeBounds = <NodeData>(
  model: Model,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): Rect => {
  const positions = positionIndex(nodes);
  return boundsOfRects(
    nodes.map((node) => nodeRect(node, model.nodeSizes, positions)),
  );
};
