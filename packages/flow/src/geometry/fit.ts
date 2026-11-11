import { Array as Arr } from "effect";

import type { FlowNode, Model, Viewport } from "../model.js";
import { getViewportForBounds } from "../runtime/adapter.js";
import { nodeBounds } from "./bounds.js";

/** Fraction of the pane left empty on each side, upstream's own default. */
export const fitPadding = 0.1;

/**
 * The viewport that fits every node into the pane (§3.4). Pure, Model-first, and
 * the only path a fit control takes: `Controls` dispatches `ClickedFitView`,
 * `update` calls this and hands the result to `setViewport`.
 *
 * Three degenerate cases return the current viewport unchanged rather than a
 * fabricated one:
 *
 * - an **empty graph** has no box to fit, and fitting nothing would otherwise
 *   zoom to `maxZoom` around the origin and jump the view for no reason;
 * - an **unmeasured pane** (width/height of 0, i.e. before `ResizedPane`) has no
 *   frame to fit into;
 * - nodes that have not been measured yet are still fitted, because `nodeBounds`
 *   falls back to `node.size` and then to the shared fallback size, which is the
 *   same geometry the edge paths use before measurement.
 *
 * The result is clamped to the Model's zoom bounds inside
 * `getViewportForBounds`, which are the same bounds the pan/zoom engine
 * enforces, so there is no second clamp here.
 */
export const fitViewport = <NodeData>(
  model: Model,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
  padding: number = fitPadding,
): Viewport => {
  const { pane } = model;
  if (Arr.isReadonlyArrayEmpty(nodes) || pane.width <= 0 || pane.height <= 0) {
    return model.viewport;
  }

  const bounds = nodeBounds(model, nodes);
  return getViewportForBounds(
    {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    },
    pane.width,
    pane.height,
    model.minZoom,
    model.maxZoom,
    padding,
  );
};
