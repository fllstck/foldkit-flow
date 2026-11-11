import { Option } from "effect";
import { describe, expect, test } from "vitest";

import {
  connectionOf,
  edgeAnchor,
  edgeEndpoints,
  indexHandles,
  indexedEdgeEndpoints,
  pointerHandlePosition,
  resolveHandle,
} from "./handles.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode, HandleBounds } from "../model.js";

const node = (
  id: string,
  x: number,
  y: number,
  size = { width: 100, height: 40 },
): FlowNode => ({ id, position: { x, y }, size, data: null });

const sourceHandle = node("a", 100, 50);
const targetHandle = node("b", 400, 200);

/** a's two source handles, node-local: x=192 (centre 296,70) and x=0 (centre 104,70). */
const bounds: ReadonlyArray<HandleBounds> = [
  {
    nodeId: "a",
    handleId: Option.some("out"),
    type: "Source",
    position: "Right",
    x: 192,
    y: 16,
    width: 8,
    height: 8,
  },
  {
    nodeId: "a",
    handleId: Option.some("aux"),
    type: "Source",
    position: "Bottom",
    x: 0,
    y: 36,
    width: 8,
    height: 8,
  },
  {
    nodeId: "b",
    handleId: Option.some("in"),
    type: "Target",
    position: "Left",
    x: -4,
    y: 16,
    width: 8,
    height: 8,
  },
];

const model = { ...init().model, handleBounds: bounds };

const edge = (overrides?: Partial<FlowEdge>): FlowEdge => ({
  id: "e1",
  source: "a",
  target: "b",
  sourceHandle: "out",
  targetHandle: "in",
  ...overrides,
});

describe("edge endpoints from measured handles", () => {
  test("anchor on the handle centre, with the handle's own position", () => {
    expect(
      edgeAnchor(model, sourceHandle, "Source", Option.some("out")),
    ).toEqual({ x: 296, y: 70, position: "Right" });
    expect(
      edgeAnchor(model, targetHandle, "Target", Option.some("in")),
    ).toEqual({ x: 400, y: 220, position: "Left" });
  });

  test("name the handle the edge declares, not the first of its type", () => {
    expect(
      edgeAnchor(model, sourceHandle, "Source", Option.some("aux")),
    ).toEqual({ x: 104, y: 90, position: "Bottom" });
  });

  test("an edge with no handle id uses the node's first handle of the type", () => {
    // Upstream's rule ("if no handleId is given, we use the first handle"), and
    // the only reading that lets a parent draw an edge it has no handle ids for.
    expect(
      Option.map(resolveHandle(bounds, "a", "Source", Option.none()), (entry) =>
        Option.getOrUndefined(entry.handleId),
      ),
    ).toEqual(Option.some("out"));
  });

  test("both ends of an edge, from the graph the parent handed over", () => {
    expect(edgeEndpoints(model, edge(), [sourceHandle, targetHandle])).toEqual(
      Option.some({
        source: { x: 296, y: 70, position: "Right" },
        target: { x: 400, y: 220, position: "Left" },
      }),
    );
  });

  test("an edge that names no handles still lands on them", () => {
    const withoutIds: FlowEdge = { id: "e1", source: "a", target: "b" };
    expect(
      Option.map(
        edgeEndpoints(model, withoutIds, [sourceHandle, targetHandle]),
        (endpoints) => [endpoints.source.position, endpoints.target.position],
      ),
    ).toEqual(Option.some(["Right", "Left"]));
  });

  test("an unmeasured handle falls back to the node border", () => {
    // The measured set only knows `a`; b's handles have not landed yet.
    const partial = { ...init().model, handleBounds: [bounds[0]!] };
    expect(
      edgeEndpoints(partial, edge(), [sourceHandle, targetHandle]),
    ).toEqual(
      Option.some({
        source: { x: 296, y: 70, position: "Right" },
        target: { x: 450, y: 200, position: "Top" },
      }),
    );
  });

  test("a handle id that measurement never saw falls back too", () => {
    const unknown = edge({ sourceHandle: "missing" });
    expect(
      Option.map(
        edgeEndpoints(model, unknown, [sourceHandle, targetHandle]),
        (endpoints) => endpoints.source,
      ),
    ).toEqual(Option.some({ x: 150, y: 90, position: "Bottom" }));
  });

  test("no node, no edge: the renderer drops it rather than guessing", () => {
    expect(edgeEndpoints(model, edge(), [sourceHandle])).toEqual(Option.none());
  });

  test("the indexed lookups agree with the array path", () => {
    // The renderer draws edges through `indexedEdgeEndpoints`, so the two forms
    // have to make the same decision — including the fallbacks.
    const handles = indexHandles(bounds);
    const cases: ReadonlyArray<{
      edges: ReadonlyArray<FlowNode>;
      edge: FlowEdge;
    }> = [
      { edges: [sourceHandle, targetHandle], edge: edge() },
      {
        edges: [sourceHandle, targetHandle],
        edge: { id: "e1", source: "a", target: "b" },
      },
      {
        edges: [sourceHandle, targetHandle],
        edge: edge({ sourceHandle: "x" }),
      },
      { edges: [sourceHandle], edge: edge() },
    ];

    cases.forEach(({ edges, edge: current }) => {
      const nodes = new Map(edges.map((node) => [node.id, node] as const));
      expect(
        indexedEdgeEndpoints(model.nodeSizes, handles, nodes, current),
      ).toEqual(edgeEndpoints(model, current, edges));
    });
  });
});

describe("free connection ends", () => {
  test("the pointer is entered from the side it approaches", () => {
    expect(pointerHandlePosition({ x: 0, y: 0 }, { x: 100, y: 10 })).toBe(
      "Left",
    );
    expect(pointerHandlePosition({ x: 0, y: 0 }, { x: -100, y: 10 })).toBe(
      "Right",
    );
    expect(pointerHandlePosition({ x: 0, y: 0 }, { x: 10, y: 100 })).toBe(
      "Top",
    );
    expect(pointerHandlePosition({ x: 0, y: 0 }, { x: 10, y: -100 })).toBe(
      "Bottom",
    );
  });
});

describe("the connection a predicate is asked about", () => {
  test("carries node and handle ids, null when a handle is unnamed", () => {
    expect(
      connectionOf(
        { nodeId: "a", handleId: Option.some("out"), type: "Source" },
        { nodeId: "b", handleId: Option.none(), type: "Target" },
      ),
    ).toEqual({
      source: "a",
      target: "b",
      sourceHandle: "out",
      targetHandle: null,
    });
  });
});
