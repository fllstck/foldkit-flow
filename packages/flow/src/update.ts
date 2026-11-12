import { Array as Arr, Option } from "effect";
import type { Update } from "foldkit";

import {
  connectionOf,
  edgeAnchor,
  orientConnection,
} from "./geometry/handles.js";
import {
  connectionRadius,
  hitTestHandle,
  oppositeHandleType,
} from "./geometry/hitTest.js";
import { screenToFlow, viewportCentredOn } from "./geometry/screen.js";
import { hiddenIds, shownEdges, shownNodes } from "./geometry/hidden.js";
import {
  ancestorIds,
  positionIndex,
  positionOf,
} from "./geometry/positions.js";
import { visibleNodes } from "./geometry/visible.js";
import { resizeRect } from "./geometry/resize.js";
import { nodeRect } from "./geometry/bounds.js";
import { fitViewport } from "./geometry/fit.js";
import { Message } from "./message.js";
import { Gesture, clampZoom, zeroDelta } from "./model.js";
import type {
  Context,
  FlowEdge,
  HandleBounds,
  HandleRef,
  HandleType,
  Model,
  NodeSize,
  Point,
} from "./model.js";
import { OutMessage } from "./outMessage.js";
import { MeasureHandles, SyncViewport } from "./runtime/command.js";
import { snapPosition } from "./runtime/adapter.js";

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>;

const setNodeSize = (sizes: ReadonlyArray<NodeSize>, next: NodeSize) => [
  ...sizes.filter((size) => size.nodeId !== next.nodeId),
  next,
];

const replaceNodeHandles = (
  bounds: ReadonlyArray<HandleBounds>,
  nodeId: string,
  handles: ReadonlyArray<HandleBounds>,
): ReadonlyArray<HandleBounds> => [
  ...bounds.filter((entry) => entry.nodeId !== nodeId),
  ...handles,
];

const pruneNodeHandles = (
  bounds: ReadonlyArray<HandleBounds>,
  nodeIds: ReadonlyArray<string>,
): ReadonlyArray<HandleBounds> =>
  bounds.filter((entry) => !nodeIds.includes(entry.nodeId));

const selectionOf = (model: Model): OutMessage =>
  OutMessage.SelectedElements({
    nodeIds: model.selectedNodeIds,
    edgeIds: model.selectedEdgeIds,
  });

const hasSelection = (model: Model): boolean =>
  Arr.isReadonlyArrayNonEmpty(model.selectedNodeIds) ||
  Arr.isReadonlyArrayNonEmpty(model.selectedEdgeIds);

const isSameSelection = (a: Model, b: Model): boolean =>
  a.selectedNodeIds.length === b.selectedNodeIds.length &&
  a.selectedEdgeIds.length === b.selectedEdgeIds.length &&
  a.selectedNodeIds.every((id, index) => b.selectedNodeIds[index] === id) &&
  a.selectedEdgeIds.every((id, index) => b.selectedEdgeIds[index] === id);

/** Writes a selection and reports it only when it actually changed. */
const withSelection = (
  model: Model,
  nodeIds: ReadonlyArray<string>,
  edgeIds: ReadonlyArray<string> = [],
): UpdateReturn => {
  const next: Model = {
    ...model,
    selectedNodeIds: nodeIds,
    selectedEdgeIds: edgeIds,
  };
  return isSameSelection(model, next)
    ? { model: next }
    : { model: next, outMessage: selectionOf(next) };
};

const toggle = (
  ids: ReadonlyArray<string>,
  id: string,
): ReadonlyArray<string> =>
  ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];

const nodeById = (context: Context, nodeId: string) =>
  context.nodes.find((node) => node.id === nodeId);

/**
 * The selection a press or a keyboard activation produces. `undefined` means the
 * parent no longer has the node, which is the one case both callers ignore; a
 * node that opts out of selection leaves the selection alone, exactly as the
 * pointer path always has. Shared so the two input paths cannot diverge (§4.6).
 */
