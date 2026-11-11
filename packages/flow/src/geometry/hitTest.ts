import { Array as Arr, Option } from "effect";

import type {
  Context,
  HandleBounds,
  HandleRef,
  HandleType,
  Model,
  Point,
} from "../model.js";

export type HitTestOptions = Readonly<{
  /** Restricts candidates, e.g. a connection that only accepts the opposite
   *  handle type. */
  accept?: (bounds: HandleBounds) => boolean;
  /** Extra flow-space slack around each handle box. */
  tolerance?: number;
}>;

const contains = (bounds: HandleBounds, point: Point, slack: number): boolean =>
  point.x >= bounds.x - slack &&
  point.x <= bounds.x + bounds.width + slack &&
  point.y >= bounds.y - slack &&
  point.y <= bounds.y + bounds.height + slack;

/**
 * Handle hit-testing against measured geometry. Bounds are stored node-local, so
 * the node's flow-space position comes from `context`; the flow never keeps a
 * graph copy of its own (§2.5.2, §2.5.9).
 *
 * Last match wins: measured bounds are appended in DOM order, and the visually
 * topmost handle is the one a press should hit.
 */
export const hitTestHandle = (
  model: Model,
  point: Point,
  context: Context,
  options?: HitTestOptions,
): Option.Option<HandleRef> => {
  const slack = options?.tolerance ?? 0;
  const positions = new Map(
    context.nodes.map((node) => [node.id, node.position]),
  );

  const hits = model.handleBounds.filter((bounds) => {
    if (options?.accept !== undefined && !options.accept(bounds)) return false;
    const origin = positions.get(bounds.nodeId);
    if (origin === undefined) return false;
    return contains(
      {
        ...bounds,
        x: bounds.x + origin.x,
        y: bounds.y + origin.y,
      },
      point,
      slack,
    );
  });

  return Option.map(Arr.last(hits), (bounds) => ({
    nodeId: bounds.nodeId,
    handleId: bounds.handleId,
    type: bounds.type,
  }));
};

export const oppositeHandleType = (type: HandleType): HandleType =>
  type === "Source" ? "Target" : "Source";
