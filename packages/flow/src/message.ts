import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { Rect, Size, Viewport } from "./model.js";

export const Message = defineMessageUnion({
  MountedPane: { paneId: Schema.String },
  FailedMountPane: { reason: Schema.String },
  ResizedPane: { pane: Rect },
  MeasuredNode: { nodeId: Schema.String, size: Size },
  MovedViewport: { viewport: Viewport, isGestureEnd: Schema.Boolean },
  CompletedSyncViewport: { viewport: Viewport },
  FailedSyncViewport: { reason: Schema.String },
});

export type Message = typeof Message.Type;

export type MountedPane = ReturnType<typeof Message.MountedPane>;
export type FailedMountPane = ReturnType<typeof Message.FailedMountPane>;
export type ResizedPane = ReturnType<typeof Message.ResizedPane>;
export type MeasuredNode = ReturnType<typeof Message.MeasuredNode>;
export type MovedViewport = ReturnType<typeof Message.MovedViewport>;
export type CompletedSyncViewport = ReturnType<
  typeof Message.CompletedSyncViewport
>;
export type FailedSyncViewport = ReturnType<typeof Message.FailedSyncViewport>;