const nextNodeSelection = (
  model: Model,
  context: Context,
  nodeId: string,
  isAdditive: boolean,
): ReadonlyArray<string> | undefined => {
  const node = nodeById(context, nodeId);
  if (node === undefined) return undefined;
  if (node.selectable === false) return model.selectedNodeIds;

  const isSelected = model.selectedNodeIds.includes(nodeId);
  if (isAdditive) return toggle(model.selectedNodeIds, nodeId);
  return isSelected ? model.selectedNodeIds : [nodeId];
};

const isDraggable = (context: Context, nodeId: string): boolean =>
  nodeById(context, nodeId)?.draggable !== false;

/** The selection an edge press or activation produces (§7 M6). Edges have no
 *  `selectable` opt-out — a press target only exists when the renderer asked for
 *  one — so this is the node rule minus that branch, and it clears the node
 *  selection the same way, because one press selects one kind of thing. */
const nextEdgeSelection = (
  model: Model,
  edgeId: string,
  isAdditive: boolean,
): ReadonlyArray<string> =>
  isAdditive
    ? toggle(model.selectedEdgeIds, edgeId)
    : model.selectedEdgeIds.includes(edgeId)
      ? model.selectedEdgeIds
      : [edgeId];

const hasNode = (context: Context, nodeId: string): boolean =>
  nodeById(context, nodeId) !== undefined;

/** Flow-space point a gesture's preview starts from: the handle's measured
 *  centre, or the node-border anchor when it has not been measured yet — the
 *  same rule the edge renderer uses, so a preview cannot start somewhere the
 *  committed edge will not. */
const anchorOf = (
  model: Model,
  context: Context,
  ref: HandleRef,
): Option.Option<Point> =>
  Option.map(Option.fromNullishOr(nodeById(context, ref.nodeId)), (node) => {
    const anchor = edgeAnchor(
      model,
      node,
      ref.type,
      ref.handleId,
      positionIndex(context.nodes),
    );
    return { x: anchor.x, y: anchor.y };
  });

const edgeById = (context: Context, edgeId: string): Option.Option<FlowEdge> =>
  Option.fromNullishOr(context.edges.find((edge) => edge.id === edgeId));

/** One end of a parent-owned edge as a `HandleRef`, which is the shape the
 *  gesture carries and the predicate is asked about. */
const handleRefOf = (
  nodeId: string,
  type: HandleType,
  handleId: Option.Option<string>,
): HandleRef => ({ nodeId, type, handleId });

/** The end that stays put while the other one is dragged. */
const stationaryEndOf = (edge: FlowEdge, end: HandleType): HandleRef =>
  end === "Target"
    ? handleRefOf(
        edge.source,
        "Source",
        Option.fromNullishOr(edge.sourceHandle),
      )
    : handleRefOf(
        edge.target,
        "Target",
        Option.fromNullishOr(edge.targetHandle),
      );

/**
 * `context.isValidConnection` is evaluated in `update` (§7 M2), so an invalid
 * target never becomes an OutMessage and the parent is never asked to undo a
 * connection it would have rejected. No predicate means "accept everything".
 */
const isAcceptedConnection = (
  context: Context,
  source: HandleRef,
  target: HandleRef,
): boolean =>
  context.isValidConnection === undefined ||
  context.isValidConnection(connectionOf(source, target));

/** The handle a pointer is over, with the connection radius applied: the box is
 *  only 8×8 flow units, so "near enough to drop on it" is what makes a
 *  connection land when the release happens over the node rather than exactly on
 *  the handle (§7 M3 review follow-up). The radius is in screen pixels, divided by
 *  the zoom so it feels the same at every scale. */
const handleNear = (
  model: Model,
  point: Point,
  context: Context,
  accept: (bounds: HandleBounds) => boolean,
) =>
  hitTestHandle(model, point, context, {
    accept,
    tolerance: connectionRadius / model.viewport.zoom,
  });

const measureVisible = (model: Model, context: Context) =>
  Arr.fromOption(
    Option.map(model.paneId, (paneId) =>
      MeasureHandles({
        paneId,
        nodeIds: visibleNodes(model, context.nodes).map((node) => node.id),
      }),
    ),
  );

/** A node whose ancestor is also in the dragged set: its absolute position
 *  already follows the ancestor, so it must not carry the delta itself. */
