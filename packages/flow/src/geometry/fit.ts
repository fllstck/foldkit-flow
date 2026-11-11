import { Array as Arr } from "effect";

import type { FlowNode, Model, Viewport } from "../model.js";
import { getViewportForBounds } from "../runtime/adapter.js";
import { nodeBounds } from "./bounds.js";

/** Fraction of the pane left empty on each side, upstream's own default. */
export const fitPadding = 0.1;

/**
 * `fitView` options (§7 M4). Every one is optional and every default is the
 * behaviour M3 shipped, so `fitViewport(model, nodes)` is unchanged.
 */
export type FitOptions<NodeData = unknown> = Readonly<{
  padding?: number;
  /** A clamp for **this fit only**, e.g. "never zoom in past 1:1". It can only
   *  tighten: the result is `Math.min(maxZoom, Model.maxZoom)`, so the Model's
   *  bounds stay the single source of truth (§3.1, §7 M4). */
  maxZoom?: number;
  minZoom?: number;
  /** Fit only the nodes this keeps — "fit the selection" is the use case.
   *  Positions still resolve against the **whole** graph, so a child fitted
   *  without its parent lands where it is drawn, not at its relative offset. */
  nodes?: (node: FlowNode<NodeData>) => boolean;
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
 * - nodes that have not been measured yet are still fitted, because `nodeBounds`
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
  const opts: FitOptions<NodeData> =
    typeof options === "number" ? { padding: options } : (options ?? {});

  if (Arr.isReadonlyArrayEmpty(nodes) || pane.width <= 0 || pane.height <= 0) {
    return model.viewport;
  }

  // A collapsed subtree is not drawn, so it is not fitted: zooming out to include
  // a node the canvas refuses to show leaves the visible graph in a corner (§7 M4).
  // A filter applies on top of that, not instead of it.
  const fitted = nodes.filter(
    (node) =>
      node.hidden !== true && (opts.nodes === undefined || opts.nodes(node)),
  );
  if (Arr.isReadonlyArrayEmpty(fitted)) return model.viewport;

  const bounds = nodeBounds(
    model,
    fitted.length === nodes.length ? nodes : withAncestors(nodes, fitted),
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

/**
 * `nodeBounds` needs a node's ancestors to place it, so a filtered fit measures a
 * list that keeps them. The extra nodes are measured, never shown.
 */
const withAncestors = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
  fitted: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyArray<FlowNode<NodeData>> => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const keep = new Set(fitted.map((node) => node.id));

  fitted.forEach((node) => {
    let current = node.parentId;
    while (current !== undefined && !keep.has(current)) {
      const parent = byId.get(current);
      if (parent === undefined) break;
      keep.add(parent.id);
      current = parent.parentId;
    }
  });

  return nodes.filter((node) => keep.has(node.id));
};
