import { Option } from "effect";
import * as Flow from "@fllstck/foldkit-flow";
import { Story } from "foldkit";
import { describe, expect, test } from "vitest";

import { createExampleApp } from "./harness";
import type { ExampleSpec } from "./spec";

/**
 * Rung 2 of `docs/TEST-STRATEGY.md`, and the gap `docs/TEST-STRATEGY-REVIEW.md`
 * finding 4 named: the shared harness folds every OutMessage into the parent's
 * graph, and collapses and fits — all of it asserted only by driving a browser
 * page (`tests/examples.spec.ts`, `tests/example.spec.ts`).
 *
 * Story drives the same `update` with the same Model, in about a millisecond, and
 * can see the parent's graph rather than the DOM it happens to render.
 */
const { story, given, message, model, expectNoOutMessage } = Story;

const spec: ExampleSpec = {
  name: "harness-fixture",
  category: "Basics",
  title: "Harness fixture",
  description:
    "A spec small enough to assert the harness's own transitions on.",
  nodes: [
    { id: "a", x: 0, y: 0, width: 160, height: 60, title: "A" },
    { id: "b", x: 240, y: 0, width: 160, height: 60, title: "B" },
    { id: "c", x: 120, y: 120, width: 160, height: 60, title: "C" },
  ],
  edges: [{ id: "e-a-b", source: "a", target: "b", markerEnd: "ArrowClosed" }],
  viewport: "fit",
  controls: { collapseIds: ["c"] },
};

const app = createExampleApp(spec, { spec: "", harness: "", css: "" });
const initial = app.init().model;

const pointer = { pointerId: 1, pointerType: "mouse", button: 0 } as const;

/** A flow Message, in the harness's own Message union. */
const fromFlow = (inner: Flow.Message) =>
  app.Message.GotFlowMessage({ message: inner });

const update = app.update;

const nodeOf = (current: typeof initial, id: string) =>
  current.graph.nodes.find((node) => node.id === id);

/** The pane's box, which a fit needs and jsdom cannot supply. */
const measuredPane = fromFlow(
  Flow.Message.ResizedPane({
    pane: { width: 900, height: 600, left: 0, top: 0 },
  }),
);

/** The pane, mounted: `MountedPane` precedes the first `ResizedPane` in the real
 *  runtime, and a fit folded from the measurement needs the id it folds. */
const withPane = {
  ...initial,
  flow: { ...initial.flow, paneId: Option.some("pane") },
};

const withHandleBounds = {
  ...initial,
  flow: {
    ...initial.flow,
    pane: { width: 900, height: 600, left: 0, top: 0 },
    paneId: Option.some("paneless"),
    handleBounds: [
      {
        nodeId: "b",
        handleId: Option.none(),
        type: "Target" as const,
        position: "Top" as const,
        x: 40,
        y: -4,
        width: 8,
        height: 8,
      },
    ],
  },
};