const hasDraggedAncestor = (
  context: Context,
  nodeId: string,
  draggedIds: ReadonlyArray<string>,
): boolean => {
  const byId = new Map(context.nodes.map((node) => [node.id, node] as const));
  const node = byId.get(nodeId);
  if (node === undefined) return false;
  return ancestorIds(node, byId)
    .slice(1)
    .some((ancestorId) => draggedIds.includes(ancestorId));
};

/** Drag overlay for the pressed node's selection, clamped to the draggable ids
 *  that still exist in the graph. */
const draggingNodeIds = (
  model: Model,
  context: Context,
  selectedNodeIds: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  selectedNodeIds.filter(
    (id) =>
      hasNode(context, id) &&
      isDraggable(context, id) &&
      !hasDraggedAncestor(context, id, selectedNodeIds),
  );

const releaseDrag = (
  model: Model,
  context: Context,
  nodeIds: ReadonlyArray<string>,
  delta: { x: number; y: number },
  hasMoved: boolean,
): UpdateReturn => {
  if (!hasMoved) return { model: { ...model, gesture: Gesture.Idle() } };

  const moved = nodeIds.flatMap((nodeId) => {
    const node = nodeById(context, nodeId);
    if (node === undefined) return [];
    return [
      {
        nodeId,
        x: node.position.x + delta.x,
        y: node.position.y + delta.y,
      },
    ];
  });

  const cleared: Model = { ...model, gesture: Gesture.Idle() };
  return Arr.isReadonlyArrayEmpty(moved)
    ? { model: cleared }
    : { model: cleared, outMessage: OutMessage.MovedNodes({ nodes: moved }) };
};

/**
 * The release of a resize gesture: one fact, and the box the flow itself will
 * draw from now on.
 *
 * `nodeSizes` is written here as well as reported, because the box *is* the
 * measurement — the node Mount's `ResizeObserver` would report exactly these
 * numbers a frame later, and waiting for it would let an edge anchor on the old
 * size for one frame. The gesture is dropped, so nothing but the parent's graph
 * remembers a position: `ResizedNodes` carries `x`/`y` in the space the flow
 * received the node in (absolute, or parent-relative for a child).
 */
const releaseResize = (
  model: Model,
  context: Context,
  gesture: Extract<Gesture, { _tag: "Resizing" }>,
): UpdateReturn => {
  const node = nodeById(context, gesture.nodeId);
  const cleared: Model = { ...model, gesture: Gesture.Idle() };
  if (node === undefined) return { model: cleared };

  const { current, start } = gesture;
  const isUnchanged =
    current.left === start.left &&
    current.top === start.top &&
    current.width === start.width &&
    current.height === start.height;
  if (isUnchanged) return { model: cleared };

  // The gesture holds an absolute box; the fact is relative to the parent chain.
  const origin = Option.getOrElse(
    Option.map(Option.fromNullishOr(node.parentId), (parentId) =>
      Option.getOrElse(
        Option.map(
          Option.fromNullishOr(nodeById(context, parentId)),
          (parent) => positionOf(parent, positionIndex(context.nodes)),
        ),
        () => ({ x: 0, y: 0 }),
      ),
    ),
    () => ({ x: 0, y: 0 }),
  );

  return {
    model: {
      ...cleared,
      nodeSizes: setNodeSize(model.nodeSizes, {
        nodeId: gesture.nodeId,
        width: current.width,
        height: current.height,
      }),
    },
    outMessage: OutMessage.ResizedNodes({
      nodes: [
        {
          nodeId: gesture.nodeId,
          x: current.left - origin.x,
          y: current.top - origin.y,
          width: current.width,
          height: current.height,
        },
      ],
    }),
  };
};

/**
 * `Flow.update` reads the graph through `context` and never stores it (§2.5.1).
 * Gesture-initiating Messages verify their ids against that graph and are
 * ignored when the id is gone, so a mid-gesture graph change can never produce
 * an OutMessage about a dead node (§2.5.9).
 */
export const update = (
  model: Model,
  message: Message,
  context: Context,
): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    MountedPane: ({ paneId }) => ({
      model: { ...model, paneId: Option.some(paneId) },
    }),
    FailedMountPane: () => ({ model }),
    ResizedPane: ({ pane }) => ({ model: { ...model, pane } }),

    MeasuredNode: ({ nodeId, size }) => ({
      model: {
        ...model,
        nodeSizes: setNodeSize(model.nodeSizes, { nodeId, ...size }),
      },
    }),
    MeasuredHandles: ({ nodeId, handles }) => ({
      model: {
        ...model,
        handleBounds: replaceNodeHandles(model.handleBounds, nodeId, handles),
      },
    }),
    MergedHandleBounds: ({ entries, missingNodeIds }) => {
      const merged = entries.reduce(
        (bounds, entry) =>
          replaceNodeHandles(bounds, entry.nodeId, entry.handles),
        pruneNodeHandles(model.handleBounds, missingNodeIds),
      );
      return { model: { ...model, handleBounds: merged } };
    },
    RemovedNodeMeasurement: ({ nodeId }) => ({
      model: {
        ...model,
        handleBounds: pruneNodeHandles(model.handleBounds, [nodeId]),
      },
    }),
    FailedMeasureHandles: () => ({ model }),

    PressedPane: ({ isAdditive }) =>
      isAdditive
        ? { model }
        : withSelection({ ...model, gesture: Gesture.Idle() }, []),

    PressedNode: ({ nodeId, point, isAdditive, pointer, snapGrid }) => {
      const nextSelected = nextNodeSelection(
        model,
        context,
        nodeId,
        isAdditive,
      );
      if (nextSelected === undefined) return { model };

      const dragged = draggingNodeIds(model, context, nextSelected);
      const next: Model = {
        ...model,
        selectedNodeIds: nextSelected,
        selectedEdgeIds: isAdditive ? model.selectedEdgeIds : [],
        gesture: Arr.isReadonlyArrayEmpty(dragged)
          ? Gesture.Idle()
          : Gesture.DraggingNodes({
              pointer,
              nodeIds: dragged,
              origin: point,
              anchor: Option.getOrElse(
                Option.map(
                  Option.fromNullishOr(nodeById(context, nodeId)),
                  (node) => positionOf(node, positionIndex(context.nodes)),
                ),
                () => point,
              ),
              snapGrid: Option.fromNullishOr(snapGrid),
              delta: zeroDelta,
              hasMoved: false,
            }),
      };

      return isSameSelection(model, next)
        ? { model: next }
        : { model: next, outMessage: selectionOf(next) };
    },

    MovedPointer: ({ screenX, screenY, pointerId }) => {
      const gesture = model.gesture;
      if (Gesture.guards.Idle(gesture)) return { model };
      if (gesture.pointer.pointerId !== pointerId) return { model };

      const point = screenToFlow(model, { screenX, screenY });

      if (Gesture.guards.DraggingNodes(gesture)) {
        const raw = {
          x: point.x - gesture.origin.x,
          y: point.y - gesture.origin.y,
        };
        // The snap happens here, once per pointer event, so the overlay the user
        // sees and the position released on pointerup are the same number: the
        // grabbed node lands on a grid multiple and every other dragged node
        // keeps its offset from it (§7 M4). Snapping at release instead would
        // show one position for the whole gesture and drop another.
        const delta = Option.match(gesture.snapGrid, {
          onNone: () => raw,
          onSome: (grid) => {
            const snapped = snapPosition(
              {
                x: gesture.anchor.x + raw.x,
                y: gesture.anchor.y + raw.y,
              },
              [grid.x, grid.y],
            );
            return {
              x: snapped.x - gesture.anchor.x,
              y: snapped.y - gesture.anchor.y,
            };
          },
        });
        return {
          model: {
            ...model,
            gesture: Gesture.DraggingNodes({
              ...gesture,
              delta,
              hasMoved: gesture.hasMoved || delta.x !== 0 || delta.y !== 0,
            }),
          },
        };
      }

      if (Gesture.guards.Resizing(gesture)) {
        const proposed = resizeRect(gesture.start, gesture.control, point, {
          ...Option.match(gesture.snapGrid, {
            onNone: () => ({}),
            onSome: (grid) => ({ snapGrid: grid }),
          }),
          // The modifier that adds to a selection also holds a resize's aspect
          // ratio (§7 M6): read per pointer event, so pressing or releasing it
          // mid-gesture changes the box on the next frame — the live behaviour
          // tldraw has, without a second Model field.
          keepAspectRatio: model.isAdditiveModifier,
        });

        // The parent's veto (§7 M7), asked on the *proposed* box before it becomes
        // the gesture's own. A rejected frame leaves `current` where it was — the
        // last accepted box, not the start box — so a consumer can express "grow,
        // but never shrink past this" without the box snapping back. A node the
        // parent removed mid-gesture rejects by absence, and `informGraphChanged`
        // drops the gesture on the next dispatch anyway.
        const node = nodeById(context, gesture.nodeId);
        const isAccepted =
          context.canResize === undefined ||
          (node !== undefined &&
            context.canResize({
              node,
              start: gesture.start,
              next: proposed,
              modifier: model.isAdditiveModifier,
            }));

        return {
          model: {
            ...model,
            gesture: Gesture.Resizing({
              ...gesture,
              current: isAccepted ? proposed : gesture.current,
            }),
          },
        };
      }

      if (Gesture.guards.MiniMapPanning(gesture)) {
        // The press centred the view on the flow point under the cursor; the drag
        // then moves that centre by the pointer's own delta, scaled from screen
        // pixels to flow units by the minimap's matrix (read once, at press).
        // Absolute from the anchor rather than accumulated per event, so a fast
        // drag and a slow one land in the same place (§7 M6).
        return setViewport(
          model,
          viewportCentredOn(model, {
            x:
              gesture.anchorFlow.x +
              (screenX - gesture.anchorScreen.x) * gesture.scale,
            y:
              gesture.anchorFlow.y +
              (screenY - gesture.anchorScreen.y) * gesture.scale,
          }),
        );
      }

      if (Gesture.guards.Reconnecting(gesture)) {
        return {
          model: {
            ...model,
            gesture: Gesture.Reconnecting({
              ...gesture,
              current: point,
              // The end being dragged is the handle type the new target must be:
              // reconnecting a target end looks for target handles.
              maybeTarget: handleNear(
                model,
                point,
                context,
                (bounds) => bounds.type === gesture.end,
              ),
            }),
          },
        };
      }

      return {
        model: {
          ...model,
          gesture: Gesture.Connecting({
            ...gesture,
            current: point,
            maybeTarget: handleNear(
              model,
              point,
              context,
              (bounds) => bounds.type === oppositeHandleType(gesture.from.type),
            ),
          }),
        },
      };
    },

    ReleasedPointer: ({ pointerId }) => {
      const gesture = model.gesture;
      if (Gesture.guards.Idle(gesture)) return { model };
      if (gesture.pointer.pointerId !== pointerId) return { model };

      if (Gesture.guards.DraggingNodes(gesture)) {
        return releaseDrag(
          model,
          context,
          gesture.nodeIds,
          gesture.delta,
          gesture.hasMoved,
        );
      }

      if (Gesture.guards.MiniMapPanning(gesture)) {
        // The viewport is already committed: every move was one `setViewport`, so
        // the release has nothing to report and no OutMessage to emit.
        return { model: { ...model, gesture: Gesture.Idle() } };
      }

      const cleared: Model = { ...model, gesture: Gesture.Idle() };

      if (Gesture.guards.Resizing(gesture)) {
        return releaseResize(model, context, gesture);
      }

      if (Gesture.guards.Reconnecting(gesture)) {
        const edge = Option.getOrUndefined(edgeById(context, gesture.edgeId));
        if (edge === undefined) return { model: cleared };

        return Option.match(gesture.maybeTarget, {
          onNone: () => ({ model: cleared }),
          onSome: (handle) => {
            if (!hasNode(context, handle.nodeId)) return { model: cleared };

            // The end that did not move supplies the other half of the
            // connection the predicate judges, and the same orientation rule
            // puts the `Source` handle first; a rejected release leaves the edge
            // exactly as the parent had it.
            const pair = orientConnection(
              handle,
              stationaryEndOf(edge, gesture.end),
            );

            return isAcceptedConnection(context, pair.source, pair.target)
              ? {
                  model: cleared,
                  outMessage: OutMessage.ReconnectedEdge({
                    edgeId: gesture.edgeId,
                    end: gesture.end,
                    handle,
                  }),
                }
              : { model: cleared };
          },
        });
      }

      return Option.match(gesture.maybeTarget, {
        onNone: () => ({ model: cleared }),
        onSome: (target) => {
          // A gesture can start at either handle kind, so the pair is oriented
          // by handle type before it becomes a fact or a predicate's input:
          // `source` is the `Source` handle, whichever end the user grabbed.
          const pair = orientConnection(gesture.from, target);
          return hasNode(context, target.nodeId) &&
            isAcceptedConnection(context, pair.source, pair.target)
            ? {
                model: cleared,
                outMessage: OutMessage.ConnectedHandles(pair),
              }
            : { model: cleared };
        },
      });
    },

    CancelledGesture: () => ({ model: { ...model, gesture: Gesture.Idle() } }),

    PressedDeleteKey: () => {
      if (!hasSelection(model)) return { model };

      const nodeIds = model.selectedNodeIds.filter((id) =>
        hasNode(context, id),
      );
      const edgeIds = model.selectedEdgeIds.filter((id) =>
        context.edges.some((edge) => edge.id === id),
      );
      const cleared: Model = {
        ...model,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        gesture: Gesture.Idle(),
      };

      return Arr.isReadonlyArrayEmpty(nodeIds) &&
        Arr.isReadonlyArrayEmpty(edgeIds)
        ? { model: cleared }
        : {
            model: cleared,
            outMessage: OutMessage.DeletedElements({ nodeIds, edgeIds }),
          };
    },

    ChangedModifierState: ({ isAdditive }) => ({
      model: { ...model, isAdditiveModifier: isAdditive },
    }),

    PressedEscape: () =>
      Gesture.guards.Idle(model.gesture)
        ? withSelection(model, [])
        : { model: { ...model, gesture: Gesture.Idle() } },

    StartedResize: ({ nodeId, control, pointer, snapGrid }) => {
      const node = nodeById(context, nodeId);
      // The same existence and draggability guards a drag uses: a resize over a
      // node the parent no longer has would be a fact about nothing (§2.5.9).
      if (node === undefined || !isDraggable(context, nodeId)) return { model };

      const rect = nodeRect(
        node,
        model.nodeSizes,
        positionIndex(context.nodes),
      );

      return {
        model: {
          ...model,
          gesture: Gesture.Resizing({
            pointer,
            nodeId,
            control,
            start: rect,
            current: rect,
            snapGrid: Option.fromNullishOr(snapGrid),
          }),
        },
      };
    },

    StartedConnection: ({ from, pointer }) => {
      if (!hasNode(context, from.nodeId)) return { model };

      const current = Option.getOrElse(anchorOf(model, context, from), () => ({
        x: 0,
        y: 0,
      }));

      return {
        model: {
          ...model,
          gesture: Gesture.Connecting({
            pointer,
            from,
            current,
            maybeTarget: Option.none(),
          }),
        },
        commands: measureVisible(model, context),
      };
    },

    StartedReconnect: ({ edgeId, end, pointer }) =>
      Option.match(edgeById(context, edgeId), {
        onNone: () => ({ model }),
        onSome: (edge) => {
          const stationary = stationaryEndOf(edge, end);
          if (!hasNode(context, stationary.nodeId)) return { model };

          return {
            model: {
              ...model,
              gesture: Gesture.Reconnecting({
                pointer,
                edgeId,
                end,
                current: Option.getOrElse(
                  anchorOf(model, context, stationary),
                  () => ({ x: 0, y: 0 }),
                ),
                maybeTarget: Option.none(),
              }),
            },
            commands: measureVisible(model, context),
          };
        },
      }),

    MovedViewport: ({ viewport, isGestureEnd }) => {
      const next: Model = { ...model, viewport };
      return isGestureEnd
        ? { model: next, outMessage: OutMessage.ChangedViewport({ viewport }) }
        : { model: next };
    },
    CompletedSyncViewport: ({ viewport }) => ({
      model: { ...model, viewport },
    }),
    FailedSyncViewport: () => ({ model }),

    // Chrome (§7 M3). Each button lands on the helper a parent would call, so
    // there is one implementation of zoom and one of fit.
    ClickedZoomIn: () => zoomBy(model, zoomStepFactor),
    ClickedZoomOut: () => zoomBy(model, 1 / zoomStepFactor),
    // A minimap press centres the view on the flow point under the cursor. It is
    // one `setViewport`, so it goes through the same clamp and the same
    // `SyncViewport` Command as every other programmatic move (§4.3).
    ClickedMiniMap: ({ point }) =>
      setViewport(model, viewportCentredOn(model, point)),

    ClickedFitView: (options) =>
      setViewport(
        model,
        fitViewport(model, context.nodes, {
          padding: Option.getOrUndefined(options.padding),
          minZoom: Option.getOrUndefined(options.minZoom),
          maxZoom: Option.getOrUndefined(options.maxZoom),
        }),
        options.duration,
      ),

    NudgedNode: ({ nodeId, delta }) => {
      const node = nodeById(context, nodeId);
      // A nudge is a move, so it obeys the same graph-side guards a drag does:
      // the node has to exist and to be draggable.
      if (node === undefined || !isDraggable(context, nodeId)) return { model };

      return {
        model,
        outMessage: OutMessage.MovedNodes({
          nodes: [
            {
              nodeId,
              x: node.position.x + delta.x,
              y: node.position.y + delta.y,
            },
          ],
        }),
      };
    },

    // Enter or Space on the focused node. `role="button"` advertises activation,
    // so it exists: the selection rules are the pointer's, without the drag the
    // pointer path arms (there is no pointer to own one).
    ActivatedNode: ({ nodeId, isAdditive }) => {
      const nextSelected = nextNodeSelection(
        model,
        context,
        nodeId,
        isAdditive,
      );
      if (nextSelected === undefined) return { model };

      return withSelection(
        model,
        nextSelected,
        isAdditive ? model.selectedEdgeIds : [],
      );
    },

    // Edge selection (§7 M6). The pair mirrors the node pair exactly — a press and
    // a keyboard activation — because the renderer that draws an edge as a press
    // target also makes it a tab stop, and an edge you can press but not focus is
    // half a feature.
    PressedEdge: ({ edgeId, isAdditive }) => {
      if (!context.edges.some((edge) => edge.id === edgeId)) return { model };

      return withSelection(
        { ...model, gesture: Gesture.Idle() },
        isAdditive ? model.selectedNodeIds : [],
        nextEdgeSelection(model, edgeId, isAdditive),
      );
    },

    ActivatedEdge: ({ edgeId, isAdditive }) => {
      if (!context.edges.some((edge) => edge.id === edgeId)) return { model };

      return withSelection(
        model,
        isAdditive ? model.selectedNodeIds : [],
        nextEdgeSelection(model, edgeId, isAdditive),
      );
    },

    // A minimap press centres the view *and* arms the drag, so the gesture starts
    // from the point it centred on: one Message, one `setViewport`, and the
    // `SyncViewport` Command is the same one every other programmatic move uses.
    StartedMiniMapPan: ({ point, screen, scale, pointer }) => {
      const centred = setViewport(model, viewportCentredOn(model, point));
      const next: Model = {
        ...centred.model,
        gesture: Gesture.MiniMapPanning({
          pointer,
          anchorScreen: screen,
          anchorFlow: point,
          scale,
        }),
      };
      // `setViewport` emits commands only when the pane id is known, and `Update`
      // treats an absent `commands` as none — so the field is omitted rather than
      // set to `undefined`.
      return centred.commands === undefined
        ? { model: next }
        : { model: next, commands: centred.commands };
    },
  });

