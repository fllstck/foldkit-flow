import { Effect, Schema } from "effect";
import { Option } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import type { PanZoomTransformOptions } from "./adapter.js";
import { getPane } from "./host.js";

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
          Effect.map(() => host.panZoom.getViewport()),
          Effect.match({
            onFailure: (message) => message,
            onSuccess: (committed) =>
              Message.CompletedSyncViewport({ viewport: committed }),
          }),
        ),
    }),
});
