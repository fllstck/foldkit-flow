import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { Story } from "foldkit";

import { Message } from "./message.js";
import { Gesture, init } from "./model.js";
import type { Context, FlowEdge, FlowNode, Pointer } from "./model.js";
import { OutMessage } from "./outMessage.js";
import { MeasureHandles } from "./runtime/command.js";
import { informGraphChanged, selectAll, update } from "./update.js";

const { story, given, message, model, expectOutMessage, expectNoOutMessage } =
  Story;

const graphNode = (
  id: string,
  x: number,
  y: number,
  overrides?: Partial<FlowNode<{ label: string }>>,
): FlowNode<{ label: string }> => ({
  id,
  position: { x, y },
  size: { width: 100, height: 40 },
  data: { label: id },
  ...overrides,
});

const n1 = graphNode("n1", 0, 0);
const n2 = graphNode("n2", 200, 100);

const edge: FlowEdge = {
  id: "e1",
  source: "n1",
  target: "n2",
};

const context: Context = { nodes: [n1, n2], edges: [edge] };

const mouse: Pointer = { pointerId: 1, pointerType: "mouse", button: 0 };

/** Typed as the whole Message union so `Story.Command.resolve` can infer a
 *  result type the Command's own union of results is assignable to. */
const failedMeasure: Message = Message.FailedMeasureHandles({
  reason: "test",
});

const initial = {
  ...init().model,
  pane: { width: 1000, height: 800, left: 0, top: 0 },
};

const flow = (givenContext: Context = context) => ({
  update: (current: typeof initial, input: Message) =>
    update(current, input, givenContext),
});

const isIdle = (gesture: Gesture): boolean => Gesture.guards.Idle(gesture);

