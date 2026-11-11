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

/**
 * The viewport that puts `point` at the centre of the pane at the current zoom.
 * This is what a minimap click means (§7 M4): the flow point under the cursor
 * becomes the middle of the view, zoom untouched, so the click moves the view and
 * does not change its scale. `setViewport` still clamps the zoom, so this cannot
 * smuggle in a zoom the Model would refuse.
 */
export const viewportCentredOn = (
  model: Model,
  point: Point,
): Model["viewport"] => ({
  x: model.pane.width / 2 - point.x * model.viewport.zoom,
  y: model.pane.height / 2 - point.y * model.viewport.zoom,
  zoom: model.viewport.zoom,
});

/** The live drag overlay offset, or the shared zero delta when nothing is
 *  being dragged. The shared reference is what keeps non-dragged nodes out of
 *  the node cache's invalidation set (§4.5). */
export const dragDelta = (model: Model): Point => {
  const gesture = model.gesture;
  return Gesture.guards.DraggingNodes(gesture) ? gesture.delta : zeroDelta;
};
