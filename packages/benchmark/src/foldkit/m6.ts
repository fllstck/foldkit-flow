import { subFlow, subFlowViewport } from "../fixture";
import { mountBenchPage } from "./page";

/**
 * The M6 page (§7 M6): the three behaviours that milestone shipped, on a graph
 * small enough that a proof can assert exact numbers.
 *
 * - `edgeSelection` makes each edge a press target and a tab stop.
 * - `chrome` brings the minimap, whose press now also arms a drag.
 * - `resize` brings the four corner controls, whose box the additive modifier
 *   holds proportional.
 *
 * Unculled, so every node and edge is in the DOM and a press lands where the
 * screenshot says it does. Its own page rather than a flag on `/subflow.html`,
 * so the M4 proofs keep the DOM they have always measured.
 */
mountBenchPage({
  paneId: "bench-pane-m6",
  graph: subFlow,
  viewport: subFlowViewport,
  cull: false,
  chrome: true,
  resize: true,
  edgeSelection: true,
});
