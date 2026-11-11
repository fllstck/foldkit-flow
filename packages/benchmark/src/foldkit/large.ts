import { large, largeViewport } from "../fixture";
import { mountBenchPage } from "./page";

mountBenchPage({
  paneId: "bench-pane-large",
  graph: large,
  viewport: largeViewport,
  cull: true,
});
