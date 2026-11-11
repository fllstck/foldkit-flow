import { Effect, Option } from "effect";
import { Server } from "foldkit/experimental";
import type { HtmlBuilder } from "foldkit/html";
import { describe, expect, test } from "vitest";

import type { Message } from "../message.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode, Model } from "../model.js";
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

type Pass = Readonly<{
  model: Model;
  nodes: ReadonlyArray<FlowNode>;
  edges?: ReadonlyArray<FlowEdge>;
}>;

/** A step is a render pass, or `dispose()` between two of them. */
type Step = Pass | Readonly<{ dispose: true }>;

const isDispose = (step: Step): step is Readonly<{ dispose: true }> =>
  "dispose" in step;

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

/**
 * Drives a renderer through steps in one runtime frame and counts how often the
 * consumer's node content is built and how often `accessibleName` is called — the
 * second count is what shows whether the **description memo** survived, because a
 * hit skips the description's own calls and leaves only the per-node aria labels.
 */
const renderSteps = async (
  steps: ReadonlyArray<Step>,
): Promise<{
  calls: number;
  names: number;
  renderer: ReturnType<typeof createRenderer>;
}> => {
  const counter = { calls: 0, names: 0 };

  const renderer = createRenderer({
    paneId: "test-pane",
    renderNode: (node, _tools, h) => {
      counter.calls += 1;
      return h.div([h.Class("node-body")], [node.id]);
    },
    accessibleName: (node) => {
      counter.names += 1;
      return node.id;
    },
  });

  const view = (current: Model, h: HtmlBuilder<Message>) => {
    const built: Array<ReturnType<typeof renderer.view>> = [];
    steps.forEach((step) => {
      if (isDispose(step)) {
        renderer.dispose();
        return;
      }
      built.push(
        renderer.view(
          {
            model: step.model,
            nodes: step.nodes,
            edges: step.edges ?? [],
            toParentMessage,
          },
          h,
        ),
      );
    });

    // Only the first pass is placed in the tree; the rest exist to drive the cache.
    return {
      title: "cache",
      body: h.div([h.Class("root")], [built[0] ?? h.empty]),
    };
  };

  await Effect.runPromise(
    Server.renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false },
    ),
  );

  return { calls: counter.calls, names: counter.names, renderer };
};

describe("renderer dispose (implicit-state audit, finding 1)", () => {
  test("drops the chrome memos as well as the node slots", async () => {
    // One array, two passes: the parent hands the flow the same graph across
    // frames, which is what the description memo keys on.
    // Both arrays are the parent's, held across frames: that is what the
    // description memo keys on, so the test has to hand over the same references.
    const nodes: ReadonlyArray<FlowNode> = [nodeA, nodeB];
    const edges: ReadonlyArray<FlowEdge> = [];

    // Pass one pays 2 aria labels plus the description's own 2 names; pass two pays
    // only its aria labels, because the description memo hits.
    const cached = await renderSteps([
      { model, nodes, edges },
      { model, nodes, edges },
    ]);
    expect(cached.names).toBe(6);

    // The same two passes with a dispose between them: the description is rebuilt,
    // so the second pass pays its own `accessibleName` calls again.
    const disposed = await renderSteps([
      { model, nodes, edges },
      { dispose: true },
      { model, nodes, edges },
    ]);
    // 4 per pass: the description did not survive the dispose.
    expect(disposed.names).toBe(8);
    // …and the node slots were dropped too.
    expect(disposed.calls).toBe(4);
    expect(disposed.renderer.cacheSize()).toBe(2);
  });

  test("a disposed renderer is back to its initial state, then repopulates", async () => {
    const { calls, renderer } = await renderSteps([
      { model, nodes: [nodeA] },
      { dispose: true },
      { model, nodes: [nodeA] },
    ]);

    // The rebuild is not a leak in the other direction: the cache is usable again.
    expect(calls).toBe(2);
    expect(renderer.cacheSize()).toBe(1);
  });
});

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
