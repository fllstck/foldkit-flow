import type { ExampleSpec } from "../spec";

/**
 * A connection policy, and the feedback a rejected release needs.
 *
 * `isValidConnection` is asked on release only, and a rejection emits **nothing** —
 * there is no OutMessage, so there is nothing to undo and nothing to tell the
 * parent. That is deliberate: the policy is the parent's, and the feedback belongs
 * where the parent draws. This example refuses an edge that would close a cycle,
 * and the panel's line is where the reader sees it happen.
 */
const edges: ExampleSpec["edges"] = [
  { id: "e-a-b", source: "a", target: "b", markerEnd: "ArrowClosed" },
  { id: "e-b-c", source: "b", target: "c", markerEnd: "ArrowClosed" },
  { id: "e-b-d", source: "b", target: "d", markerEnd: "ArrowClosed" },
];

const example: ExampleSpec = {
  name: "connection-policy",
  category: "Interaction",
  title: "Connection policy",
  description:
    "A directed acyclic graph: drag a handle from the last node back to the first, and `isValidConnection` refuses it silently — as designed.",
  nodes: [
    { id: "a", x: 0, y: 120, width: 200, height: 92, title: "Ingest" },
    { id: "b", x: 280, y: 0, width: 200, height: 92, title: "Transform" },
    { id: "c", x: 560, y: 120, width: 200, height: 92, title: "Store" },
    {
      id: "d",
      x: 280,
      y: 240,
      width: 200,
      height: 92,
      title: "Report",
      status: "ready",
    },
  ],
  edges,
  viewport: { x: 80, y: 60, zoom: 1 },
  // "Would this close a cycle?" — the only rule this graph has, written where a
  // reader can see it. Drag c's handle to a to watch it refuse.
  isValidConnection: (connection) =>
    // The graph is a DAG: a new edge may not run against an existing one. Derived
    // from the edges above, so the rule cannot fall out of step with the picture.
    !edges.some(
      (edge) =>
        edge.source === connection.target && edge.target === connection.source,
    ),
};

export default example;
