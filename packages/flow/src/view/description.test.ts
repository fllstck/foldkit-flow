import { describe, expect, test } from "vitest";

import type { FlowEdge, FlowNode } from "../model.js";
import { describeGraph, descriptionLimits } from "./description.js";

const node = (id: string, label: string): FlowNode<{ label: string }> => ({
  id,
  position: { x: 0, y: 0 },
  data: { label },
});

const edge = (id: string, source: string, target: string): FlowEdge => ({
  id,
  source,
  target,
});

const textOf = (
  nodes: ReadonlyArray<FlowNode<{ label: string }>>,
  edges: ReadonlyArray<FlowEdge>,
) =>
  describeGraph({
    nodes,
    edges,
    accessibleName: (current) => current.data.label,
  });

describe("describeGraph", () => {
  test("summarises, then names each node and its connections", () => {
    const text = textOf(
      [node("a", "Alpha"), node("b", "Beta"), node("c", "Gamma")],
      [edge("e1", "a", "b"), edge("e2", "b", "c")],
    );

    expect(text).toContain("3 nodes and 2 connections");
    expect(text).toContain("Node 1 of 3: Alpha, connects to Beta.");
    expect(text).toContain(
      "Node 2 of 3: Beta, connects to Gamma, connected from Alpha.",
    );
    expect(text).toContain("Node 3 of 3: Gamma, connected from Beta.");
  });

  test("an isolated node says so instead of saying nothing", () => {
    expect(textOf([node("a", "Alpha")], [])).toContain(
      "Node 1 of 1: Alpha, no connections.",
    );
  });

  test("an empty graph is a sentence, not an empty region", () => {
    expect(textOf([], [])).toBe("Flow graph: no nodes.");
  });

  test("a fan-out reads as a list, with a conjunction", () => {
    const text = textOf(
      [node("a", "A"), node("b", "B"), node("c", "C")],
      [edge("e1", "a", "b"), edge("e2", "a", "c")],
    );
    expect(text).toContain("connects to B and C.");
  });

  test("a big graph is capped, and says what it left out", () => {
    const nodes = Array.from({ length: descriptionLimits.nodes + 5 }, (_v, i) =>
      node(`n${i}`, `Node ${i}`),
    );
    const text = textOf(nodes, []);

    expect(text).toContain(`${descriptionLimits.nodes + 5} nodes`);
    expect(text).toContain("5 more nodes are not listed.");
    // Capped: the last listed node is the limit-th, not the last one.
    expect(text).toContain(
      `Node ${descriptionLimits.nodes} of ${nodes.length}`,
    );
    expect(text).not.toContain(
      `Node ${descriptionLimits.nodes + 1} of ${nodes.length}`,
    );
  });

  test("a node with many connections names six and counts the rest", () => {
    const targets = Array.from({ length: 9 }, (_v, i) =>
      node(`t${i}`, `T${i}`),
    );
    const edges = targets.map((target, i) => edge(`e${i}`, "hub", target.id));
    const text = textOf([node("hub", "Hub"), ...targets], edges);

    expect(text).toContain("connects to T0, T1, T2, T3, T4, T5 and 3 more.");
  });

  test("ids stand in when no accessible name is supplied", () => {
    const text = describeGraph({
      nodes: [node("a", "Alpha")],
      edges: [],
      accessibleName: (current) => current.id,
    });
    expect(text).toContain("Node 1 of 1: a, no connections.");
  });
});
