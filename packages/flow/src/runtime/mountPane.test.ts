// @vitest-environment jsdom
import { Effect, Stream } from "effect";
import { describe, expect, test } from "vitest";

import { MountPane } from "./mountPane.js";

/**
 * Rung 4 of `docs/TEST-STRATEGY.md`: a Mount's **own stream**, in jsdom.
 *
 * Scene's `Mount.resolve(Definition, message)` *fabricates* the message, so it can
 * prove the view wires the right Mount but never what the Mount emits. That is
 * where the pan-jump lived: `MountPane` emitted its first `ResizedPane` before
 * `MountedPane`, so a consumer's fit — folded from the measurement, as the docs
 * prescribe — committed a viewport that `setViewport` could not sync, because the
 * pane id it needs comes from `MountedPane` (`M5-FINDINGS` §8.2).
 *
 * The ordering is a contract (see the docblock on `Message.MountedPane`), so it is
 * asserted here rather than inferred from one of its consequences: reverse the two
 * `Queue.offerUnsafe` calls in `mountPane.ts` and this fails.
 */
class ResizeObserverStub {
  observe(): void {
    // jsdom has no layout, so there is nothing to observe; the Mount calls
    // `emitPaneRect` once itself, which is the emission under test.
  }
  unobserve(): void {}
  disconnect(): void {}
}

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  ResizeObserverStub;

const firstMessages = async (count: number) => {
  const element = document.createElement("div");
  const viewportElement = document.createElement("div");
  viewportElement.className = "fflow__viewport";
  element.append(viewportElement);
  document.body.append(element);

  const mount = MountPane({
    paneId: "ordering-pane",
    viewport: { x: 0, y: 0, zoom: 1 },
    minZoom: 0.5,
    maxZoom: 2,
  });

  const collected: Array<{ _tag: string }> = [];
  await Effect.runPromise(
    Effect.scoped(
      Stream.runForEach(
        Stream.take(mount.f(element, Stream.make("Live" as const)), count),
        (message) =>
          Effect.sync(() => {
            collected.push(message as unknown as { _tag: string });
          }),
      ),
    ),
  );
  return collected;
};

describe("the pane Mount's own emissions", () => {
  test("MountedPane arrives before the first ResizedPane", async () => {
    const [first, second] = await firstMessages(2);

    expect(first?._tag).toBe("MountedPane");
    expect(second?._tag).toBe("ResizedPane");
    // The id is what `Flow.setViewport` needs; a `ResizedPane` that overtakes it
    // is a fit that cannot reach the engine.
    expect(first).toEqual({
      _tag: "MountedPane",
      paneId: "ordering-pane",
    });
  }, 10_000);

  test("the pane rect carries the element's measured box", async () => {
    const [, resized] = await firstMessages(2);

    expect(resized?._tag).toBe("ResizedPane");
    // jsdom reports 0×0: what is being pinned is that the Mount measures the
    // element at all (and would report a real box in a browser), not a number.
    expect(resized).toMatchObject({
      _tag: "ResizedPane",
      pane: { width: 0, height: 0 },
    });
  }, 10_000);
});
