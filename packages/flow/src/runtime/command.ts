import { Array as Arr, Effect, Option, Result, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import type { PanZoomTransformOptions } from "./adapter.js";
import { getPane } from "./host.js";
import { measureHandleBounds, nodeElementOf } from "./measure.js";

const durationOptions = (
  duration: Option.Option<number>,
): PanZoomTransformOptions =>
  Option.match(duration, {
    onNone: () => ({}),
    onSome: (value) => ({ duration: value }),
  });

export const SyncViewport = Command.define("SyncViewport", {
  args: {
    paneId: Schema.String,
    viewport: Schema.Struct({
      x: Schema.Number,
      y: Schema.Number,
      zoom: Schema.Number,
    }),
    duration: Schema.Option(Schema.Number),
  },
  messages: [Message.CompletedSyncViewport, Message.FailedSyncViewport],
  execute: ({ paneId, viewport, duration }) =>
    Option.match(getPane(paneId), {
      onNone: () =>
        Effect.succeed(
          Message.FailedSyncViewport({ reason: "pane not mounted" }),
        ),
      onSome: (host) =>
        Effect.tryPromise({
          try: () =>
            host.panZoom.setViewport(viewport, durationOptions(duration)),
          catch: (cause) =>
            Message.FailedSyncViewport({ reason: String(cause) }),
        }).pipe(
          // The engine's current viewport, not the command's target: a gesture
          // that interrupts the sync must win the commit (§4.1).
          Effect.map(() => host.panZoom.getViewport()),
          Effect.match({
            onFailure: (message) => message,
            onSuccess: (committed) =>
              Message.CompletedSyncViewport({ viewport: committed }),
          }),
        ),
    }),
});

/**
 * Freshness checkpoint for handle geometry: re-read the named nodes through the
 * host registry right before a connection gesture begins, so hit-testing never
 * runs on a subtree that changed without an observer firing (§2.5.3).
 *
 * Merge semantics, not replace: measuring three nodes must not erase the bounds
 * of the other thirty. A requested node with no live element comes back in
 * `missingNodeIds` and is pruned.
 */
export const MeasureHandles = Command.define("MeasureHandles", {
  args: { paneId: Schema.String, nodeIds: Schema.Array(Schema.String) },
  messages: [Message.MergedHandleBounds, Message.FailedMeasureHandles],
  execute: ({ paneId, nodeIds }) =>
    Option.match(getPane(paneId), {
      onNone: () =>
        Effect.succeed(
          Message.FailedMeasureHandles({ reason: "pane not mounted" }),
        ),
      onSome: (host) =>
        Effect.sync(() => {
          const measured = nodeIds.map((nodeId) => ({
            nodeId,
            maybeHandles: Option.map(
              nodeElementOf(host.element, nodeId),
              (element) => measureHandleBounds(element, nodeId),
            ),
          }));

          return Message.MergedHandleBounds({
            entries: Arr.filterMap(measured, ({ nodeId, maybeHandles }) =>
              Option.match(maybeHandles, {
                onNone: () => Result.failVoid,
                onSome: (handles) => Result.succeed({ nodeId, handles }),
              }),
            ),
            missingNodeIds: Arr.filterMap(
              measured,
              ({ nodeId, maybeHandles }) =>
                Option.isNone(maybeHandles)
                  ? Result.succeed(nodeId)
                  : Result.failVoid,
            ),
          });
        }),
    }),
});

/** Explicit remeasure, for the case no observer sees: a stylesheet-only change
 *  that moves handles without resizing the node (§2.5.3). Same Command, same
 *  merge semantics, so it can never erase bounds it did not measure. */
export const Remeasure = (
  paneId: string,
  nodeIds: ReadonlyArray<string>,
): ReturnType<typeof MeasureHandles> => MeasureHandles({ paneId, nodeIds });