/**
 * Reconciliation seam for graph changes the flow never sees: undo, a server
 * push, a bulk import, or the parent applying `DeletedElements` (§2.5.9). Prunes
 * selection, sizes, handle bounds, and a gesture whose nodes disappeared.
 */
export type GraphChanged = Readonly<{ model: Model }>;

export const informGraphChanged = (
  model: Model,
  context: Context,
): GraphChanged => {
  const hidden = hiddenIds(context.nodes);
  // A collapsed node is not drawn, so it is not selected, measured or dragged:
  // keeping its geometry would be keeping state for something the user cannot
  // see, which is the whole point of `hidden` as the large-graph escape hatch.
  const nodeIds = context.nodes
    .filter((node) => !hidden.has(node.id))
    .map((node) => node.id);
  const edgeIds = context.edges.map((edge) => edge.id);

  const selectedNodeIds = model.selectedNodeIds.filter((id) =>
    nodeIds.includes(id),
  );
  const selectedEdgeIds = model.selectedEdgeIds.filter((id) =>
    edgeIds.includes(id),
  );

  const gesture = Gesture.match<Gesture>(model.gesture, {
    Idle: () => Gesture.Idle(),
    DraggingNodes: (gesture) => {
      const remaining = gesture.nodeIds.filter((id) => nodeIds.includes(id));
      return Arr.isReadonlyArrayEmpty(remaining)
        ? Gesture.Idle()
        : Gesture.DraggingNodes({ ...gesture, nodeIds: remaining });
    },
    Connecting: (gesture) =>
      nodeIds.includes(gesture.from.nodeId) ? gesture : Gesture.Idle(),
    Reconnecting: (gesture) =>
      edgeIds.includes(gesture.edgeId) ? gesture : Gesture.Idle(),
    Resizing: (gesture) =>
      nodeIds.includes(gesture.nodeId) ? gesture : Gesture.Idle(),
    // A minimap drag names no node and no edge, so a graph change cannot
    // invalidate it: the viewport it moves is still there.
    MiniMapPanning: (gesture) => gesture,
  });

  return {
    model: {
      ...model,
      selectedNodeIds,
      selectedEdgeIds,
      nodeSizes: model.nodeSizes.filter((size) =>
        nodeIds.includes(size.nodeId),
      ),
      handleBounds: model.handleBounds.filter((bounds) =>
        nodeIds.includes(bounds.nodeId),
      ),
      gesture,
    },
  };
};

