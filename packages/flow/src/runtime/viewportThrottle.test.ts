import { afterEach, describe, expect, test, vi } from "vitest";

import { createViewportThrottle } from "./viewportThrottle.js";

type Frame = { id: number; callback: FrameRequestCallback };

const installFakeFrames = () => {
  let nextId = 1;
  let frames: Frame[] = [];

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    frames.push({ id, callback });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames = frames.filter((frame) => frame.id !== id);
  });

  return {
    runFrame: (now = 16) => {
      const pending = frames;
      frames = [];
      for (const frame of pending) frame.callback(now);
    },
    get pending() {
      return frames.length;
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createViewportThrottle", () => {
  test("coalesces offers to one emit per animation frame", () => {
    const fake = installFakeFrames();
    const emitted: Array<{ x: number; y: number; zoom: number }> = [];
    const throttle = createViewportThrottle((viewport) =>
      emitted.push(viewport),
    );

    throttle.offer({ x: 1, y: 0, zoom: 1 });
    throttle.offer({ x: 2, y: 0, zoom: 1 });
    expect(fake.pending).toBe(1);

    fake.runFrame();
    expect(emitted).toEqual([{ x: 2, y: 0, zoom: 1 }]);
  });

  test("cancel drops the pending frame and the pending value", () => {
    const fake = installFakeFrames();
    const emitted: Array<unknown> = [];
    const throttle = createViewportThrottle((viewport) =>
      emitted.push(viewport),
    );

    throttle.offer({ x: 1, y: 0, zoom: 1 });
    throttle.cancel();
    fake.runFrame();

    expect(emitted).toEqual([]);
    expect(fake.pending).toBe(0);
  });

  test("a later offer after a flush starts a new frame", () => {
    const fake = installFakeFrames();
    const emitted: Array<unknown> = [];
    const throttle = createViewportThrottle((viewport) =>
      emitted.push(viewport),
    );

    throttle.offer({ x: 1, y: 0, zoom: 1 });
    fake.runFrame();
    throttle.offer({ x: 3, y: 0, zoom: 1 });
    fake.runFrame();

    expect(emitted).toEqual([
      { x: 1, y: 0, zoom: 1 },
      { x: 3, y: 0, zoom: 1 },
    ]);
  });
});
