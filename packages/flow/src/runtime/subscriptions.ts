import { Option, Schema, Stream } from "effect";
import { Dom, Subscription } from "foldkit";

import { Message } from "../message.js";
import { Gesture } from "../model.js";
import type { Model } from "../model.js";
import { isDeleteKeyAllowed } from "./domTarget.js";
import { getPaneRoot } from "./host.js";

/** Handlers that fire on the pane's root. Declaring the map keeps the mapper's
 *  event parameter typed for both a `Document` and a `ShadowRoot`, which the
 *  native lib.dom maps do not do between them. */
type PointerRoot = Dom.TypedEventTarget<{
  pointermove: PointerEvent;
  pointerup: PointerEvent;
  pointercancel: PointerEvent;
  keydown: KeyboardEvent;
}>;

const pointerIdOf = (model: Model): Option.Option<number> => {
  const gesture = model.gesture;
  return Gesture.guards.Idle(gesture)
    ? Option.none()
    : Option.some(gesture.pointer.pointerId);
};

const isOwnPointer =
  (ownerPointerId: number) =>
  (event: PointerEvent): boolean =>
    event.pointerId === ownerPointerId;

/**
 * Gestures that span elements are Subscriptions, not per-element handlers:
 * document-level pointer tracking is the precedent `DragAndDrop` sets (§4.4).
 *
 * The dependency record is deliberately narrow. `pointerId` is an `Option`, so
 * the listener shuts down when no gesture is active and restarts on the next
 * press — and stays alive for the whole gesture instead of restarting on every
 * `MovedPointer`. `paneId` resolves the pane's own root through the host
 * registry, so two flows on one page never share a listener, a ShadowRoot host
 * works, and a missing host yields `Stream.empty` rather than a `document`
 * fallback.
 */
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  pointerMove: entry(
    {
      paneId: Schema.Option(Schema.String),
      pointerId: Schema.Option(Schema.Number),
    },
    {
      modelToDependencies: (model) => ({
        paneId: model.paneId,
        pointerId: pointerIdOf(model),
      }),
      dependenciesToStream: ({ paneId, pointerId }) =>
        Option.match(Option.product(paneId, pointerId), {
          onNone: () => Stream.empty,
          onSome: ([hostId, ownerPointerId]) =>
            Option.match(getPaneRoot(hostId), {
              onNone: () => Stream.empty,
              onSome: (root) =>
                Dom.streamFromEventFilterMap({
                  target: (): PointerRoot => root,
                  type: "pointermove",
                  filterMapEvent: (event) =>
                    isOwnPointer(ownerPointerId)(event)
                      ? Option.some(
                          Message.MovedPointer({
                            screenX: event.clientX,
                            screenY: event.clientY,
                            pointerId: event.pointerId,
                          }),
                        )
                      : Option.none(),
                }),
            }),
        }),
    },
  ),

  pointerEnd: entry(
    {
      paneId: Schema.Option(Schema.String),
      pointerId: Schema.Option(Schema.Number),
    },
    {
      modelToDependencies: (model) => ({
        paneId: model.paneId,
        pointerId: pointerIdOf(model),
      }),
      dependenciesToStream: ({ paneId, pointerId }) =>
        Option.match(Option.product(paneId, pointerId), {
          onNone: () => Stream.empty,
          onSome: ([hostId, ownerPointerId]) =>
            Option.match(getPaneRoot(hostId), {
              onNone: () => Stream.empty,
              onSome: (root) => {
                const released = Dom.streamFromEventFilterMap({
                  target: (): PointerRoot => root,
                  type: "pointerup",
                  filterMapEvent: (event) =>
                    isOwnPointer(ownerPointerId)(event)
                      ? Option.some(
                          Message.ReleasedPointer({
                            pointerId: event.pointerId,
                          }),
                        )
                      : Option.none(),
                });

                const cancelled = Dom.streamFromEventFilterMap({
                  target: (): PointerRoot => root,
                  type: "pointercancel",
                  filterMapEvent: (event) =>
                    isOwnPointer(ownerPointerId)(event)
                      ? Option.some(
                          Message.CancelledGesture({ reason: "PointerCancel" }),
                        )
                      : Option.none(),
                });

                return Stream.merge(released, cancelled);
              },
            }),
        }),
    },
  ),

  windowBlur: entry(
    { pointerId: Schema.Option(Schema.Number) },
    {
      modelToDependencies: (model) => ({ pointerId: pointerIdOf(model) }),
      // No gesture, no listener: a blur with nothing in flight is not a fact the
      // flow has anything to do with.
      dependenciesToStream: ({ pointerId }) =>
        Option.match(pointerId, {
          onNone: () => Stream.empty,
          onSome: () =>
            Dom.streamFromEvent({
              target: window,
              type: "blur",
              mapEvent: () =>
                Message.CancelledGesture({ reason: "WindowBlur" }),
            }),
        }),
    },
  ),

  keyboard: entry(
    { paneId: Schema.Option(Schema.String) },
    {
      modelToDependencies: (model) => ({ paneId: model.paneId }),
      dependenciesToStream: ({ paneId }) =>
        Option.match(paneId, {
          onNone: () => Stream.empty,
          onSome: (hostId) =>
            Option.match(getPaneRoot(hostId), {
              onNone: () => Stream.empty,
              onSome: (root) =>
                Dom.streamFromEventFilterMap({
                  target: (): PointerRoot => root,
                  type: "keydown",
                  filterMapEvent: (event) => {
                    // The editable-target guard: keys never reach the graph
                    // while the user is typing (§2.5.8).
                    if (!isDeleteKeyAllowed(event)) return Option.none();
                    if (event.key === "Delete" || event.key === "Backspace") {
                      return Option.some(Message.PressedDeleteKey());
                    }
                    return event.key === "Escape"
                      ? Option.some(Message.PressedEscape())
                      : Option.none();
                  },
                }),
            }),
        }),
    },
  ),
}));
