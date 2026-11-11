import { initialViewport, stress } from "../fixture";
import { mountBenchPage } from "./page";

mountBenchPage({
  paneId: "bench-pane",
  graph: stress,
  viewport: initialViewport,
  cull: false,
});
