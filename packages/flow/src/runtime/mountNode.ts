import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import type { MeasuredNode } from "../message.js";
import type { Size } from "../model.js";

type MountNodeMessage = MeasuredNode;

const readSize = (element: HTMLElement): Size => ({
  width: element.offsetWidth,
  height: element.offsetHeight,
});

/**
 * One Mount per node element. `ResizeObserver` is the only trigger M0 needs:
 * a re-render patches the reused element, and the Mount — tied to the element's
 * lifetime, not the VNode — does not restart (§4.2).
 */
export const MountNode = Mount.defineStream("MountNode", {
  args: { nodeId: Schema.String },
  messages: [Message.MeasuredNode],
  execute: ({ element, nodeId }) =>
    Stream.callback<MountNodeMessage>((queue) =>
      Effect.gen(function* () {
        // SAFETY: MountNode is only attached to the div this renderer builds.
        const node = element as HTMLElement;
        let last: Size | undefined;
        let pending: Size | undefined;
        let frame: number | undefined;

        const flush = () => {
          frame = undefined;
          if (pending === undefined) return;
          const size = pending;
          pending = undefined;
          if (
            last !== undefined &&
            last.width === size.width &&
            last.height === size.height
          ) {
            return;
          }
          last = size;
          Queue.offerUnsafe(queue, Message.MeasuredNode({ nodeId, size }));
        };

        const schedule = () => {
          pending = readSize(node);
          if (frame === undefined) frame = requestAnimationFrame(flush);
        };

        const observer = yield* Effect.acquireRelease(
          Effect.sync(() => new ResizeObserver(() => schedule())),
          (instance) =>
            Effect.sync(() => {
              if (frame !== undefined) cancelAnimationFrame(frame);
              frame = undefined;
              pending = undefined;
              instance.disconnect();
            }),
        );

        observer.observe(node);
        schedule();

        return yield* Effect.never;
      }),
    ),
});
