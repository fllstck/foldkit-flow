import { nested10k, nestedViewport } from "../fixture";
import { mountBenchPage } from "./page";

/**
 * 10,000 nodes, 9,900 of them inside collapsed containers (§7 M4). This is the
 * large-graph escape hatch measured, not promised: the page exists so the cost of
 * `hidden` is a number in `results/hidden-10k.json` rather than an adjective.
 */
mountBenchPage({
  paneId: "bench-pane-hidden",
  graph: nested10k,
  viewport: nestedViewport,
  cull: true,
});