describe("the harness owns the graph the flow reads", () => {
  test("MovedNodes moves that node, in the space the parent gave it", () => {
    story(
      update,
      given(initial),
      message(
        fromFlow(
          Flow.Message.PressedNode({
            nodeId: "a",
            point: { x: 10, y: 10 },
            isAdditive: false,
            pointer,
          }),
        ),
      ),
      message(
        fromFlow(
          Flow.Message.MovedPointer({
            screenX: 30,
            screenY: 25,
            pointerId: pointer.pointerId,
          }),
        ),
      ),
      message(
        fromFlow(
          Flow.Message.ReleasedPointer({ pointerId: pointer.pointerId }),
        ),
      ),
      model((current) => {
        expect(nodeOf(current, "a")?.position).toEqual({ x: 20, y: 15 });
        // The other two nodes are untouched: a fold that moved the graph would
        // show here, not in the one node it names.
        expect(nodeOf(current, "b")?.position).toEqual({ x: 240, y: 0 });
        expect(current.lastFact).toBe("Moved a");
      }),
    );
  });

  test("ConnectedHandles appends the edge the parent should keep", () => {
    story(
      update,
      given(withHandleBounds),
      message(
        fromFlow(
          Flow.Message.StartedConnection({
            from: { nodeId: "a", handleId: Option.none(), type: "Source" },
            pointer,
          }),
        ),
      ),
      Story.Command.resolve<"MeasureHandles", Flow.Message>(
        Flow.MeasureHandles,
        Flow.Message.FailedMeasureHandles({ reason: "test" }),
      ),
      message(
        fromFlow(
          // Node b is at (240, 0) and its target handle sits at x 40, y -4 in
          // node-local space, so the handle's centre is screen (284, 0) at zoom 1.
          Flow.Message.MovedPointer({ screenX: 284, screenY: 0, pointerId: 1 }),
        ),
      ),
      message(fromFlow(Flow.Message.ReleasedPointer({ pointerId: 1 }))),
      model((current) => {
        expect(current.graph.edges).toHaveLength(2);
        expect(current.graph.edges[1]).toMatchObject({
          source: "a",
          target: "b",
          markerEnd: "ArrowClosed",
        });
        expect(current.lastFact).toBe("Connected a → b");
      }),
    );
  });

  test("ResizedNodes persists the box and the position the flow reports", () => {
    story(
      update,
      given(initial),
      message(
        fromFlow(
          Flow.Message.StartedResize({
            nodeId: "a",
            control: "bottom-right",
            pointer,
          }),
        ),
      ),
      message(
        fromFlow(
          Flow.Message.MovedPointer({
            screenX: 260,
            screenY: 140,
            pointerId: 1,
          }),
        ),
      ),
      message(fromFlow(Flow.Message.ReleasedPointer({ pointerId: 1 }))),
      model((current) => {
        const box = nodeOf(current, "a")?.size;
        expect(box?.width).toBeGreaterThan(160);
        expect(box?.height).toBeGreaterThan(60);
      }),
    );
  });

  test("DeletedElements removes the selected node and the edges that died with it", () => {
    story(
      update,
      given({ ...initial, flow: { ...initial.flow, selectedNodeIds: ["b"] } }),
      message(fromFlow(Flow.Message.PressedDeleteKey())),
      model((current) => {
        expect(nodeOf(current, "b")).toBeUndefined();
        // `e-a-b` had both ends in the graph and only one of them was deleted, so
        // the harness keeps it: removing edges is the flow's rule, not the
        // parent's (`shownEdges`), and an edge with a missing end is dropped there.
        expect(current.graph.edges).toHaveLength(1);
      }),
    );
  });

  test("SelectedElements names an edge too, not only a node (§7 M6)", () => {
    // The consumer half of edge selection: the harness folds the flow's
    // `SelectedElements` into a sentence, and before M6 it read only `nodeIds` —
    // so selecting an edge would have reported "Nothing selected" on a page whose
    // whole job is to show what the flow reported.
    story(
      update,
      given(initial),
      message(
        fromFlow(
          Flow.Message.ActivatedNode({ nodeId: "a", isAdditive: false }),
        ),
      ),
      model((current) => {
        expect(current.lastFact).toBe("Selected node a");
      }),
      // Shift (the additive modifier) adds the edge instead of replacing.
      message(
        fromFlow(
          Flow.Message.PressedEdge({ edgeId: "e-a-b", isAdditive: true }),
        ),
      ),
      model((current) => {
        expect(current.lastFact).toBe("Selected node a and edge e-a-b");
      }),
      // A plain press on the edge selects it alone: one press, one kind of thing.
      message(
        fromFlow(
          Flow.Message.PressedEdge({ edgeId: "e-a-b", isAdditive: false }),
        ),
      ),
      model((current) => {
        expect(current.lastFact).toBe("Selected edge e-a-b");
      }),
      message(
        fromFlow(
          Flow.Message.PressedPane({
            point: { x: 0, y: 0 },
            isAdditive: false,
            pointer,
          }),
        ),
      ),
      model((current) => {
        expect(current.lastFact).toBe("Nothing selected");
      }),
    );
  });

  test("collapsing is the parent's edit, and it toggles both ways", () => {
    story(
      update,
      given(initial),
      message(app.Message.ClickedToggleCollapse()),
      model((current) => {
        expect(nodeOf(current, "c")?.hidden).toBe(true);
        expect(current.lastFact).toBe("Collapsed");
      }),
      message(app.Message.ClickedToggleCollapse()),
      model((current) => {
        expect(nodeOf(current, "c")?.hidden).toBeUndefined();
        expect(current.lastFact).toBe("Expanded");
      }),
    );
  });
});

describe("the harness fits once, from the pane's own measurement", () => {
  test("nothing fits before the pane has been measured", () => {
    story(
      update,
      given(withPane),
      // A message that is not the pane's measurement: the fit has no box to work
      // with, so it must not run — and must not ask the engine for anything.
      message(
        fromFlow(
          Flow.Message.MovedViewport({
            viewport: { x: 10, y: 10, zoom: 1 },
            isGestureEnd: true,
          }),
        ),
      ),
      expectNoOutMessage(),
      model((current) => {
        expect(current.isFitted).toBe(false);
      }),
    );
  });

  // The positive half — "the first `ResizedPane` fits, and the fit reaches the
  // engine" — is asserted one rung up (`view/chrome.scene.test.ts`: a fit press
  // emits `SyncViewport`) and one rung up again (`tests/example.spec.ts`: a pan
  // after the fit keeps the zoom). It cannot be asserted here: the fit's Command
  // is `Command.mapMessages`-wrapped into this app's Message union, and `Story`
  // validates a resolved result against the *Definition's* message schemas, so
  // there is no message that is both the app's and the Command's.
  test("a later ResizedPane does not fit again, and emits nothing", () => {
    story(
      update,
      given({ ...withPane, isFitted: true }),
      message(measuredPane),
      // A window resize must not yank the view back to the whole graph: the fit is
      // a one-time entrance, and the button is how a reader asks for it again.
      expectNoOutMessage(),
      model((current) => {
        expect(current.isFitted).toBe(true);
        expect(current.flow.viewport).toEqual(initial.flow.viewport);
      }),
    );
  });
});
