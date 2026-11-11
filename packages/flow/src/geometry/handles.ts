import { Option } from "effect";

import type { HandleBounds, HandleRef, Point } from "../model.js";

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
