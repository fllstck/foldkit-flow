import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import type {
  FailedMountPane,
  MountedPane,
  MovedViewport,
  ResizedPane,
} from "../message.js";
import type { Viewport } from "../model.js";
import * as classes from "../view/classes.js";
import {
  createPanZoom,
  infiniteExtent,
  panOnScrollModeFree,
} from "./adapter.js";
import type { PanZoomUpdate } from "./adapter.js";
import { registerPane, releasePane } from "./host.js";
import { createViewportThrottle } from "./viewportThrottle.js";

type MountPaneMessage =
  MountedPane | FailedMountPane | MovedViewport | ResizedPane;

export const transformOf = (viewport: Viewport): string =>
  `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

const writeTransform = (element: HTMLElement, viewport: Viewport): void => {
  element.style.transform = transformOf(viewport);
};

const panZoomUpdate: PanZoomUpdate = {
  noWheelClassName: classes.NoWheel,
  noPanClassName: classes.NoPan,
  preventScrolling: true,
  panOnScroll: false,
  panOnDrag: true,
  panOnScrollMode: panOnScrollModeFree,
  panOnScrollSpeed: 0.5,
  userSelectionActive: false,
  zoomOnPinch: true,
  zoomOnScroll: true,
  zoomOnDoubleClick: true,
  zoomActivationKeyPressed: false,
  lib: "fflow",
  onTransformChange: () => {},
  connectionInProgress: false,
  paneClickDistance: 0,
};

/**
 * The pane Mount owns `XYPanZoom` for the element's lifetime. The initial
 * viewport is an arg (captured at mount, exactly "initial" semantics); later
 * programmatic changes go through the `SyncViewport` Command (§2.5.5, §4.1).
 */
export const MountPane = Mount.defineStream("MountPane", {
  args: {
    paneId: Schema.String,
    viewport: Schema.Struct({
      x: Schema.Number,
      y: Schema.Number,
      zoom: Schema.Number,
    }),
    minZoom: Schema.Number,
    maxZoom: Schema.Number,
  },
  messages: [
    Message.MountedPane,
    Message.FailedMountPane,
    Message.MovedViewport,
    Message.ResizedPane,
  ],
  execute: ({
    element,
    paneId,
    minZoom,
    maxZoom,
    viewport,
    viewStateChanges,
  }) =>
    Stream.callback<MountPaneMessage>((queue) =>
      Effect.gen(function* () {
        // SAFETY: MountPane is only attached to the div this renderer builds.
        const paneElement = element as HTMLElement;
        const maybeViewportElement =
          paneElement.querySelector(".fflow__viewport");

        if (!(maybeViewportElement instanceof HTMLElement)) {
          Queue.offerUnsafe(
            queue,
            Message.FailedMountPane({ reason: "viewport element missing" }),
          );
          return yield* Effect.never;
        }

        let isLive = true;

        const throttle = createViewportThrottle((next) =>
          Queue.offerUnsafe(
            queue,
            Message.MovedViewport({ viewport: next, isGestureEnd: false }),
          ),
        );

        const panZoom = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createPanZoom({
              domNode: paneElement,
              minZoom,
              maxZoom,
              viewport,
              translateExtent: infiniteExtent,
              onDraggingChange: () => {},
              onPanZoom: (event, next) => {
                if (!isLive) return;
                // Transition frames (programmatic `setViewport` animations) have
                // no source event. Let the Model drive those frames: the
                // throttled patch is then the only writer. Writing here as well
                // produces an oscillation, because a transition tick can run
                // after the rAF flush and the following Model patch writes the
                // older viewport back over it. Pointer/wheel frames keep the
                // DOM-first ordering.
                if (event !== null) writeTransform(maybeViewportElement, next);
                throttle.offer(next);
              },
              onPanZoomEnd: (_event, next) => {
                if (!isLive) return;
                throttle.cancel();
                writeTransform(maybeViewportElement, next);
                Queue.offerUnsafe(
                  queue,
                  Message.MovedViewport({ viewport: next, isGestureEnd: true }),
                );
              },
            }),
          ),
          (instance) =>
            Effect.sync(() => {
              throttle.cancel();
              releasePane(paneId, instance);
            }),
        );

        registerPane({
          paneId,
          element: paneElement,
          // SAFETY: getRootNode() returns Document | ShadowRoot for an element.
          root: paneElement.getRootNode() as Document | ShadowRoot,
          panZoom,
        });

        // Wires d3's gesture handlers; until this call every engine callback is
        // silent. `syncViewport`/`setViewport` from a Command would move d3's
        // internal transform without touching the DOM otherwise.
        panZoom.update(panZoomUpdate);

        const emitPaneRect = () => {
          const rect = paneElement.getBoundingClientRect();
          Queue.offerUnsafe(
            queue,
            Message.ResizedPane({
              pane: {
                width: rect.width,
                height: rect.height,
                left: rect.left,
                top: rect.top,
              },
            }),
          );
        };

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observer = new ResizeObserver(emitPaneRect);
            observer.observe(paneElement);
            emitPaneRect();
            return observer;
          }),
          (observer) => Effect.sync(() => observer.disconnect()),
        );

        Queue.offerUnsafe(queue, Message.MountedPane({ paneId }));

        yield* viewStateChanges.pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              isLive = state === "Live";
            }),
          ),
          Effect.forkScoped,
        );

        return yield* Effect.never;
      }),
    ),
});
