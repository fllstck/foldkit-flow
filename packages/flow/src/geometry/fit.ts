import { Array as Arr, Predicate } from "effect";

import type { FlowNode, Model, Viewport } from "../model.js";
import { getViewportForBounds } from "../runtime/adapter.js";
import { boundsOfRects, nodeRect } from "./bounds.js";
import { positionIndex } from "./positions.js";

/** Fraction of the pane left empty on each side, upstream's own default. */
export const fitPadding = 0.1;

/**
 * `fitView` options (§7 M4). Every one is optional and every default is the
 * behaviour M3 shipped, so `fitViewport(model, nodes)` is unchanged.
 */
export type FitOptions<NodeData = unknown> = Readonly<{
  // `| undefined` on every field so a caller can pass a value it may not have
  // without a conditional spread: `exactOptionalPropertyTypes` would reject
  // `padding: maybeNumber` otherwise, and a spread that hides the omission is
  // what the lint rejects.
  padding?: number | undefined;
  /** A clamp for **this fit only**, e.g. "never zoom in past 1:1". It can only
   *  tighten: the result is `Math.min(maxZoom, Model.maxZoom)`, so the Model's
   *  bounds stay the single source of truth (§3.1, §7 M4). */
  maxZoom?: number | undefined;
  minZoom?: number | undefined;
  /** Fit only the nodes this keeps — "fit the selection" is the use case. */
  nodes?: ((node: FlowNode<NodeData>) => boolean) | undefined;
}>;

/**
 * The viewport that fits every node into the pane (§3.4). Pure, Model-first, and
 * the only path a fit control takes: `Controls` dispatches `ClickedFitView`,
 * `update` calls this and hands the result to `setViewport` (duration and all).
 *
 * Three degenerate cases return the current viewport unchanged rather than a
 * fabricated one:
 *
 * - an **empty graph** has no box to fit, and fitting nothing would otherwise
 *   zoom to `maxZoom` around the origin and jump the view for no reason;
 * - an **unmeasured pane** (width/height of 0, i.e. before `ResizedPane`) has no
 *   frame to fit into;
 * - nodes that have not been measured yet are still fitted, because `nodeRect`
 *   falls back to `node.size` and then to the shared fallback size, which is the
 *   same geometry the edge paths use before measurement.
 *
 * The result is clamped to the Model's zoom bounds inside
 * `getViewportForBounds` — the same bounds the pan/zoom engine enforces — so
 * there is no second clamp here. An option can only tighten them.
 */
export const fitViewport = <NodeData>(
  model: Model,
  nodes: ReadonlyArray<FlowNode<NodeData>>,
  options?: FitOptions<NodeData> | number,
): Viewport => {
  const { pane } = model;
  const opts: FitOptions<NodeData> = Predicate.isNumber(options)
    ? { padding: options }
    : (options ?? {});

  if (Arr.isReadonlyArrayEmpty(nodes) || pane.width <= 0 || pane.height <= 0) {
    return model.viewport;
  }

  // A collapsed subtree is not drawn, so it is not fitted: zooming out to
  // include a node the canvas refuses to show leaves the visible graph in a
  // corner (§7 M4). A filter applies on top of that, not instead of it.
  const fitted = nodes.filter(
    (node) =>
      node.hidden !== true && (opts.nodes === undefined || opts.nodes(node)),
  );
  if (Arr.isReadonlyArrayEmpty(fitted)) return model.viewport;

  // Positions resolve against the **whole** graph — a filtered fit of a child
  // has to measure the box the child is drawn in, which needs its ancestors —
  // but only the fitted nodes contribute a box.
  const positions = positionIndex(nodes);
  const bounds = boundsOfRects(
    fitted.map((node) => nodeRect(node, model.nodeSizes, positions)),
  );

  return getViewportForBounds(
    {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    },
    pane.width,
    pane.height,
    Math.max(model.minZoom, opts.minZoom ?? model.minZoom),
    Math.min(model.maxZoom, opts.maxZoom ?? model.maxZoom),
    opts.padding ?? fitPadding,
  );
};
