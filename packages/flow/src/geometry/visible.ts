import type { FlowEdge, FlowNode, Model, Rect } from "../model.js";
import { intersects, nodeRect, nodeSizeOf } from "./bounds.js";

/**
 * The flow-space region worth drawing: the pane's current viewport plus one
 * screen of overscan on every side, so a node entering the viewport during a
 * pan is already rendered when it becomes visible (§2.5.6).
 */
export const visibleRegion = (model: Model): Rect => {
  const { viewport, pane } = model;
  const zoom = viewport.zoom;
  const width = pane.width / zoom;
  const height = pane.height / zoom;
  return {
    left: -viewport.x / zoom - width,
    top: -viewport.y / zoom - height,
    width: width * 3,
    height: height * 3,
  };
};

/**
 * Culling, O(N) per call. It is recomputed on viewport frames only, because the
 * viewport is the only input that can change the visible set (§4.5).
 */
export const visibleNodes = <NodeData>(
  model: Model,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyArray<FlowNode<NodeData>> => {
  const region = visibleRegion(model);
  return nodes.filter((node) =>
    intersects(nodeRect(node, model.nodeSizes), region),
  );
};

/** An edge is drawn when its endpoints' box meets the region, which keeps
 *  edges that cross the viewport with both nodes outside it. */
export const visibleEdges = <NodeData, EdgeData>(
  model: Model,
  edges: ReadonlyArray<FlowEdge<EdgeData>>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyArray<FlowEdge<EdgeData>> => {
  const region = visibleRegion(model);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return edges.filter((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source === undefined || target === undefined) return false;

    const sourceSize = nodeSizeOf(source, model.nodeSizes);
    const targetSize = nodeSizeOf(target, model.nodeSizes);
    const sourceX = source.position.x + sourceSize.width / 2;
    const sourceY = source.position.y + sourceSize.height;
    const targetX = target.position.x + targetSize.width / 2;
    const targetY = target.position.y;

    return intersects(
      {
        left: Math.min(sourceX, targetX),
        top: Math.min(sourceY, targetY),
        width: Math.abs(targetX - sourceX) + 1,
        height: Math.abs(targetY - sourceY) + 1,
      },
      region,
    );
  });
};
