import { expanded10k, expandedViewport } from "../fixture";
import { mountBenchPage } from "./page";

/** 10,000 nodes, nothing collapsed (M5). The other half of the 10k story: the
 *  collapsed page measures the escape hatch, this one measures what it escapes
 *  from — the exploration behind the ceiling in `docs/BENCHMARKS.md`. */
mountBenchPage({
  paneId: "bench-pane-expanded",
  graph: expanded10k,
  viewport: expandedViewport,
  cull: true,
});
