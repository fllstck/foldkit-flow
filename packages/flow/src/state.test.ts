import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { Story } from "foldkit";

import { Message } from "./message.js";
import { Gesture, init } from "./model.js";
import type {
  Context,
  FlowEdge,
  FlowNode,
  Pointer,
  ResizeControl,
} from "./model.js";
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
  // The sequence half of "assert the next step" (`docs/TEST-STRATEGY.md`): the two
  // bugs reported in M5 both lived *between* two interactions, and a single-step
  // test cannot see them. These are rung 2 — no view, no browser.
  test("a second drag emits its own fact, not the first one again", () => {
    const press = (x: number, y: number) =>
      Message.PressedNode({
        nodeId: "n1",
        point: { x, y },
        isAdditive: false,
        pointer: mouse,
      });
    const move = (screenX: number, screenY: number) =>
      Message.MovedPointer({ screenX, screenY, pointerId: 1 });

    story(
      flow().update,
      given(initial),
      message(press(10, 10)),
      message(move(30, 20)),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.MovedNodes({ nodes: [{ nodeId: "n1", x: 20, y: 10 }] }),
      ),
      // The gesture is idle again, so the second press starts from the pointer it
      // is given rather than from the first gesture's origin.
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
      message(press(100, 100)),
      message(move(150, 130)),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.MovedNodes({ nodes: [{ nodeId: "n1", x: 50, y: 30 }] }),
      ),
    );
  });

  test("a cancelled drag leaves nothing behind: the next drag commits once", () => {
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
      message(Message.MovedPointer({ screenX: 60, screenY: 60, pointerId: 1 })),
      // A pointercancel (or blur, or Escape) drops the overlay and commits nothing.
      message(Message.CancelledGesture({ reason: "PointerCancel" })),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
      message(
        Message.PressedNode({
          nodeId: "n1",
          point: { x: 200, y: 200 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      message(
        Message.MovedPointer({ screenX: 210, screenY: 205, pointerId: 1 }),
      ),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      // One fact, and it is the second gesture's delta — not the cancelled one's.
      expectOutMessage(
        OutMessage.MovedNodes({ nodes: [{ nodeId: "n1", x: 10, y: 5 }] }),
      ),
    );
  });

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
          anchor: { x: 0, y: 0 },
          snapGrid: Option.none(),
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

describe("resize", () => {
  const started = (nodeId = "n1", control: ResizeControl = "bottom-right") =>
    message(
      Message.StartedResize({
        nodeId,
        control,
        pointer: mouse,
      }),
    );

  test("drag, release: one ResizedNodes with the box and the new position", () => {
    // n1 is 100×40 at (0, 0). Dragging the bottom-right control to (130, 90)
    // grows it to 130×90; the origin does not move.
    story(
      flow().update,
      given(initial),
      started(),
      message(
        Message.MovedPointer({ screenX: 130, screenY: 90, pointerId: 1 }),
      ),
      model((m) => {
        if (!Gesture.guards.Resizing(m.gesture)) throw new Error("no resize");
        expect(m.gesture.current).toEqual({
          left: 0,
          top: 0,
          width: 130,
          height: 90,
        });
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ResizedNodes({
          nodes: [{ nodeId: "n1", x: 0, y: 0, width: 130, height: 90 }],
        }),
      ),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
        // The box is the measurement now, so geometry agrees with the DOM
        // without waiting for the ResizeObserver.
        expect(m.nodeSizes).toContainEqual({
          nodeId: "n1",
          width: 130,
          height: 90,
        });
      }),
    );
  });

  test("a top-left resize reports the new position too", () => {
    story(
      flow().update,
      given(initial),
      started("n1", "top-left"),
      message(Message.MovedPointer({ screenX: 20, screenY: 10, pointerId: 1 })),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ResizedNodes({
          nodes: [{ nodeId: "n1", x: 20, y: 10, width: 80, height: 30 }],
        }),
      ),
    );
  });

  test("a release without movement emits nothing", () => {
    story(
      flow().update,
      given(initial),
      started(),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectNoOutMessage(),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("a resize does not select the node it resizes", () => {
    story(
      flow().update,
      given({ ...initial, selectedNodeIds: ["n2"] }),
      started(),
      model((m) => {
        expect(m.selectedNodeIds).toEqual(["n2"]);
      }),
    );
  });

  test("cancel drops the resize without a fact", () => {
    story(
      flow().update,
      given(initial),
      started(),
      message(
        Message.MovedPointer({ screenX: 130, screenY: 90, pointerId: 1 }),
      ),
      message(Message.CancelledGesture({ reason: "Escape" })),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("a foreign pointer cannot move or finish the resize", () => {
    story(
      flow().update,
      given(initial),
      started(),
      message(
        Message.MovedPointer({ screenX: 300, screenY: 300, pointerId: 7 }),
      ),
      message(Message.ReleasedPointer({ pointerId: 7 })),
      model((m) => {
        if (!Gesture.guards.Resizing(m.gesture)) throw new Error("no resize");
        expect(m.gesture.current).toEqual({
          left: 0,
          top: 0,
          width: 100,
          height: 40,
        });
      }),
    );
  });

  test("a resize snaps to the grid it was started with", () => {
    story(
      flow().update,
      given(initial),
      message(
        Message.StartedResize({
          nodeId: "n1",
          control: "bottom-right",
          pointer: mouse,
          snapGrid: { x: 20, y: 20 },
        }),
      ),
      message(
        Message.MovedPointer({ screenX: 133, screenY: 47, pointerId: 1 }),
      ),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ResizedNodes({
          nodes: [{ nodeId: "n1", x: 0, y: 0, width: 140, height: 40 }],
        }),
      ),
    );
  });
});

describe("snap grid", () => {
  const grid = { x: 20, y: 20 };

  const pressWithGrid = (nodeId: string) =>
    message(
      Message.PressedNode({
        nodeId,
        point: { x: 10, y: 10 },
        isAdditive: false,
        pointer: mouse,
        snapGrid: grid,
      }),
    );

  test("the grabbed node lands on a grid multiple, live during the drag", () => {
    // n1 starts at (0, 0), so a 23-unit drag snaps to 20 on both axes — and the
    // overlay already shows 20, not 23, so what is released is what was drawn.
    story(
      flow().update,
      given(initial),
      pressWithGrid("n1"),
      message(Message.MovedPointer({ screenX: 33, screenY: 33, pointerId: 1 })),
      model((m) => {
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        expect(m.gesture.delta).toEqual({ x: 20, y: 20 });
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.MovedNodes({ nodes: [{ nodeId: "n1", x: 20, y: 20 }] }),
      ),
    );
  });

  test("a node that starts off-grid snaps relative to its own origin", () => {
    // n2 is at (200, 100) — on the grid — and n3 below is deliberately not: the
    // snap is "the node you grabbed lands on a multiple", not "the pointer does".
    const offGrid = graphNode("n3", 203, 101);
    const shifted: Context = { nodes: [n1, offGrid], edges: [] };

    story(
      flow(shifted).update,
      given(initial),
      message(
        Message.PressedNode({
          nodeId: "n3",
          point: { x: 210, y: 110 },
          isAdditive: false,
          pointer: mouse,
          snapGrid: grid,
        }),
      ),
      message(
        Message.MovedPointer({ screenX: 220, screenY: 110, pointerId: 1 }),
      ),
      model((m) => {
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        // 203 + 10 = 213 → 220, so the delta is +17 and the node lands on 200.
        // The exact value is arithmetic; the invariant is a multiple of the grid.
        expect((203 + m.gesture.delta.x) % 20).toBe(0);
      }),
    );
  });

  test("without a grid the pointer delta is applied unchanged", () => {
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
      message(Message.MovedPointer({ screenX: 33, screenY: 33, pointerId: 1 })),
      model((m) => {
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        expect(m.gesture.delta).toEqual({ x: 23, y: 23 });
      }),
    );
  });
});

describe("sub-flows", () => {
  const parent = graphNode("parent", 100, 50);
  const child = graphNode("child", 10, 10, { parentId: "parent" });
  const subFlowContext: Context = { nodes: [parent, child], edges: [] };

  const press = (nodeId: string) =>
    message(
      Message.PressedNode({
        nodeId,
        point: { x: 0, y: 0 },
        isAdditive: false,
        pointer: mouse,
      }),
    );

  test("dragging a parent emits one fact for the parent, none for the child", () => {
    // The child carries a parent-relative position, so it follows the parent
    // without a fact of its own — and must not also carry the delta, or it would
    // move twice (§7 M4).
    story(
      flow(subFlowContext).update,
      given(initial),
      press("parent"),
      model((m) => {
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        expect(m.gesture.nodeIds).toEqual(["parent"]);
      }),
      message(Message.MovedPointer({ screenX: 30, screenY: 20, pointerId: 1 })),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.MovedNodes({
          nodes: [{ nodeId: "parent", x: 130, y: 70 }],
        }),
      ),
    );
  });

  test("dragging a child emits the child's relative position, unchanged by the parent", () => {
    story(
      flow(subFlowContext).update,
      given(initial),
      press("child"),
      message(Message.MovedPointer({ screenX: 30, screenY: 20, pointerId: 1 })),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.MovedNodes({
          nodes: [{ nodeId: "child", x: 40, y: 30 }],
        }),
      ),
    );
  });

  test("a selected parent and child do not both carry the delta", () => {
    story(
      flow(subFlowContext).update,
      given({ ...initial, selectedNodeIds: ["child"] }),
      message(
        Message.PressedNode({
          nodeId: "parent",
          point: { x: 0, y: 0 },
          isAdditive: true,
          pointer: mouse,
        }),
      ),
      model((m) => {
        if (!Gesture.guards.DraggingNodes(m.gesture))
          throw new Error("no drag");
        expect(m.gesture.nodeIds).toEqual(["parent"]);
      }),
    );
  });

  test("selectAll selects only what is shown (M4-REVIEW 2)", () => {
    // A collapsed container, its child, and an edge into the subtree. Selecting
    // them would put ids in the selection that the canvas never offered and that
    // `informGraphChanged` would prune on the next graph change.
    const hiddenParent = { ...parent, hidden: true };
    const contextWithCollapse: Context = {
      nodes: [hiddenParent, child, graphNode("loose", 0, 0)],
      edges: [
        { id: "e-in", source: "child", target: "loose" },
        { id: "e-out", source: "loose", target: "child" },
      ],
    };
    const result = selectAll(initial, contextWithCollapse);

    expect(result.model.selectedNodeIds).toEqual(["loose"]);
    expect(result.model.selectedEdgeIds).toEqual([]);
  });

  test("a collapsed subtree's selection and measurement are pruned", () => {
    const collapsed = informGraphChanged(
      {
        ...initial,
        selectedNodeIds: ["child", "parent"],
        nodeSizes: [
          { nodeId: "parent", width: 300, height: 200 },
          { nodeId: "child", width: 100, height: 40 },
        ],
      },
      {
        nodes: [{ ...parent, hidden: true }, child],
        edges: [],
      },
    ).model;

    // A collapsed node is not drawn, so it is not selected and not measured.
    expect(collapsed.selectedNodeIds).toEqual([]);
    expect(collapsed.nodeSizes).toEqual([]);
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
  // A connection and a drag are different gestures over the same pointer. The
  // second must not be read as a continuation of the first — this is the sequence
  // the demo's "drag right after connecting" path takes every day.
  test("a drag straight after a connection is a drag, and emits no connection", () => {
    const sourceHandle = {
      nodeId: "n1",
      handleId: Option.none(),
      type: "Source" as const,
    };
    const withTarget = {
      ...initial,
      paneId: Option.some("p"),
      handleBounds: [
        {
          nodeId: "n2",
          handleId: Option.none(),
          type: "Target" as const,
          position: "Top" as const,
          x: 40,
          y: -4,
          width: 8,
          height: 8,
        },
      ],
    };

    story(
      flow().update,
      given(withTarget),
      // 1. connect n1 -> n2
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
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ConnectedHandles({
          source: sourceHandle,
          target: { nodeId: "n2", handleId: Option.none(), type: "Target" },
        }),
      ),
      // 2. drag n1 by the same pointer
      message(
        Message.PressedNode({
          nodeId: "n1",
          point: { x: 10, y: 10 },
          isAdditive: false,
          pointer: mouse,
        }),
      ),
      message(Message.MovedPointer({ screenX: 25, screenY: 18, pointerId: 1 })),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      // The drag's fact and nothing else: a stale connection state here would
      // emit a second `ConnectedHandles`.
      expectOutMessage(
        OutMessage.MovedNodes({ nodes: [{ nodeId: "n1", x: 15, y: 8 }] }),
      ),
    );
  });

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

  test("an invalid connection is rejected at release, not at hover", () => {
    // The predicate is the parent's, and here it rejects a duplicate of an edge
    // the graph already has. Hover still shows the target — the release is where
    // the fact would have become an OutMessage (§7 M2).
    const rejecting: Context = {
      ...context,
      isValidConnection: ({ source, target }) =>
        !context.edges.some(
          (existing) =>
            existing.source === source && existing.target === target,
        ),
    };

    story(
      flow(rejecting).update,
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
        expect(Option.isSome(m.gesture.maybeTarget)).toBe(true);
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectNoOutMessage(),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("a self-loop is rejected only because the predicate says so", () => {
    const selfTarget = {
      nodeId: "n1",
      handleId: Option.none(),
      type: "Target" as const,
      position: "Left" as const,
      x: 0,
      y: 16,
      width: 8,
      height: 8,
    };
    const selfBounds = { ...withBounds, handleBounds: [selfTarget] };
    const rejecting: Context = {
      ...context,
      isValidConnection: (connection) =>
        connection.source !== connection.target,
    };

    story(
      flow(rejecting).update,
      given(selfBounds),
      message(
        Message.StartedConnection({ from: sourceHandle, pointer: mouse }),
      ),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.MovedPointer({ screenX: 4, screenY: 20, pointerId: 1 })),
      model((m) => {
        if (!Gesture.guards.Connecting(m.gesture))
          throw new Error("no connect");
        expect(m.gesture.maybeTarget).toEqual(
          Option.some({
            nodeId: "n1",
            handleId: Option.none(),
            type: "Target",
          }),
        );
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectNoOutMessage(),
    );
  });

  test("a valid connection passes the predicate's Connection", () => {
    const seen: Array<unknown> = [];
    const accepting: Context = {
      ...context,
      isValidConnection: (connection) => {
        seen.push(connection);
        return true;
      },
    };

    story(
      flow(accepting).update,
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
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ConnectedHandles({
          source: sourceHandle,
          target: { nodeId: "n2", handleId: Option.none(), type: "Target" },
        }),
      ),
    );

    expect(seen).toEqual([
      { source: "n1", target: "n2", sourceHandle: null, targetHandle: null },
    ]);
  });

  test("with no predicate every target is accepted", () => {
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
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ConnectedHandles({
          source: sourceHandle,
          target: { nodeId: "n2", handleId: Option.none(), type: "Target" },
        }),
      ),
    );
  });

  // n1's source handle, measured: node-local (92,16) with n1 at (0,0), so its
  // centre is flow (96,20). Starting a gesture at n2's target handle and
  // releasing here is the reversed direction the review found.
  const n1SourceBounds = {
    nodeId: "n1",
    handleId: Option.none(),
    type: "Source" as const,
    position: "Right" as const,
    x: 92,
    y: 16,
    width: 8,
    height: 8,
  };
  const bothEnds = {
    ...withBounds,
    handleBounds: [n1SourceBounds, targetBounds],
  };
  const fromTarget = {
    nodeId: "n2",
    handleId: Option.none(),
    type: "Target" as const,
  };

  test("a gesture started at a target handle reports Source as source", () => {
    // The pointer travelled target → source, but the fact is Source → Target:
    // `source` names the handle kind, not where the drag began (§3.2).
    story(
      flow().update,
      given(bothEnds),
      message(Message.StartedConnection({ from: fromTarget, pointer: mouse })),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.MovedPointer({ screenX: 96, screenY: 20, pointerId: 1 })),
      model((m) => {
        if (!Gesture.guards.Connecting(m.gesture))
          throw new Error("no connect");
        expect(m.gesture.maybeTarget).toEqual(Option.some(sourceHandle));
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ConnectedHandles({
          source: sourceHandle,
          target: fromTarget,
        }),
      ),
    );
  });

  test("the predicate sees a target-originated gesture the same way round", () => {
    const seen: Array<unknown> = [];
    const recording: Context = {
      ...context,
      isValidConnection: (connection) => {
        seen.push(connection);
        return true;
      },
    };

    story(
      flow(recording).update,
      given(bothEnds),
      message(Message.StartedConnection({ from: fromTarget, pointer: mouse })),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.MovedPointer({ screenX: 96, screenY: 20, pointerId: 1 })),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ConnectedHandles({
          source: sourceHandle,
          target: fromTarget,
        }),
      ),
    );

    expect(seen).toEqual([
      { source: "n1", target: "n2", sourceHandle: null, targetHandle: null },
    ]);
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

describe("reconnect", () => {
  const n3 = graphNode("n3", 400, 0);

  // n3's target handle, node-local: centre (404,4).
  const n3Target = {
    nodeId: "n3",
    handleId: Option.some("in"),
    type: "Target" as const,
    position: "Left" as const,
    x: 0,
    y: 0,
    width: 8,
    height: 8,
  };

  const reconnecting: Context = {
    nodes: [n1, n2, n3],
    edges: [edge],
  };

  const started = {
    ...initial,
    paneId: Option.some("p"),
    handleBounds: [n3Target],
  };

  const start = message(
    Message.StartedReconnect({ edgeId: "e1", end: "Target", pointer: mouse }),
  );

  test("grabbing an edge end starts a reconnect and arms the checkpoint", () => {
    story(
      flow(reconnecting).update,
      given(started),
      start,
      Story.Command.expectExact(MeasureHandles),
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      model((m) => {
        if (!Gesture.guards.Reconnecting(m.gesture))
          throw new Error("no reconnect");
        // The end that is not moving anchors the preview: n1's border, because
        // e1 names no handles and none are measured.
        expect(m.gesture.current).toEqual({ x: 50, y: 40 });
        expect(m.gesture.maybeTarget).toEqual(Option.none());
      }),
    );
  });

  test("dropping the end on another handle reports ReconnectedEdge", () => {
    story(
      flow(reconnecting).update,
      given(started),
      start,
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.MovedPointer({ screenX: 404, screenY: 4, pointerId: 1 })),
      model((m) => {
        if (!Gesture.guards.Reconnecting(m.gesture))
          throw new Error("no reconnect");
        expect(m.gesture.maybeTarget).toEqual(
          Option.some({
            nodeId: "n3",
            handleId: Option.some("in"),
            type: "Target",
          }),
        );
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectOutMessage(
        OutMessage.ReconnectedEdge({
          edgeId: "e1",
          end: "Target",
          handle: { nodeId: "n3", handleId: Option.some("in"), type: "Target" },
        }),
      ),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("a reconnect only accepts the handle type of the end being dragged", () => {
    // n3's only handle is a target, and the target end is the one moving, so a
    // move over a source handle is not a candidate: hit-testing filters by type.
    story(
      flow(reconnecting).update,
      given({
        ...started,
        handleBounds: [{ ...n3Target, type: "Source" as const }],
      }),
      start,
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.MovedPointer({ screenX: 404, screenY: 4, pointerId: 1 })),
      model((m) => {
        if (!Gesture.guards.Reconnecting(m.gesture))
          throw new Error("no reconnect");
        expect(m.gesture.maybeTarget).toEqual(Option.none());
      }),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectNoOutMessage(),
    );
  });

  test("cancelling a reconnect leaves the edge exactly as the parent had it", () => {
    story(
      flow(reconnecting).update,
      given(started),
      start,
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.MovedPointer({ screenX: 404, screenY: 4, pointerId: 1 })),
      message(Message.CancelledGesture({ reason: "Escape" })),
      expectNoOutMessage(),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("the predicate rejects a reconnect too", () => {
    const rejecting: Context = {
      ...reconnecting,
      isValidConnection: (connection) => connection.target !== "n3",
    };

    story(
      flow(rejecting).update,
      given(started),
      start,
      Story.Command.resolve<"MeasureHandles", Message>(
        MeasureHandles,
        failedMeasure,
      ),
      message(Message.MovedPointer({ screenX: 404, screenY: 4, pointerId: 1 })),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      expectNoOutMessage(),
    );
  });

  test("an edge the parent no longer has cannot be reconnected", () => {
    story(
      flow({ nodes: [n1, n2, n3], edges: [] }).update,
      given(started),
      start,
      expectNoOutMessage(),
      model((m) => {
        expect(isIdle(m.gesture)).toBe(true);
      }),
    );
  });

  test("a graph change that removes the edge drops the gesture", () => {
    const dropped = informGraphChanged(
      {
        ...started,
        gesture: Gesture.Reconnecting({
          pointer: mouse,
          edgeId: "e1",
          end: "Target",
          current: { x: 0, y: 0 },
          maybeTarget: Option.none(),
        }),
      },
      { nodes: [n1, n2, n3], edges: [] },
    ).model;

    expect(isIdle(dropped.gesture)).toBe(true);
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

describe("chrome", () => {
  const mounted = { ...initial, paneId: Option.some("chrome-pane") };

  /** Scene-free Command read: `SyncViewport` is the only Command these Messages
   *  may emit, and its name is how `Command.define` identifies it. */
  const syncOf = (result: ReturnType<typeof update>) =>
    (result.commands ?? []).find(
      (command) => (command as { name?: string }).name === "SyncViewport",
    );

  test("zoom in multiplies the zoom and syncs the engine", () => {
    const result = update(mounted, Message.ClickedZoomIn(), context);

    expect(result.model.viewport.zoom).toBeCloseTo(1.2, 5);
    expect(syncOf(result)).toBeDefined();
  });

  test("zoom out divides it", () => {
    const result = update(
      { ...mounted, viewport: { x: 0, y: 0, zoom: 1.2 } },
      Message.ClickedZoomOut(),
      context,
    );

    expect(result.model.viewport.zoom).toBeCloseTo(1, 5);
  });

  test("zoom in stops at the Model's maxZoom, with no Command to run", () => {
    // At the bound the press is a no-op: nothing is written, nothing is
    // dispatched, and the engine is never asked to clamp on the Model's behalf.
    const atMax = { ...mounted, viewport: { x: 0, y: 0, zoom: 2 } };
    const result = update(atMax, Message.ClickedZoomIn(), context);

    expect(result.model.viewport.zoom).toBe(2);
    expect(result.commands ?? []).toHaveLength(0);
  });

  test("zoom out stops at the Model's minZoom", () => {
    const atMin = { ...mounted, viewport: { x: 0, y: 0, zoom: 0.1 } };
    const result = update(atMin, Message.ClickedZoomOut(), context);

    expect(result.model.viewport.zoom).toBe(0.1);
    expect(result.commands ?? []).toHaveLength(0);
  });

  test("custom bounds are the ones enforced", () => {
    const custom = {
      ...mounted,
      minZoom: 0.5,
      maxZoom: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    expect(
      update(custom, Message.ClickedZoomIn(), context).model.viewport.zoom,
    ).toBe(1);

    const zoomedOut = update(custom, Message.ClickedZoomOut(), context);
    expect(zoomedOut.model.viewport.zoom).toBeCloseTo(1 / 1.2, 5);

    const atFloor = { ...custom, viewport: { x: 0, y: 0, zoom: 0.5 } };
    expect(
      update(atFloor, Message.ClickedZoomOut(), context).model.viewport.zoom,
    ).toBe(0.5);
  });

  test("fit view moves the viewport to the fitted one", () => {
    const result = update(
      mounted,
      Message.ClickedFitView({
        padding: Option.none(),
        minZoom: Option.none(),
        maxZoom: Option.none(),
        duration: Option.none(),
      }),
      context,
    );

    // The nodes span 0..300 × 0..140 (100×40 boxes), in a 1000×800 pane: the
    // fitted zoom fills the height first and is clamped by maxZoom.
    expect(result.model.viewport.zoom).toBeGreaterThan(1);
    expect(syncOf(result)).toBeDefined();
  });

  test("fit view on an empty graph changes nothing", () => {
    const result = update(
      mounted,
      Message.ClickedFitView({
        padding: Option.none(),
        minZoom: Option.none(),
        maxZoom: Option.none(),
        duration: Option.none(),
      }),
      {
        nodes: [],
        edges: [],
      },
    );

    expect(result.model.viewport).toEqual(mounted.viewport);
    expect(result.commands ?? []).toHaveLength(0);
  });

  test("a minimap press centres the view on the flow point under it", () => {
    // The pane is 1000×800 at zoom 1, so centring (400, 300) puts the viewport
    // origin at (100, 100): the point lands at the pane's centre and nothing
    // else about the view changes.
    const result = update(
      mounted,
      Message.ClickedMiniMap({ point: { x: 400, y: 300 } }),
      context,
    );

    expect(result.model.viewport).toEqual({ x: 100, y: 100, zoom: 1 });
    expect(syncOf(result)).toBeDefined();
  });

  test("a minimap press at zoom scales the centring, not the zoom", () => {
    const zoomed = { ...mounted, viewport: { x: 0, y: 0, zoom: 0.5 } };
    const result = update(
      zoomed,
      Message.ClickedMiniMap({ point: { x: 400, y: 300 } }),
      context,
    );

    // The point is still centred; the zoom is untouched.
    expect(result.model.viewport.zoom).toBe(0.5);
    expect(result.model.viewport.x).toBe(500 - 400 * 0.5);
    expect(result.model.viewport.y).toBe(400 - 300 * 0.5);
  });

  test("an arrow-key nudge reports one MovedNodes for the focused node", () => {
    story(
      flow().update,
      given(initial),
      message(Message.NudgedNode({ nodeId: "n2", delta: { x: 1, y: 0 } })),
      expectOutMessage(
        OutMessage.MovedNodes({ nodes: [{ nodeId: "n2", x: 201, y: 100 }] }),
      ),
    );
  });

  test("a nudge for a node the parent no longer has is ignored", () => {
    story(
      flow().update,
      given(initial),
      message(Message.NudgedNode({ nodeId: "gone", delta: { x: 1, y: 0 } })),
      expectNoOutMessage(),
    );
  });

  test("a nudge cannot move an undraggable node", () => {
    const frozen = {
      nodes: [graphNode("n1", 0, 0, { draggable: false })],
      edges: [],
    };
    story(
      flow(frozen).update,
      given(initial),
      message(Message.NudgedNode({ nodeId: "n1", delta: { x: 1, y: 0 } })),
      expectNoOutMessage(),
    );
  });
});

describe("keyboard activation", () => {
  test("Enter selects the node it is pressed on", () => {
    story(
      flow().update,
      given(initial),
      message(Message.ActivatedNode({ nodeId: "n1", isAdditive: false })),
      expectOutMessage(
        OutMessage.SelectedElements({ nodeIds: ["n1"], edgeIds: [] }),
      ),
    );
  });

  test("a modifier toggles it, the way a press does", () => {
    story(
      flow().update,
      given({ ...initial, selectedNodeIds: ["n1"] }),
      message(Message.ActivatedNode({ nodeId: "n1", isAdditive: true })),
      expectOutMessage(
        OutMessage.SelectedElements({ nodeIds: [], edgeIds: [] }),
      ),
    );
  });

  test("activation arms no drag: there is no pointer to own one", () => {
    story(
      flow().update,
      given(initial),
      message(Message.ActivatedNode({ nodeId: "n1", isAdditive: false })),
      model((current) => {
        expect(isIdle(current.gesture)).toBe(true);
      }),
    );
  });

  test("a node the parent no longer has is ignored", () => {
    story(
      flow().update,
      given(initial),
      message(Message.ActivatedNode({ nodeId: "gone", isAdditive: false })),
      expectNoOutMessage(),
    );
  });

  test("a node that opts out of selection leaves the selection alone", () => {
    const unselectable = {
      nodes: [graphNode("n1", 0, 0, { selectable: false })],
      edges: [],
    };
    story(
      flow(unselectable).update,
      given({ ...initial, selectedNodeIds: ["n2"] }),
      message(Message.ActivatedNode({ nodeId: "n1", isAdditive: false })),
      expectNoOutMessage(),
    );
  });
});