describe("node drag", () => {
  test("press, move, release commits one MovedNodes", () => {
    story(
      flow().update,
      given(initial),
      message(
        Message.PressedNode({
          nodeId: "n1",
          point: { x: 10, y: 10 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      model((m) => {
        expect(m.selectedNodeIds).toEqual(["n1"]);
        expect(Gesture.guards.DraggingNodes(m.gesture)).toBe(true);
      }),
      message(Message.MovedPointer({ screenX: 30, screenY: 20, pointerId: 1 })),
      model((m) => {
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        expect(m.gesture.delta).toEqual({ x: 20, y: 10 });
        expect(m.gesture.hasMoved).toBe(true);
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.MovedNodes({ nodes: [{ nodeId: "n1", x: 20, y: 10 }] }),
      ),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("a release without movement emits no MovedNodes", () => {
    story(
      flow().update,
      given(initial),
      message(
        Message.PressedNode({
          nodeId: "n1",
          point: { x: 10, y: 10 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      model(() => {}),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectNoOutMessage(),
    );
  });

  test("additive press drags the whole selection", () => {
    story(
      flow().update,
      given({ ...initial, selectedNodeIds: ["n1"] }),
      message(
        Message.PressedNode({
          nodeId: "n2",
          point: { x: 0, y: 0 },
          isAdditive: true,
          pointer: mouse,
        }),
      ),
      model((m) => {
        expect(m.selectedNodeIds).toEqual(["n1", "n2"]);
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        expect(m.gesture.nodeIds).toEqual(["n1", "n2"]);
      }),
      message(Message.MovedPointer({ screenX: 5, screenY: 5, pointerId: 1 })),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.MovedNodes({
          nodes: [
            { nodeId: "n1", x: 5, y: 5 },
            { nodeId: "n2", x: 205, y: 105 },
          ],
        }),
      ),
    );
  });

  test("pointer events from a foreign pointerId are ignored", () => {
    story(
      flow().update,
      given(initial),
      message(
        Message.PressedNode({
          nodeId: "n1",
          point: { x: 10, y: 10 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      model(() => {}),
      message(Message.MovedPointer({ screenX: 40, screenY: 40, pointerId: 2 })),
      model((m) => {
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        expect(m.gesture.delta).toEqual({ x: 0, y: 0 });
      }),
      message(Message.ReleasedPointer({ pointerId: 2 })),
      expectNoOutMessage(),
    );
  });

  test("a non-draggable node still selects but does not arm a drag", () => {
    const withFixedNode: Context = {
      nodes: [graphNode("n1", 0, 0, { draggable: false }), n2],
      edges: [],
    };

    story(
      flow(withFixedNode).update,
      given(initial),
      message(
        Message.PressedNode({
          nodeId: "n1",
          point: { x: 0, y: 0 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      model((m) => {
        expect(m.selectedNodeIds).toEqual(["n1"]);
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });
});

describe("cancellation", () => {
  test.each(["PointerCancel", "WindowBlur", "Escape"] as const)(
    "%s drops the overlay and leaves selection alone",
    (reason) => {
      story(
        flow().update,
        given({ ...initial, selectedNodeIds: ["n1"] }),
        message(
          Message.PressedNode({
            nodeId: "n1",
            point: { x: 10, y: 10 },
            isAdditive: false,
            pointer: mouse,
          }),
        ),
        model(() => {}),
        message(
          Message.MovedPointer({ screenX: 40, screenY: 40, pointerId: 1 }),
        ),
        model(() => {}),
        message(Message.CancelledGesture({ reason })),
        expectNoOutMessage(),
        model((m) => {
          expect(isIdle(m.gesture)).toBe(true);
          expect(m.selectedNodeIds).toEqual(["n1"]);
        }),
      );
    },
  );
});

describe("selection", () => {
  test("a pane press clears a non-additive selection", () => {
    story(
      flow().update,
      given({ ...initial, selectedNodeIds: ["n1"] }),
      message(
        Message.PressedPane({
          point: { x: 0, y: 0 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      expectOutMessage(
        OutMessage.SelectedElements({ nodeIds: [], edgeIds: [] }),
      ),
      model((m) => {
        expect(m.selectedNodeIds).toEqual([]);
      }),
    );
  });

  test("an additive pane press keeps the selection and emits nothing", () => {
    story(
      flow().update,
      given({ ...initial, selectedNodeIds: ["n1"] }),
      message(
        Message.PressedPane({
          point: { x: 0, y: 0 },
          isAdditive: true,
          pointer: mouse,
        }),
      ),
      expectNoOutMessage(),
      model((m) => {
        expect(m.selectedNodeIds).toEqual(["n1"]);
      }),
    );
  });

  test("additive node presses toggle membership", () => {
    story(
      flow().update,
      given({ ...initial, selectedNodeIds: ["n1"] }),
      message(
        Message.PressedNode({
          nodeId: "n1",
          point: { x: 0, y: 0 },
          isAdditive: true,
          pointer: mouse,
        }),
      ),
      expectOutMessage(
        OutMessage.SelectedElements({ nodeIds: [], edgeIds: [] }),
      ),
      model((m) => {
        expect(m.selectedNodeIds).toEqual([]);
      }),
    );
  });

  test("the additive modifier is tracked in the Model", () => {
    story(
      flow().update,
      given(initial),
      message(Message.ChangedModifierState({ isAdditive: true })),
      model((m) => {
        expect(m.isAdditiveModifier).toBe(true);
      }),
    );

    story(
      flow().update,
      given({ ...initial, isAdditiveModifier: true }),
      message(Message.ChangedModifierState({ isAdditive: false })),
      model((m) => {
        expect(m.isAdditiveModifier).toBe(false);
      }),
    );
  });

  test("selection keeps node and edge ids apart", () => {
    const selected = selectAll(initial, context);
    expect(selected.model.selectedNodeIds).toEqual(["n1", "n2"]);
    expect(selected.model.selectedEdgeIds).toEqual(["e1"]);
  });
});

describe("delete", () => {
  test("delete emits both kinds and clears the selection", () => {
    story(
      flow().update,
      given({
        ...initial,
        selectedNodeIds: ["n2"],
        selectedEdgeIds: ["e1"],
      }),
      message(Message.PressedDeleteKey()),
      expectOutMessage(
        OutMessage.DeletedElements({ nodeIds: ["n2"], edgeIds: ["e1"] }),
      ),
      model((m) => {
        expect(m.selectedNodeIds).toEqual([]);
        expect(m.selectedEdgeIds).toEqual([]);
      }),
    );
  });

  test("delete after the graph shrank never reports a dead id", () => {
    const shrunk: Context = { nodes: [n1], edges: [] };

    story(
      flow(shrunk).update,
      given({ ...initial, selectedNodeIds: ["n2"] }),
      message(Message.PressedDeleteKey()),
      expectNoOutMessage(),
      model((m) => {
        expect(m.selectedNodeIds).toEqual([]);
      }),
    );
  });

  test("delete with nothing selected emits nothing", () => {
    story(
      flow().update,
      given(initial),
      message(Message.PressedDeleteKey()),
      expectNoOutMessage(),
    );
  });
});

describe("graph reconciliation", () => {
  test("informGraphChanged drops selection, sizes, bounds, and dead gestures", () => {
    const removed = informGraphChanged(
      {
        ...initial,
        selectedNodeIds: ["n2"],
        selectedEdgeIds: ["e1"],
        nodeSizes: [
          { nodeId: "n1", width: 100, height: 40 },
          { nodeId: "n2", width: 100, height: 40 },
        ],
        handleBounds: [
          {
            nodeId: "n2",
            handleId: Option.none(),
            type: "Source",
            position: "Right",
            x: 0,
            y: 0,
            width: 8,
            height: 8,
          },
        ],
        gesture: Gesture.DraggingNodes({
          pointer: mouse,
          nodeIds: ["n2"],
          origin: { x: 0, y: 0 },
          delta: { x: 10, y: 10 },
          hasMoved: true,
        }),
      },
      { nodes: [n1], edges: [] },
    ).model;

    expect(removed.selectedNodeIds).toEqual([]);
    expect(removed.selectedEdgeIds).toEqual([]);
    expect(removed.nodeSizes).toEqual([
      { nodeId: "n1", width: 100, height: 40 },
    ]);
    expect(removed.handleBounds).toEqual([]);
    expect(isIdle(removed.gesture)).toBe(true);
  });

  test("a press for a node absent from the graph is ignored", () => {
    const shrunk: Context = { nodes: [n1], edges: [] };

    story(
      flow(shrunk).update,
      given(initial),
      message(
        Message.PressedNode({
          nodeId: "n2",
          point: { x: 0, y: 0 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      expectNoOutMessage(),
      model((m) => {
        expect(m.selectedNodeIds).toEqual([]);
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });
});

describe("handle bounds", () => {
  const sourceBounds = (
    nodeId: string,
    x: number,
  ): {
    nodeId: string;
    handleId: Option.Option<string>;
    type: "Source";
    position: "Right";
    x: number;
    y: number;
    width: number;
    height: number;
  } => ({
    nodeId,
    handleId: Option.none(),
    type: "Source",
    position: "Right",
    x,
    y: 18,
    width: 8,
    height: 8,
  });

  test("MergedHandleBounds replaces only its own nodes and prunes the missing", () => {
    const before = {
      ...initial,
      handleBounds: [
        sourceBounds("n1", 1),
        sourceBounds("n2", 2),
        sourceBounds("n3", 3),
      ],
    };

    story(
      flow().update,
      given(before),
      message(
        Message.MergedHandleBounds({
          entries: [
            {
              nodeId: "n1",
              handles: [
                {
                  nodeId: "n1",
                  handleId: Option.none(),
                  type: "Source",
                  position: "Right",
                  x: 11,
                  y: 12,
                  width: 8,
                  height: 8,
                },
              ],
            },
          ],
          missingNodeIds: ["n3"],
        }),
      ),
      model((m) => {
        expect(m.handleBounds).toEqual([
          sourceBounds("n2", 2),
          {
            nodeId: "n1",
            handleId: Option.none(),
            type: "Source",
            position: "Right",
            x: 11,
            y: 12,
            width: 8,
            height: 8,
          },
        ]);
      }),
    );
  });

  test("a single node's measurement replaces only that node's slice", () => {
    story(
      flow().update,
      given({
        ...initial,
        handleBounds: [sourceBounds("n1", 1), sourceBounds("n2", 2)],
      }),
      message(Message.MeasuredHandles({ nodeId: "n1", handles: [] })),
      model((m) => {
        expect(m.handleBounds).toEqual([sourceBounds("n2", 2)]);
      }),
    );
  });

  test("a viewport change leaves measured bounds untouched", () => {
    const measured = {
      ...initial,
      handleBounds: [sourceBounds("n1", 1)],
    };

    story(
      flow().update,
      given(measured),
      message(
        Message.MovedViewport({
          viewport: { x: -300, y: -200, zoom: 2 },
          isGestureEnd: false,
        }),
      ),
      model((m) => {
        expect(m.handleBounds).toEqual(measured.handleBounds);
      }),
    );
  });
});

describe("connections", () => {
  const sourceHandle = {
    nodeId: "n1",
    handleId: Option.none(),
    type: "Source" as const,
  };

  const targetBounds = {
    nodeId: "n2",
    handleId: Option.none(),
    type: "Target" as const,
    position: "Top" as const,
    x: 40,
    y: -4,
    width: 8,
    height: 8,
  };

  const withBounds = {
    ...initial,
    paneId: Option.some("p"),
    handleBounds: [targetBounds],
  };

  test("starting a connection arms the checkpoint Command", () => {
    story(
      flow().update,
      given(withBounds),
      message(
        Message.StartedConnection({ from: sourceHandle, pointer: mouse }),
      ),
      Story.Command.expectExact(MeasureHandles),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      model((m) => {
        expect(Gesture.guards.Connecting(m.gesture)).toBe(true);
      }),
    );
  });

  test("no mounted pane means no checkpoint Command", () => {
    story(
      flow().update,
      given({ ...withBounds, paneId: Option.none() }),
      message(
        Message.StartedConnection({ from: sourceHandle, pointer: mouse }),
      ),
      Story.Command.expectNone(),
      model(() => {}),
    );
  });

  test("releasing over a target handle reports ConnectedHandles", () => {
    story(
      flow().update,
      given(withBounds),
      message(
        Message.StartedConnection({ from: sourceHandle, pointer: mouse }),
      ),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(
        Message.MovedPointer({ screenX: 244, screenY: 100, pointerId: 1 }),
      ),
      model((m) => {
        if (!Gesture.guards.Connecting(m.gesture))
          throw new Error("no connect");
        expect(m.gesture.maybeTarget).toEqual(
          Option.some({
            nodeId: "n2",
            handleId: Option.none(),
            type: "Target",
          }),
        );
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ConnectedHandles({
          source: sourceHandle,
          target: { nodeId: "n2", handleId: Option.none(), type: "Target" },
        }),
      ),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("releasing away from any handle emits nothing", () => {
    story(
      flow().update,
      given(withBounds),
      message(
        Message.StartedConnection({ from: sourceHandle, pointer: mouse }),
      ),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(
        Message.MovedPointer({ screenX: 10, screenY: 400, pointerId: 1 }),
      ),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectNoOutMessage(),
    );
  });

  test("cancelling a connection emits nothing", () => {
    story(
      flow().update,
      given(withBounds),
      message(
        Message.StartedConnection({ from: sourceHandle, pointer: mouse }),
      ),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.CancelledGesture({ reason: "Escape" })),
      expectNoOutMessage(),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });
});

describe("viewport", () => {
  test("a non-terminal frame writes the viewport without an OutMessage", () => {
    story(
      flow().update,
      given(initial),
      message(
        Message.MovedViewport({
          viewport: { x: -10, y: -20, zoom: 1 },
          isGestureEnd: false,
        }),
      ),
      expectNoOutMessage(),
    );
  });

  test("the terminal frame reports ChangedViewport once", () => {
    story(
      flow().update,
      given(initial),
      message(
        Message.MovedViewport({
          viewport: { x: -10, y: -20, zoom: 1 },
          isGestureEnd: true,
        }),
      ),
      expectOutMessage(
        OutMessage.ChangedViewport({ viewport: { x: -10, y: -20, zoom: 1 } }),
      ),
    );
  });
});