/** One zoom-button press. 1.2 is a fraction the eye can follow and small enough
 *  that the clamp is reached in a handful of presses. */
export const zoomStepFactor = 1.2;

const isSameViewport = (a: Model["viewport"], b: Model["viewport"]): boolean =>
  a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/** Programmatic viewport change: the Model commits the target immediately and
 *  the Command makes the engine agree (§4.3).
 *
 *  Zoom is clamped to the Model's bounds before anything is written, so the
 *  Model never holds a zoom the engine would refuse, and a press at the limit
 *  changes and dispatches nothing — "the controls stop at the bounds" is then a
 *  property of `update`, not a race with the engine's own clamp. */
export const setViewport = (
  model: Model,
  viewport: Model["viewport"],
  duration: Option.Option<number> = Option.none(),
): UpdateReturn => {
  const next: Model["viewport"] = {
    ...viewport,
    zoom: clampZoom(viewport.zoom, model),
  };
  if (isSameViewport(model.viewport, next)) return { model };

  return {
    model: { ...model, viewport: next },
    commands: Arr.fromOption(
      Option.map(model.paneId, (paneId) =>
        SyncViewport({ paneId, viewport: next, duration }),
      ),
    ),
  };
};

export const zoomBy = (model: Model, factor: number): UpdateReturn =>
  setViewport(model, {
    ...model.viewport,
    zoom: model.viewport.zoom * factor,
  });

/**
 * Everything the user can see and act on: a collapsed subtree is not selected,
 * because it is not drawn and `informGraphChanged` would prune it out of the
 * selection immediately (M4-REVIEW 2). The edges follow the same rule as the
 * canvas — both ends shown — so "select all, then delete" cannot report a node or
 * an edge the canvas never offered.
 */
export const selectAll = (model: Model, context: Context): UpdateReturn =>
  withSelection(
    model,
    shownNodes(context.nodes).map((node) => node.id),
    shownEdges(context.nodes, context.edges).map((edge) => edge.id),
  );

export const clearSelection = (model: Model): UpdateReturn =>
  withSelection(model, []);
