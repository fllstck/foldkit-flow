import type { ExampleSpec } from "../spec";

/**
 * Collapsing a container's **contents**, not the container.
 *
 * `hidden` on a node takes that node, its subtree, their edges and their
 * measurement — the escape hatch for large graphs. Pointing it at the *children*
 * is what a graph editor does: the frame stays where it is, so the thing you
 * clicked is still on the canvas, and only its contents go. Hiding the frame
 * itself is also supported — the 10k benchmark page collapses whole containers —
 * and is the wrong shape for a UI.
 *
 * Re-banding the frame (shrinking it to a summary strip) is the parent's own
 * business: it is the parent's `size` field. `src/example/app.ts` does exactly
 * that; this page keeps the box, so the example shows one thing at a time.
 */
const example: ExampleSpec = {
  name: "collapse",
  category: "Sub-flows",
  title: "Collapsing a subtree",
  description:
    "A frame with two children: collapse hides the children and the edges that touch them, and the frame stays where it is.",
  nodes: [
    { id: "start", x: 180, y: 0, width: 200, height: 92, title: "Start" },
    {
      id: "frame",
      x: 120,
      y: 160,
      width: 420,
      height: 240,
      title: "Batch",
      subtitle: "2 steps",
      status: "ready",
    },
    {
      id: "one",
      x: 20,
      y: 70,
      width: 380,
      height: 70,
      title: "Step one",
      subtitle: "validate",
      parentId: "frame",
    },
    {
      id: "two",
      x: 20,
      y: 150,
      width: 380,
      height: 70,
      title: "Step two",
      subtitle: "publish",
      parentId: "frame",
    },
    {
      id: "done",
      x: 180,
      y: 460,
      width: 200,
      height: 92,
      title: "Done",
      subtitle: "kept",
    },
  ],
  edges: [
    {
      id: "e-start-one",
      source: "start",
      target: "one",
      markerEnd: "ArrowClosed",
    },
    { id: "e-one-two", source: "one", target: "two", markerEnd: "ArrowClosed" },
    {
      id: "e-two-done",
      source: "two",
      target: "done",
      markerEnd: "ArrowClosed",
    },
  ],
  viewport: { x: 120, y: 60, zoom: 0.9 },
  // The children are what collapse; the frame stays.
  controls: { collapseIds: ["one", "two"], fit: true },
};

export default example;
