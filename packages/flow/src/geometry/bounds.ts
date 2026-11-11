import type { FlowNode, Model, NodeSize, Rect, Size } from "../model.js";

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

/** The node's box in flow space. `Rect.left`/`top` carry the node position. */
export const nodeRect = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
): Rect => {
  const size = nodeSizeOf(node, nodeSizes);
  return {
    left: node.position.x,
    top: node.position.y,
    width: size.width,
    height: size.height,
  };
};

export const intersects = (a: Rect, b: Rect): boolean =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

/** Bounding box of every node, in flow space. Empty graphs give a zero rect. */
export const nodeBounds = <NodeData>(
  model: Model,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): Rect => {
  const rects = nodes.map((node) => nodeRect(node, model.nodeSizes));
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
