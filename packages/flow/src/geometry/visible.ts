import type { FlowEdge, FlowNode, Model, Rect } from "../model.js";
import { intersects, nodeRect, nodeSizeOf } from "./bounds.js";
import { hiddenIds } from "./hidden.js";
import { positionIndex, positionOf } from "./positions.js";

/** Negation that keeps a zero positive: `-0` would reach the DOM as `-0` in a
 *  minimap rectangle or a `viewBox`. */
const negate = (value: number): number => (value === 0 ? 0 : -value);

/**
 * The pane's box in flow space, with no overscan: exactly what the user can see.
 * This is what a minimap draws as its viewport rectangle, which is why it is a
 * separate function from `visibleRegion` — culling's overscan is a rendering
 * buffer, not a fact about the view (§4.5).
 */
export const viewportRect = (model: Model): Rect => {
  const { viewport, pane } = model;
  const zoom = viewport.zoom;
  return {
    left: negate(viewport.x / zoom),
    top: negate(viewport.y / zoom),
    width: pane.width / zoom,
    height: pane.height / zoom,
  };
};

/**
 * The flow-space region worth drawing: the viewport plus one screen of overscan
 * on every side, so a node entering the viewport during a pan is already
 * rendered when it becomes visible (§2.5.6). Derived from `viewportRect` so the
 * two cannot disagree about where the view is.
 */
export const visibleRegion = (model: Model): Rect => {
  const { width, height, left, top } = viewportRect(model);
  return {
    left: left - width,
    top: top - height,
    width: width * 3,
    height: height * 3,
  };
};

/**
 * The nodes `visibleNodes` would keep at any zoom: everything a collapsed subtree
 * does not take away (§7 M4). Separate from culling because `hidden` applies with
 * culling off — a collapsed node is not drawn in any viewport.
 */
export const shownNodes = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyArray<FlowNode<NodeData>> => {
  const hidden = hiddenIds(nodes);
  return nodes.filter((node) => !hidden.has(node.id));
};

/**
 * Culling, O(N) per call. It is recomputed on viewport frames only, because the
 * viewport is the only input that can change the visible set (§4.5). Collapsing
 * is applied first, so a hidden node costs one set lookup instead of a rect test.
 */
export const visibleNodes = <NodeData>(
  model: Model,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyArray<FlowNode<NodeData>> => {
  const region = visibleRegion(model);
  const positions = positionIndex(nodes);
  const hidden = hiddenIds(nodes);

  return nodes.filter(
    (node) =>
      !hidden.has(node.id) &&
      intersects(nodeRect(node, model.nodeSizes, positions), region),
  );
};

/** The box an edge spans, from the border anchor of each end — the geometry
 *  `visibleEdges` has always used to decide whether to keep an edge. */
const edgeBox = (
  source: FlowNode<unknown>,
  target: FlowNode<unknown>,
  nodeSizes: Model["nodeSizes"],
  positions: ReturnType<typeof positionIndex>,
): Rect => {
  const sourceSize = nodeSizeOf(source, nodeSizes);
  const targetSize = nodeSizeOf(target, nodeSizes);
  const sourcePosition = positionOf(source, positions);
  const targetPosition = positionOf(target, positions);

  const sourceX = sourcePosition.x + sourceSize.width / 2;
  const sourceY = sourcePosition.y + sourceSize.height;
  const targetX = targetPosition.x + targetSize.width / 2;
  const targetY = targetPosition.y;

  return {
    left: Math.min(sourceX, targetX),
    top: Math.min(sourceY, targetY),
    width: Math.abs(targetX - sourceX) + 1,
    height: Math.abs(targetY - sourceY) + 1,
  };
};

/** An edge is drawn when its endpoints' box meets the region, which keeps edges
 *  that cross the viewport with both nodes outside it. An edge with a collapsed
 *  end is not drawn at all: half an edge is not a smaller edge. */
export const visibleEdges = <NodeData, EdgeData>(
  model: Model,
  edges: ReadonlyArray<FlowEdge<EdgeData>>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyArray<FlowEdge<EdgeData>> => {
  const region = visibleRegion(model);
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const positions = positionIndex(nodes);
  const hidden = hiddenIds(nodes);

  return edges.filter((edge) => {
    if (hidden.has(edge.source) || hidden.has(edge.target)) return false;

    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source === undefined || target === undefined) return false;

    return intersects(
      edgeBox(source, target, model.nodeSizes, positions),
      region,
    );
  });
};
