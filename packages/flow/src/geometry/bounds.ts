import type { FlowNode, Rect } from "../model.js";
import type { Model, NodeSize, Size } from "../model.js";
import { positionIndex, positionOf } from "./positions.js";
import type { PositionIndex } from "./positions.js";

/** Used for edge paths and culling before the node Mount has measured a box. */
export const fallbackSize: Size = { width: 151, height: 40 };

/** Measured size → the node's own size hint → the shared fallback. */
export const nodeSizeOf = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
): Size => {
  const measured = nodeSizes.find((size) => size.nodeId === node.id);
  if (measured !== undefined) {
    return { width: measured.width, height: measured.height };
  }
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
