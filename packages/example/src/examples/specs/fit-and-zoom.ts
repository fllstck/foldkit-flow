import type { ExampleSpec } from "../spec";

/**
 * A fitted view, and the contract behind it.
 *
 * `viewport: "fit"` runs the same two steps a consumer writes: `Flow.fitViewport`
 * needs the pane's measured box, so the fit is folded from `ResizedPane`, and
 * `Flow.setViewport` turns it into the `SyncViewport` Command that moves the
 * engine. That Command needs the pane id, which `MountedPane` folds — which is why
 * the pane's `MountedPane` always arrives before its first `ResizedPane`
 * (`M5-FINDINGS` §8.2: a fit folded before it left the engine on the old viewport
 * and the next pan jumped).
 */
const example: ExampleSpec = {
  name: "fit-and-zoom",
  category: "Viewport",
  title: "Fit and zoom",
  description:
    "No viewport is given: the flow fits the graph once the pane is measured, and the fit button re-runs the same helper.",
  nodes: [
    { id: "f1", x: 0, y: 0, width: 200, height: 92, title: "Corner" },
    { id: "f2", x: 700, y: 240, width: 200, height: 92, title: "Middle" },
    {
      id: "f3",
      x: 1180,
      y: 520,
      width: 200,
      height: 92,
      title: "Far corner",
      status: "running",
    },
  ],
  edges: [
    { id: "e-fit", source: "f1", target: "f3", markerEnd: "ArrowClosed" },
  ],
  viewport: "fit",
  padding: 0.12,
  renderer: { background: true, controls: true },
};

export default example;
