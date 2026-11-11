import { large, largeViewport } from "../fixture";
import { mountBenchPage } from "./page";

/**
 * The same 1k culled fixture as `/large.html` with M3's chrome on, so the cost of
 * the background, the controls, and the minimap is measured instead of assumed
 * (§7 M3). It is a separate page rather than a switch on `/large.html` because
 * the gate's comparison legs must keep measuring the DOM they always measured.
 */
mountBenchPage({
  paneId: "bench-pane-large-chrome",
  graph: large,
  viewport: largeViewport,
  cull: true,
  chrome: true,
});
