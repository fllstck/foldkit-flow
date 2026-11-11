import type { Rect, SnapGrid } from "../model.js";
import { snapPosition } from "../runtime/adapter.js";

/** The eight controls a node grows and shrinks from. Same set the wrappers ship,
 *  as names rather than as a vendor enum. */
export const resizeControls = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
] as const;

export type ResizeControl = (typeof resizeControls)[number];

/** A node is never resized away: the box keeps enough area to hold a handle. */
export const minResizeWidth = 20;
export const minResizeHeight = 20;

export type ResizeOptions = Readonly<{
  minWidth?: number;
  minHeight?: number;
  /** Grid the moving edges snap to, in flow units. The pointer is snapped before
   *  the box is derived, so the edge that follows the pointer lands on a multiple
   *  whenever the node started on one — the same rule a snapped drag uses. */
  snapGrid?: SnapGrid;
}>;

type Edges = Readonly<{
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}>;

const edgesOf = (control: ResizeControl): Edges => ({
  left: control === "left" || control.endsWith("-left"),
  right: control === "right" || control.endsWith("-right"),
  top: control === "top" || control.startsWith("top-"),
  bottom: control === "bottom" || control.startsWith("bottom-"),
});

/**
 * The box a resize gesture produces, purely (§7 M4).
 *
 * `start` is the node's **absolute** rect when the gesture began and `pointer` is
 * the pointer in flow space; the edges the control does not move are copied from
 * `start`, so a right-edge drag cannot change the node's height by a rounding
 * step. The box is clamped to `minWidth`/`minHeight` by moving the dragged edge,
 * which keeps the anchor where the user grabbed it.
 */
export const resizeRect = (
  start: Rect,
  control: ResizeControl,
  pointer: { x: number; y: number },
  options?: ResizeOptions,
): Rect => {
  const edges = edgesOf(control);
  const minWidth = options?.minWidth ?? minResizeWidth;
  const minHeight = options?.minHeight ?? minResizeHeight;

  const snapped =
    options?.snapGrid === undefined
      ? pointer
      : snapPosition(pointer, [options.snapGrid.x, options.snapGrid.y]);

  const right = start.left + start.width;
  const bottom = start.top + start.height;

  const left = edges.left ? Math.min(snapped.x, right - minWidth) : start.left;
  const top = edges.top ? Math.min(snapped.y, bottom - minHeight) : start.top;
  const nextRight = edges.right ? Math.max(snapped.x, left + minWidth) : right;
  const nextBottom = edges.bottom
    ? Math.max(snapped.y, top + minHeight)
    : bottom;

  return {
    left,
    top,
    width: nextRight - left,
    height: nextBottom - top,
  };
};
