import { Option } from "effect";

import { nodeSizeOf } from "./bounds.js";
import type {
  Connection,
  FlowEdge,
  FlowNode,
  HandleBounds,
  HandlePosition,
  HandleRef,
  HandleType,
  Model,
  NodeSize,
  Point,
} from "../model.js";

/**
 * Handle identity is `nodeId` + `type` + `handleId`. Comparing only node and
 * type is wrong the moment a node declares two handles of the same kind:
 * geometry, hit-testing, and the connection preview would all fall back to the
 * first measured handle instead of the one the user grabbed.
 */
export const isSameHandle = (ref: HandleRef, bounds: HandleBounds): boolean =>
  bounds.nodeId === ref.nodeId &&
  bounds.type === ref.type &&
  Option.getOrUndefined(bounds.handleId) ===
    Option.getOrUndefined(ref.handleId);

export const findHandle = (
  bounds: ReadonlyArray<HandleBounds>,
  ref: HandleRef,
): Option.Option<HandleBounds> =>
  Option.fromNullishOr(bounds.find((entry) => isSameHandle(ref, entry)));

/** Center of a measured handle in flow space, given its node's position. */
export const handleCenter = (
  bounds: ReadonlyArray<HandleBounds>,
  origin: Point,
  ref: HandleRef,
): Option.Option<Point> =>
  Option.map(findHandle(bounds, ref), (entry) => ({
    x: origin.x + entry.x + entry.width / 2,
    y: origin.y + entry.y + entry.height / 2,
  }));

/**
 * The measured bounds an edge declaration refers to. An edge that names no
 * handle on one side means "that node's first handle of the type" — the rule
 * upstream applies ("if no handleId is given, we use the first handle"), and
 * the only reading that lets a parent draw an edge before it has learned handle
 * ids. Identity is still decided by `isSameHandle`.
 */
export const resolveHandle = (
  bounds: ReadonlyArray<HandleBounds>,
  nodeId: string,
  type: HandleType,
  handleId: Option.Option<string>,
): Option.Option<HandleBounds> =>
  Option.match(handleId, {
    // A declared id means that handle or none: silently anchoring on a sibling
    // would draw the edge in the wrong place, which is worse than the border.
    onSome: () => findHandle(bounds, { nodeId, handleId, type }),
    onNone: () =>
      Option.orElse(findHandle(bounds, { nodeId, handleId, type }), () =>
        Option.fromNullishOr(
          bounds.find(
            (entry) => entry.nodeId === nodeId && entry.type === type,
          ),
        ),
      ),
  });

/** One end of an edge in flow space, with the side a path should leave from. */
export type EdgeAnchor = Readonly<{
  x: number;
  y: number;
  position: HandlePosition;
}>;

export type EdgeEndpoints = Readonly<{
  source: EdgeAnchor;
  target: EdgeAnchor;
}>;

/** Node-border anchor, used before (or without) handle measurement: the same
 *  geometry M1 always drew, so an edge never disappears. */
const borderAnchor = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
  type: HandleType,
): EdgeAnchor => {
  const size = nodeSizeOf(node, nodeSizes);
  return type === "Source"
    ? {
        x: node.position.x + size.width / 2,
        y: node.position.y + size.height,
        position: "Bottom",
      }
    : {
        x: node.position.x + size.width / 2,
        y: node.position.y,
        position: "Top",
      };
};

/**
 * One edge end: the measured handle's centre with the handle's own `position`,
 * or the node-border anchor when that handle is unmeasured or missing (§7 M2).
 * Bounds are node-local, so the node position comes from the graph (§2.5.2).
 */
export const edgeAnchor = (
  model: Model,
  node: FlowNode<unknown>,
  type: HandleType,
  handleId: Option.Option<string>,
): EdgeAnchor =>
  Option.match(resolveHandle(model.handleBounds, node.id, type, handleId), {
    onNone: () => borderAnchor(node, model.nodeSizes, type),
    onSome: (entry) => ({
      x: node.position.x + entry.x + entry.width / 2,
      y: node.position.y + entry.y + entry.height / 2,
      position: entry.position,
    }),
  });

/** Both ends of an edge, or `None` when either node is absent from the graph. */
export const edgeEndpoints = <NodeData, EdgeData>(
  model: Model,
  edge: FlowEdge<EdgeData>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): Option.Option<EdgeEndpoints> => {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);

  if (source === undefined || target === undefined) return Option.none();

  return Option.some({
    source: edgeAnchor(
      model,
      source,
      "Source",
      Option.fromNullishOr(edge.sourceHandle),
    ),
    target: edgeAnchor(
      model,
      target,
      "Target",
      Option.fromNullishOr(edge.targetHandle),
    ),
  });
};

/**
 * Which side a free end should approach from: a pointer that sits to the right
 * of the anchor is entered from its left. Used for the half of a connection or
 * reconnect preview that has no handle under it yet.
 */
export const pointerHandlePosition = (
  from: Point,
  to: Point,
): HandlePosition => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "Left" : "Right";
  return dy >= 0 ? "Top" : "Bottom";
};

/** The connection an `isValidConnection` predicate sees: node and handle ids,
 *  as the parent's graph stores them (§2.5.1, §3.2). */
export const connectionOf = (
  source: HandleRef,
  target: HandleRef,
): Connection => ({
  source: source.nodeId,
  target: target.nodeId,
  sourceHandle: Option.getOrNull(source.handleId),
  targetHandle: Option.getOrNull(target.handleId),
});
