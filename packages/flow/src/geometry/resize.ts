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
  /** Hold the box's **start** aspect ratio, whichever axis the pointer moves.
   *
   *  `update` sets it from `model.isAdditiveModifier` — the modifier is the shape
   *  this library can offer, since `RendererConfig.resize` is one boolean for the
   *  pane and upstream's per-control prop has no place here (`M6-RESEARCH.md` §7). */
  keepAspectRatio?: boolean;
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

  const box: Rect = {
    left,
    top,
    width: nextRight - left,
    height: nextBottom - top,
  };

  return options?.keepAspectRatio === true
    ? withStartAspect(start, edges, box, minWidth, minHeight)
    : box;
};

/**
 * The box a resize produces with the start ratio held (§7 M6).
 *
 * The axis the pointer moved **further, proportionally**, decides the scale and the
 * other axis is derived from it: a corner dragged mostly sideways follows x, one
 * dragged mostly downwards follows y, and a diagonal drag resolves the way a person
 * would round it. The edges the control does not move are then placed from the
 * start box, so the anchor stays where the pointer grabbed it, and the minimum size
 * is applied to both axes at once — a proportional box cannot honour one minimum
 * without the ratio.
 */
const withStartAspect = (
  start: Rect,
  edges: Edges,
  box: Rect,
  minWidth: number,
  minHeight: number,
): Rect => {
  if (start.width === 0 || start.height === 0) return box;

  const ratio = start.width / start.height;
  const scaleX = box.width / start.width;
  const scaleY = box.height / start.height;
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;

  let width = start.width * scale;
  let height = start.height * scale;
  if (width < minWidth) {
    width = minWidth;
    height = width / ratio;
  }
  if (height < minHeight) {
    height = minHeight;
    width = height * ratio;
  }
  // A minimum can push the derived axis under the other one; raise both together
  // so the box never comes back smaller than a handle.
  if (width < minWidth || height < minHeight) {
    const grow = Math.max(minWidth / width, minHeight / height);
    width *= grow;
    height *= grow;
  }

  return {
    left: edges.left ? start.left + start.width - width : start.left,
    top: edges.top ? start.top + start.height - height : start.top,
    width,
    height,
  };
};
