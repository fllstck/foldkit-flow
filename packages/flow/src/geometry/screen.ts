import { Gesture, zeroDelta } from "../model.js";
import type { Model, Point } from "../model.js";

/** Client (screen) coordinates, as a pointer event reports them. */
export type ScreenPoint = Readonly<{ screenX: number; screenY: number }>;

/**
 * Screen → flow space. The pane rect's origin is subtracted first so a pane
 * anywhere on the page converts correctly, then the viewport transform is
 * inverted (`translate(x, y) scale(zoom)`).
 */
export const screenToFlow = (model: Model, point: ScreenPoint): Point => {
  const { viewport, pane } = model;
  return {
    x: (point.screenX - pane.left - viewport.x) / viewport.zoom,
    y: (point.screenY - pane.top - viewport.y) / viewport.zoom,
  };
};

export const flowToScreen = (model: Model, point: Point): Point => {
  const { viewport, pane } = model;
  return {
    x: point.x * viewport.zoom + viewport.x + pane.left,
    y: point.y * viewport.zoom + viewport.y + pane.top,
  };
};

/** The live drag overlay offset, or the shared zero delta when nothing is
 *  being dragged. The shared reference is what keeps non-dragged nodes out of
 *  the node cache's invalidation set (§4.5). */
export const dragDelta = (model: Model): Point => {
  const gesture = model.gesture;
  return Gesture.guards.DraggingNodes(gesture) ? gesture.delta : zeroDelta;
};
