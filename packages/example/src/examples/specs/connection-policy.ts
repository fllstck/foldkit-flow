import { Array as Arr } from "effect";

import type { ExampleSpec } from "../spec";

/**
 * A connection policy, and the feedback a rejected release needs.
 *
 * `isValidConnection` is asked on release only, and a rejection emits **nothing** —
 * there is no OutMessage, so there is nothing to undo and nothing to tell the
 * parent. That is deliberate: the policy is the parent's, and the feedback belongs
 * where the parent draws. This example keeps the graph acyclic, and the panel's
 * line is where the reader sees a refusal happen.
 *
 * The rule is **reachability**, not "is this edge an exact reverse of one I
 * already have": `a → b → c` already contains a path from `a` to `c`, so `c → a`
 * has to be refused even though no single edge runs the other way. A direct-reverse
 * check would wave it through and quietly build a cycle — which is what this page
 * did until `docs/EXAMPLES-REVIEW.md` was pointed at it.
 */
const edges: ExampleSpec["edges"] = [
  { id: "e-a-b", source: "a", target: "b", markerEnd: "ArrowClosed" },
  { id: "e-b-c", source: "b", target: "c", markerEnd: "ArrowClosed" },
  { id: "e-b-d", source: "b", target: "d", markerEnd: "ArrowClosed" },
];

/**
 * Can `from` reach `to` by following edges? One breadth-first pass with a visited
 * set, so a graph that is already cyclic (a mid-edit one can be) terminates.
 */
const canReach = (
  edges: ReadonlyArray<ExampleSpec["edges"][number]>,
  from: string,
  to: string,
): boolean => {
  const walk = (
    frontier: ReadonlyArray<string>,
    visited: ReadonlySet<string>,
  ): boolean => {
    if (Arr.isReadonlyArrayEmpty(frontier)) return false;

    const reached = frontier.flatMap((nodeId) =>
      edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target),
    );
    if (reached.includes(to)) return true;

    const unvisited = reached.filter((nodeId) => !visited.has(nodeId));
    if (Arr.isReadonlyArrayEmpty(unvisited)) return false;

    return walk(
      Array.from(new Set(unvisited)),
      new Set([...visited, ...unvisited]),
    );
  };

  return walk([from], new Set([from]));
};

const example: ExampleSpec = {
  name: "connection-policy",
  category: "Interaction",
  title: "Connection policy",
  description:
    "A directed acyclic graph: drag a handle from the last node back toward the first, and `isValidConnection` refuses it silently — as designed.",
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
  /**
   * "Would this close a cycle?" — the only rule this graph has, written where a
   * reader can see it. A new edge `source → target` closes one exactly when
   * `target` can already reach `source`; a self-loop closes one trivially.
   *
   * `currentEdges` is the parent's graph as it stands, handed in by the harness on
   * every release — the parameter is the whole point: a policy closed over the
   * *declared* edges would keep answering about the graph as it was drawn, so
   * accepting `c → d` once would let `d → c` through afterwards.
   */
  isValidConnection: (connection, currentEdges) =>
    connection.source !== connection.target &&
    !canReach(currentEdges, connection.target, connection.source),
};

export default example;
