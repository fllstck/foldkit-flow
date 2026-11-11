import { Array as Arr, Option } from "effect";
import type { Update } from "foldkit";

import { connectionOf, edgeAnchor } from "./geometry/handles.js";
import { hitTestHandle, oppositeHandleType } from "./geometry/hitTest.js";
import { screenToFlow } from "./geometry/screen.js";
import { visibleNodes } from "./geometry/visible.js";
import { Message } from "./message.js";
import { Gesture, zeroDelta } from "./model.js";
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

const isDraggable = (context: Context, nodeId: string): boolean =>
  nodeById(context, nodeId)?.draggable !== false;

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
    const anchor = edgeAnchor(model, node, ref.type, ref.handleId);
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

const measureVisible = (model: Model, context: Context) =>
  Arr.fromOption(
    Option.map(model.paneId, (paneId) =>
      MeasureHandles({
        paneId,
        nodeIds: visibleNodes(model, context.nodes).map((node) => node.id),
      }),
    ),
  );

/** Drag overlay for the pressed node's selection, clamped to the draggable ids
 *  that still exist in the graph. */
const draggingNodeIds = (
  model: Model,
  context: Context,
  selectedNodeIds: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  selectedNodeIds.filter(
    (id) => hasNode(context, id) && isDraggable(context, id),
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

    PressedNode: ({ nodeId, point, isAdditive, pointer }) => {
      const node = nodeById(context, nodeId);
      if (node === undefined) return { model };

      const isSelectable = node.selectable !== false;
      const isSelected = model.selectedNodeIds.includes(nodeId);
      const nextSelected = isSelectable
        ? isAdditive
          ? toggle(model.selectedNodeIds, nodeId)
          : isSelected
            ? model.selectedNodeIds
            : [nodeId]
        : model.selectedNodeIds;

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
        const delta = {
          x: point.x - gesture.origin.x,
          y: point.y - gesture.origin.y,
        };
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

      if (Gesture.guards.Reconnecting(gesture)) {
        return {
          model: {
            ...model,
            gesture: Gesture.Reconnecting({
              ...gesture,
              current: point,
              // The end being dragged is the handle type the new target must be:
              // reconnecting a target end looks for target handles.
              maybeTarget: hitTestHandle(model, point, context, {
                accept: (bounds) => bounds.type === gesture.end,
              }),
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
            maybeTarget: hitTestHandle(model, point, context, {
              accept: (bounds) =>
                bounds.type === oppositeHandleType(gesture.from.type),
            }),
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

      const cleared: Model = { ...model, gesture: Gesture.Idle() };

      if (Gesture.guards.Reconnecting(gesture)) {
        const edge = Option.getOrUndefined(edgeById(context, gesture.edgeId));
        if (edge === undefined) return { model: cleared };

        return Option.match(gesture.maybeTarget, {
          onNone: () => ({ model: cleared }),
          onSome: (handle) => {
            if (!hasNode(context, handle.nodeId)) return { model: cleared };

            // The end that did not move supplies the other half of the
            // connection the predicate judges; a rejected release leaves the
            // edge exactly as the parent had it.
            const stationary = stationaryEndOf(edge, gesture.end);
            const source = gesture.end === "Source" ? handle : stationary;
            const target = gesture.end === "Target" ? handle : stationary;

            return isAcceptedConnection(context, source, target)
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
        onSome: (target) =>
          hasNode(context, target.nodeId) &&
          isAcceptedConnection(context, gesture.from, target)
            ? {
                model: cleared,
                outMessage: OutMessage.ConnectedHandles({
                  source: gesture.from,
                  target,
                }),
              }
            : { model: cleared },
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
  const nodeIds = context.nodes.map((node) => node.id);
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

/** Programmatic viewport change: the Model commits the target immediately and
 *  the Command makes the engine agree (§4.3). */
export const setViewport = (
  model: Model,
  viewport: Model["viewport"],
  duration: Option.Option<number> = Option.none(),
): UpdateReturn => ({
  model: { ...model, viewport },
  commands: Arr.fromOption(
    Option.map(model.paneId, (paneId) =>
      SyncViewport({ paneId, viewport, duration }),
    ),
  ),
});

export const zoomBy = (model: Model, factor: number): UpdateReturn =>
  setViewport(model, {
    ...model.viewport,
    zoom: model.viewport.zoom * factor,
  });

export const selectAll = (model: Model, context: Context): UpdateReturn =>
  withSelection(
    model,
    context.nodes.map((node) => node.id),
    context.edges.map((edge) => edge.id),
  );

export const clearSelection = (model: Model): UpdateReturn =>
  withSelection(model, []);
