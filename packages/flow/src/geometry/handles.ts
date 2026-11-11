import { Array as Arr, Option } from "effect";

import { nodeSizeOf } from "./bounds.js";
import { positionIndex, positionOf } from "./positions.js";
import type { PositionIndex } from "./positions.js";
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
): Option.Option<HandleBounds> => resolveIn(bounds, nodeId, type, handleId);

const resolveIn = (
  candidates: ReadonlyArray<HandleBounds>,
  nodeId: string,
  type: HandleType,
  handleId: Option.Option<string>,
): Option.Option<HandleBounds> =>
  Option.match(handleId, {
    // A declared id means that handle or none: silently anchoring on a sibling
    // would draw the edge in the wrong place, which is worse than the border.
    onSome: () => findHandle(candidates, { nodeId, handleId, type }),
    onNone: () =>
      Option.orElse(findHandle(candidates, { nodeId, handleId, type }), () =>
        Option.fromNullishOr(
          candidates.find(
            (entry) => entry.nodeId === nodeId && entry.type === type,
          ),
        ),
      ),
  });

/**
 * Measured bounds grouped by node. The renderer builds this once per measurement
 * change: `resolveHandle` scans the whole array, and a viewport frame that paid
 * that scan twice per edge — on a graph with a thousand measured nodes — was the
 * regression the §4.5 gate caught (long pan frames). Grouping first turns each
 * edge end into a two-entry lookup.
 */
export type HandleBoundsByNode = ReadonlyMap<
  string,
  ReadonlyArray<HandleBounds>
>;

export const indexHandles = (
  bounds: ReadonlyArray<HandleBounds>,
): HandleBoundsByNode =>
  new Map(Object.entries(Arr.groupBy(bounds, (entry) => entry.nodeId)));

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
  origin: Point,
): EdgeAnchor => {
  const size = nodeSizeOf(node, nodeSizes);
  return type === "Source"
    ? {
        x: origin.x + size.width / 2,
        y: origin.y + size.height,
        position: "Bottom",
      }
    : {
        x: origin.x + size.width / 2,
        y: origin.y,
        position: "Top",
      };
};

/**
 * One edge end: the measured handle's centre with the handle's own `position`,
 * or the node-border anchor when that handle is unmeasured or missing (§7 M2).
 * Bounds are node-local, so the node's **absolute** position comes from the
 * position index — a child's edge is anchored where the child is drawn, not at
 * its parent-relative offset (§7 M4).
 */
const anchorOf = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
  maybeHandle: Option.Option<HandleBounds>,
  type: HandleType,
  origin: Point,
): EdgeAnchor =>
  Option.match(maybeHandle, {
    onNone: () => borderAnchor(node, nodeSizes, type, origin),
    onSome: (entry) => ({
      x: origin.x + entry.x + entry.width / 2,
      y: origin.y + entry.y + entry.height / 2,
      position: entry.position,
    }),
  });

export const edgeAnchor = (
  model: Model,
  node: FlowNode<unknown>,
  type: HandleType,
  handleId: Option.Option<string>,
  positions?: PositionIndex,
): EdgeAnchor => {
  const origin =
    positions === undefined ? node.position : positionOf(node, positions);
  return anchorOf(
    node,
    model.nodeSizes,
    resolveHandle(model.handleBounds, node.id, type, handleId),
    type,
    origin,
  );
};

/**
 * Both ends of an edge against pre-built lookups, or `None` when either node is
 * absent from the graph. This is the form the renderer uses, once per edge per
 * render, with `indexHandles` and a node map built above the loop.
 */
export const indexedEdgeEndpoints = <EdgeData>(
  nodeSizes: ReadonlyArray<NodeSize>,
  handles: HandleBoundsByNode,
  nodes: ReadonlyMap<string, FlowNode<unknown>>,
  edge: FlowEdge<EdgeData>,
  positions?: PositionIndex,
): Option.Option<EdgeEndpoints> => {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (source === undefined || target === undefined) return Option.none();

  const originOf = (node: FlowNode<unknown>): Point =>
    positions === undefined ? node.position : positionOf(node, positions);

  return Option.some({
    source: anchorOf(
      source,
      nodeSizes,
      resolveIn(
        handles.get(source.id) ?? [],
        source.id,
        "Source",
        Option.fromNullishOr(edge.sourceHandle),
      ),
      "Source",
      originOf(source),
    ),
    target: anchorOf(
      target,
      nodeSizes,
      resolveIn(
        handles.get(target.id) ?? [],
        target.id,
        "Target",
        Option.fromNullishOr(edge.targetHandle),
      ),
      "Target",
      originOf(target),
    ),
  });
};

/** Both ends of an edge given the graph as an array: convenient, and O(nodes +
 *  bounds) per call. The renderer uses `indexedEdgeEndpoints`. */
export const edgeEndpoints = <NodeData, EdgeData>(
  model: Model,
  edge: FlowEdge<EdgeData>,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): Option.Option<EdgeEndpoints> =>
  indexedEdgeEndpoints(
    model.nodeSizes,
    indexHandles(model.handleBounds),
    new Map(nodes.map((node) => [node.id, node] as const)),
    edge,
    positionIndex(nodes),
  );

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

/**
 * A connection with the `Source` handle first. A gesture may start at either
 * kind of handle — the preview leaves the one the user grabbed — but the fact is
 * about handle kinds, not about the direction the pointer travelled: `source` is
 * always the `Source` handle and `target` always the `Target` one, which is what
 * `Connection` and the parent's graph mean by those names. Hit-testing only ever
 * accepts the opposite type, so exactly one of the two is a `Source`.
 */
export const orientConnection = (
  from: HandleRef,
  to: HandleRef,
): Readonly<{ source: HandleRef; target: HandleRef }> =>
  from.type === "Source"
    ? { source: from, target: to }
    : { source: to, target: from };

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
