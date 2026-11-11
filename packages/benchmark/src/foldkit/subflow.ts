import { subFlow, subFlowViewport } from "../fixture";
import { mountBenchPage } from "./page";

/**
 * The M4 sub-flow page (§7 M4): parent/child positioning, `hidden` collapsing,
 * node resizing, the snap grid, `fitView` options, and edge markers and labels,
 * on a graph small enough that a proof can assert exact transforms.
 *
 * Unculled and with chrome on, so every node is in the DOM and the minimap and
 * controls are there to press.
 */
mountBenchPage({
  paneId: "bench-pane-subflow",
  graph: subFlow,
  viewport: subFlowViewport,
  cull: false,
  chrome: true,
  resize: true,
  snapGrid: { x: 20, y: 20 },
  fitView: { maxZoom: 0.6, padding: 0.2, duration: 80 },
});
