import type { ExampleSpec } from "../spec";

/**
 * The smallest flow that does something: three nodes, two edges, no chrome.
 *
 * `harness.ts` is the whole Foldkit app — one Model, one Message union, one
 * `update` that folds `Flow.update` and applies the facts it reports — and this
 * file is everything that makes it *this* example.
 */
const example: ExampleSpec = {
  name: "minimal",
  category: "Basics",
  title: "Minimal",
  description:
    "Three nodes and two edges with no chrome: the Model, the Messages and the renderer are all a flow needs.",
  nodes: [
    { id: "a", x: 0, y: 0, width: 180, height: 80, title: "Node A" },
    { id: "b", x: 280, y: 140, width: 180, height: 80, title: "Node B" },
    { id: "c", x: 560, y: 0, width: 180, height: 80, title: "Node C" },
  ],
  edges: [
    { id: "e-a-b", source: "a", target: "b", markerEnd: "ArrowClosed" },
    { id: "e-b-c", source: "b", target: "c", markerEnd: "ArrowClosed" },
  ],
  viewport: { x: 120, y: 120, zoom: 1 },
};

export default example;
