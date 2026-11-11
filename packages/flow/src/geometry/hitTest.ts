import { Array as Arr, Option, Result } from "effect";

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
  /** Extra flow-space slack around each handle box. With slack, the nearest
   *  candidate wins instead of the last one, so a generous radius cannot snap to
   *  the far side of a node. */
  tolerance?: number;
}>;

/**
 * How close a pointer has to come to a handle for a connection to land there, in
 * **screen** pixels — divided by the zoom at the call site, so the target feels
 * the same size at every zoom. A handle box is 8×8 flow units (about 7 px on
 * screen at 0.9 zoom), and releasing while over the node is what people actually
 * do, so an exact-box hit test alone reads as "edges do not connect to nodes".
 * Upstream's `connectionRadius` defaults to 20 for the same reason.
 */
export const connectionRadius = 20;

const contains = (bounds: HandleBounds, point: Point, slack: number): boolean =>
  point.x >= bounds.x - slack &&
  point.x <= bounds.x + bounds.width + slack &&
  point.y >= bounds.y - slack &&
  point.y <= bounds.y + bounds.height + slack;

type Candidate = Readonly<{ bounds: HandleBounds; distance: number }>;

/**
 * Handle hit-testing against measured geometry. Bounds are stored node-local, so
 * the node's flow-space position comes from `context`; the flow never keeps a
 * graph copy of its own (§2.5.2, §2.5.9).
 *
 * Without slack, last match wins: measured bounds are appended in DOM order, and
 * the visually topmost handle is the one a press should hit. With slack the boxes
 * overlap, so the nearest centre wins instead.
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

  const candidates = Arr.filterMap(
    model.handleBounds,
    (bounds): Result.Result<Candidate, void> => {
      if (options?.accept !== undefined && !options.accept(bounds)) {
        return Result.failVoid;
      }
      const origin = positions.get(bounds.nodeId);
      if (origin === undefined) return Result.failVoid;

      const placed: HandleBounds = {
        ...bounds,
        x: bounds.x + origin.x,
        y: bounds.y + origin.y,
      };
      if (!contains(placed, point, slack)) return Result.failVoid;

      return Result.succeed({
        bounds,
        distance: Math.hypot(
          placed.x + placed.width / 2 - point.x,
          placed.y + placed.height / 2 - point.y,
        ),
      });
    },
  );

  const hit =
    slack === 0
      ? Option.map(Arr.last(candidates), (candidate) => candidate.bounds)
      : Option.map(
          Arr.reduce(candidates, Option.none<Candidate>(), (best, candidate) =>
            Option.match(best, {
              onNone: () => Option.some(candidate),
              onSome: (current) =>
                Option.some(
                  candidate.distance < current.distance ? candidate : current,
                ),
            }),
          ),
          (nearest) => nearest.bounds,
        );

  return Option.map(hit, (bounds) => ({
    nodeId: bounds.nodeId,
    handleId: bounds.handleId,
    type: bounds.type,
  }));
};

export const oppositeHandleType = (type: HandleType): HandleType =>
  type === "Source" ? "Target" : "Source";
