import { Option } from "effect";

import type { Point } from "../model.js";

/** One pixel per press: the finest nudge a graph editor needs, and small enough
 *  that a mistake is cheap. Shift multiplies it by ten. */
export const nudgeStep = 1;
export const nudgeLargeStep = 10;

const directions = new Map<string, Point>([
  ["ArrowUp", { x: 0, y: -1 }],
  ["ArrowDown", { x: 0, y: 1 }],
  ["ArrowLeft", { x: -1, y: 0 }],
  ["ArrowRight", { x: 1, y: 0 }],
]);

/**
 * The delta one arrow-key down means, or `none` for a key the flow does not
 * nudge with. Pure, so the whole keyboard contract is testable without a DOM and
 * the subscription that calls it stays a mapper over browser facts.
 *
 * The direction is graph-space, which at any zoom is the direction the node moves
 * on screen: the viewport transform is a uniform scale plus a translate, so it
 * cannot rotate screen directions away from graph ones.
 */
export const nudgeDelta = (
  key: string,
  modifiers: Readonly<{ shiftKey: boolean }>,
): Option.Option<Point> => {
  const step = modifiers.shiftKey ? nudgeLargeStep : nudgeStep;
  return Option.map(Option.fromNullishOr(directions.get(key)), (direction) => ({
    x: direction.x * step,
    y: direction.y * step,
  }));
};
