import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import type { HtmlBuilder } from "foldkit/html";
import { describe, expect, test } from "vitest";

import type { Message } from "../message.js";
import { init } from "../model.js";
import type { FlowNode, Model } from "../model.js";
import { createRenderer } from "./view.js";

const toParentMessage = (message: Message): Message => message;

const model: Model = init().model;

const nodeA: FlowNode = {
  id: "a",
  position: { x: 0, y: 0 },
  size: { width: 100, height: 40 },
  data: null,
};
const nodeB: FlowNode = {
  id: "b",
  position: { x: 200, y: 0 },
  size: { width: 100, height: 40 },
  data: null,
};

type Pass = Readonly<{ model: Model; nodes: ReadonlyArray<FlowNode> }>;

/**
 * Builds one render pass per entry inside a single runtime frame. Every pass
 * shares the dispatcher, so the slots see exactly what they see across two
 * renders of a live flow; only the arguments differ.
 */
const renderPasses = async (
  passes: ReadonlyArray<Pass>,
): Promise<{ calls: number; renderer: ReturnType<typeof createRenderer> }> => {
  const counter = { calls: 0 };

  const renderer = createRenderer({
    paneId: "test-pane",
    renderNode: (node, _tools, h) => {
      counter.calls += 1;
      return h.div([h.Class("node-body")], [node.id]);
    },
  });

  const view = (current: Model, h: HtmlBuilder<Message>) => {
    const built = passes.map((pass) =>
      renderer.view(
        {
          model: pass.model,
          nodes: pass.nodes,
          edges: [],
          toParentMessage,
        },
        h,
      ),
    );

    // Only the first pass is placed in the tree; the rest exist to drive the
    // cache. Cached VNodes are not re-rendered, so they must not be placed twice.
    return {
      title: "cache",
      body: h.div([h.Class("root")], [built[0] ?? h.empty]),
    };
  };

  await Effect.runPromise(
    Server.renderToString(
      { init: () => ({ model }), view },
      {
        isHydratable: false,
      },
    ),
  );

  return { calls: counter.calls, renderer };
};

describe("renderer node cache", () => {
  test("reuses a slot when the node and its inputs are unchanged", async () => {
    const { calls } = await renderPasses([
      { model, nodes: [nodeA, nodeB] },
      { model, nodes: [nodeA, nodeB] },
    ]);

    expect(calls).toBe(2);
  });

  test("a new node object invalidates its own slot", async () => {
    const renamed: FlowNode = { ...nodeA };

    const { calls } = await renderPasses([
      { model, nodes: [nodeA] },
      { model, nodes: [renamed] },
    ]);

    expect(calls).toBe(2);
  });

  test("a selection change invalidates the slots it affects", async () => {
    const selected: Model = { ...model, selectedNodeIds: ["a"] };

    const { calls } = await renderPasses([
      { model, nodes: [nodeA, nodeB] },
      { model: selected, nodes: [nodeA, nodeB] },
    ]);

    expect(calls).toBe(3);
  });

  test("drag frames do not invalidate any slot", async () => {
    const dragging = (x: number): Model => ({
      ...model,
      gesture: {
        _tag: "DraggingNodes",
        pointer: { pointerId: 1, pointerType: "mouse", button: 0 },
        nodeIds: ["a"],
        origin: { x: 0, y: 0 },
        anchor: { x: 0, y: 0 },
        snapGrid: Option.none(),
        delta: { x, y: x },
        hasMoved: true,
      },
    });

    // The live offset lives on the wrapper the renderer rebuilds every pass, so
    // two different deltas reuse the same slots.
    const { calls } = await renderPasses([
      { model: dragging(10), nodes: [nodeA, nodeB] },
      { model: dragging(20), nodes: [nodeA, nodeB] },
    ]);

    expect(calls).toBe(2);
  });

  test("the cache follows the current graph, not its history", async () => {
    const { renderer } = await renderPasses([
      { model, nodes: [nodeA] },
      { model, nodes: [nodeA, nodeB] },
      { model, nodes: [nodeA] },
    ]);

    expect(renderer.cacheSize()).toBe(1);
  });

  test("dispose empties the cache", async () => {
    const { renderer } = await renderPasses([{ model, nodes: [nodeA, nodeB] }]);

    expect(renderer.cacheSize()).toBe(2);
    renderer.dispose();
    expect(renderer.cacheSize()).toBe(0);
  });
});
