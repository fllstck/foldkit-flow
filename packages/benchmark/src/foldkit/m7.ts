import { overlayFlow, overlayViewport } from "../fixture";
import { mountBenchPage } from "./page";

/**
 * The M7 page (§7 M7): the flow-anchored overlay layer, on a graph whose label
 * points are arithmetic.
 *
 * Both edges are `Straight`, so an edge's label point is the midpoint of the
 * segment between its two border anchors — the point the overlay's transform
 * translates to, and the point a proof can find on the painted path with
 * `getPointAtLength(length / 2)`.
 *
 * - `e-open`'s midpoint is empty canvas, so the item is the topmost thing there:
 *   the paint it wins is against the edge stroke it sits on.
 * - `e-cover`'s midpoint is inside the `cover` node, so the item is behind the
 *   node: the same clip must not change when the layer is hidden.
 *
 * The two states (layer shown, layer hidden) are what make both halves of the
 * paint-order claim measurable rather than asserted from DOM order.
 *
 * `chrome` is on for the two zoom buttons: the overlay's screen size is constant
 * across zooms, and a proof needs to change the zoom the way a user does.
 */
mountBenchPage({
  paneId: "bench-pane-m7",
  graph: overlayFlow,
  viewport: overlayViewport,
  cull: false,
  chrome: true,
  edgeSelection: true,
  edgeOverlay: true,
  nodeClass: (id) => (id === "cover" ? "m7-node m7-cover" : "m7-node"),
});
