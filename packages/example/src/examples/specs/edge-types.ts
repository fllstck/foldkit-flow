import type { ExampleSpec } from "../spec";

/**
 * Four edge kinds, a label and a marker, all from data.
 *
 * The paths are `@xyflow/system`'s (`getBezierPath`, `getSmoothStepPath`,
 * `getStraightPath`) called with anchors taken from measured handles — so the same
 * fixture drawn by React Flow produces byte-identical `d` strings, which is what
 * `tests/gallery.spec.ts` asserts.
 */
const example: ExampleSpec = {
  name: "edge-types",
  category: "Edges",
  title: "Edge types",
  description:
    "Bezier, Step, SmoothStep and Straight from one source, with a label in the middle and arrows at the ends.",
  nodes: [
    { id: "s", x: 0, y: 220, width: 200, height: 92, title: "Source" },
    { id: "bezier", x: 320, y: 0, width: 200, height: 92, title: "Bezier" },
    { id: "step", x: 320, y: 140, width: 200, height: 92, title: "Step" },
    {
      id: "smooth",
      x: 320,
      y: 280,
      width: 200,
      height: 92,
      title: "SmoothStep",
    },
    {
      id: "straight",
      x: 320,
      y: 420,
      width: 200,
      height: 92,
      title: "Straight",
    },
  ],
  edges: [
    {
      id: "e-bezier",
      source: "s",
      target: "bezier",
      kind: "Bezier",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-step",
      source: "s",
      target: "step",
      kind: "Step",
      label: "step",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-smooth",
      source: "s",
      target: "smooth",
      kind: "SmoothStep",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-straight",
      source: "s",
      target: "straight",
      kind: "Straight",
      markerEnd: "Arrow",
    },
  ],
  viewport: { x: 80, y: 60, zoom: 0.9 },
};

export default example;
