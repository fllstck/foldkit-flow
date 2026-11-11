import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import {
  HandleBounds,
  HandleRef,
  HandleType,
  Point,
  Pointer,
  Rect,
  Size,
  SnapGrid,
  Viewport,
} from "./model.js";

export const Message = defineMessageUnion({
  // element lifecycle
  MountedPane: { paneId: Schema.String },
  FailedMountPane: { reason: Schema.String },
  ResizedPane: { pane: Rect },

  // measurement
  MeasuredNode: { nodeId: Schema.String, size: Size },
  MeasuredHandles: {
    nodeId: Schema.String,
    handles: Schema.Array(HandleBounds),
  },
  // Batch from the `MeasureHandles` checkpoint. Merges per node: an entry
  // replaces only its own node's slice, so a partial sweep can never erase
  // measurements for nodes it did not measure.
  MergedHandleBounds: {
    entries: Schema.Array(
      Schema.Struct({
        nodeId: Schema.String,
        handles: Schema.Array(HandleBounds),
      }),
    ),
    // Requested but no live element: their slices are pruned rather than
    // silently kept, because a node with no element has no handles to hit.
    missingNodeIds: Schema.Array(Schema.String),
  },
  RemovedNodeMeasurement: { nodeId: Schema.String },
  FailedMeasureHandles: { reason: Schema.String },

  // pointer gestures: every one carries the owning pointer (§2.5.8)
  PressedPane: {
    point: Point,
    isAdditive: Schema.Boolean,
    pointer: Pointer,
  },
  PressedNode: {
    nodeId: Schema.String,
    point: Point,
    isAdditive: Schema.Boolean,
    pointer: Pointer,
    snapGrid: Schema.optionalKey(SnapGrid),
  },
  MovedPointer: {
    screenX: Schema.Number,
    screenY: Schema.Number,
    pointerId: Schema.Number,
  },
  ReleasedPointer: { pointerId: Schema.Number },
  CancelledGesture: {
    reason: Schema.Literals(["PointerCancel", "WindowBlur", "Escape"]),
  },
  PressedDeleteKey: {},
  PressedEscape: {},
  ChangedModifierState: { isAdditive: Schema.Boolean },

  // connections
  StartedConnection: { from: HandleRef, pointer: Pointer },
  // Grabbing one end of an existing edge: `end` is the end that moves, and the
  // edge stays a parent-owned id the flow only names.
  StartedReconnect: {
    edgeId: Schema.String,
    end: HandleType,
    pointer: Pointer,
  },

  // viewport: one Message shape for the throttled frames and the commit, so a
  // gesture reads as one transition and `ChangedViewport` fires once (§4.5)
  MovedViewport: { viewport: Viewport, isGestureEnd: Schema.Boolean },
  CompletedSyncViewport: { viewport: Viewport },
  FailedSyncViewport: { reason: Schema.String },

  // Chrome (§7 M3). `Controls` is library-owned markup inside the pane, so its
  // buttons need library Messages instead of a helper the parent folds; `update`
  // turns each one into the same `zoomBy`/`setViewport` helper a parent calls
  // from its own update.
  ClickedZoomIn: {},
  ClickedZoomOut: {},
  // The fit button carries the renderer's fit options, because `update` has the
  // graph but not the config, and a fit is the one gesture whose defaults are a
  // presentation choice (padding, a per-fit clamp, a duration).
  ClickedFitView: {
    padding: Schema.optionalKey(Schema.Number),
    minZoom: Schema.optionalKey(Schema.Number),
    maxZoom: Schema.optionalKey(Schema.Number),
    duration: Schema.optionalKey(Schema.Number),
  },

  // Arrow-key nudging. The delta is the whole fact: which key was pressed and
  // which modifier was held are DOM details the keyboard subscription resolves,
  // so `update` only applies a delta it is handed (§7 M3).
  NudgedNode: { nodeId: Schema.String, delta: Point },

  // Keyboard activation (Enter or Space on the focused node). The counterpart of
  // `PressedNode` for a keyboard user: it selects and toggles, and arms no drag
  // because there is no pointer (§7 M3).
  ActivatedNode: { nodeId: Schema.String, isAdditive: Schema.Boolean },
});

export type Message = typeof Message.Type;

export type MountedPane = ReturnType<typeof Message.MountedPane>;
export type FailedMountPane = ReturnType<typeof Message.FailedMountPane>;
export type ResizedPane = ReturnType<typeof Message.ResizedPane>;
export type MeasuredNode = ReturnType<typeof Message.MeasuredNode>;
export type MeasuredHandles = ReturnType<typeof Message.MeasuredHandles>;
export type MergedHandleBounds = ReturnType<typeof Message.MergedHandleBounds>;
export type RemovedNodeMeasurement = ReturnType<
  typeof Message.RemovedNodeMeasurement
>;
export type FailedMeasureHandles = ReturnType<
  typeof Message.FailedMeasureHandles
>;
export type PressedPane = ReturnType<typeof Message.PressedPane>;
export type PressedNode = ReturnType<typeof Message.PressedNode>;
export type MovedPointer = ReturnType<typeof Message.MovedPointer>;
export type ReleasedPointer = ReturnType<typeof Message.ReleasedPointer>;
export type CancelledGesture = ReturnType<typeof Message.CancelledGesture>;
export type PressedDeleteKey = ReturnType<typeof Message.PressedDeleteKey>;
export type PressedEscape = ReturnType<typeof Message.PressedEscape>;
export type ChangedModifierState = ReturnType<
  typeof Message.ChangedModifierState
>;
export type StartedConnection = ReturnType<typeof Message.StartedConnection>;
export type StartedReconnect = ReturnType<typeof Message.StartedReconnect>;
export type MovedViewport = ReturnType<typeof Message.MovedViewport>;
export type CompletedSyncViewport = ReturnType<
  typeof Message.CompletedSyncViewport
>;
export type FailedSyncViewport = ReturnType<typeof Message.FailedSyncViewport>;
export type ClickedZoomIn = ReturnType<typeof Message.ClickedZoomIn>;
export type ClickedZoomOut = ReturnType<typeof Message.ClickedZoomOut>;
export type ClickedFitView = ReturnType<typeof Message.ClickedFitView>;
export type NudgedNode = ReturnType<typeof Message.NudgedNode>;
export type ActivatedNode = ReturnType<typeof Message.ActivatedNode>;
