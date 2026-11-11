import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import type {
  MeasuredHandles,
  MeasuredNode,
  RemovedNodeMeasurement,
} from "../message.js";
import type { Size } from "../model.js";
import { measureHandleBounds } from "./measure.js";

type MountNodeMessage = MeasuredNode | MeasuredHandles | RemovedNodeMeasurement;

const readSize = (element: HTMLElement): Size => ({
  width: element.offsetWidth,
  height: element.offsetHeight,
});

/**
 * One Mount per node element, keyed by node id so the element — and this Mount —
 * follow the entity across re-renders (§4.2).
 *
 * Two observers watch the same element for two different reasons:
 * `ResizeObserver` reports box changes, and a `MutationObserver` over the
 * subtree reports the structural and attribute changes that move handles
 * without changing the box. `attributeFilter` has no wildcard syntax, so the
 * observation is unfiltered and coalesced to one measurement per animation
 * frame instead. The one mutation that is *not* geometry is the renderer's own
 * transform on the node element, which is what a drag frame writes: the node's
 * local handle geometry cannot change when the node moves, so measuring it would
 * be pure cost.
 */
export const MountNode = Mount.defineStream("MountNode", {
  args: { nodeId: Schema.String },
  messages: [
    Message.MeasuredNode,
    Message.MeasuredHandles,
    Message.RemovedNodeMeasurement,
  ],
  execute: ({ element, nodeId }) =>
    Stream.callback<MountNodeMessage>((queue) =>
      Effect.gen(function* () {
        // SAFETY: MountNode is only attached to the div this renderer builds.
        const node = element as HTMLElement;

        let lastSize: Size | undefined;
        let hasPendingMeasure = false;
        let frame: number | undefined;

        const flush = () => {
          frame = undefined;
          if (!hasPendingMeasure) return;
          hasPendingMeasure = false;

          const size = readSize(node);
          const isSizeChanged =
            lastSize === undefined ||
            lastSize.width !== size.width ||
            lastSize.height !== size.height;
          lastSize = size;

          if (isSizeChanged) {
            Queue.offerUnsafe(queue, Message.MeasuredNode({ nodeId, size }));
          }
          Queue.offerUnsafe(
            queue,
            Message.MeasuredHandles({
              nodeId,
              handles: measureHandleBounds(node, nodeId),
            }),
          );
        };

        const schedule = () => {
          hasPendingMeasure = true;
          if (frame === undefined) frame = requestAnimationFrame(flush);
        };

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const resize = new ResizeObserver(schedule);
            resize.observe(node);

            const mutation = new MutationObserver((records) => {
              const isOwnTransform = records.every(
                (record) =>
                  record.target === node && record.attributeName === "style",
              );
              if (isOwnTransform) return;
              schedule();
            });
            mutation.observe(node, {
              childList: true,
              attributes: true,
              subtree: true,
            });

            return { resize, mutation };
          }),
          (observers) =>
            Effect.sync(() => {
              observers.resize.disconnect();
              observers.mutation.disconnect();
              if (frame !== undefined) cancelAnimationFrame(frame);
              frame = undefined;
              hasPendingMeasure = false;
              Queue.offerUnsafe(
                queue,
                Message.RemovedNodeMeasurement({ nodeId }),
              );
            }),
        );

        // The observers are live before the first measurement, so a box that
        // changes while the initial read is in flight is still reported.
        schedule();

        return yield* Effect.never;
      }),
    ),
});
