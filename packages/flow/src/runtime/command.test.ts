import { Effect, Option } from "effect";
import { afterEach, describe, expect, test } from "vitest";

import type { PanZoomInstance } from "./adapter.js";
import { SyncViewport } from "./command.js";
import { clearPaneHosts, registerPane } from "./host.js";

const registerFakePane = (initial: { x: number; y: number; zoom: number }) => {
  let current = initial;
  const calls: Array<{ viewport: typeof initial; options: unknown }> = [];

  const panZoom = {
    getViewport: () => current,
    setViewport: (
      viewport: typeof initial,
      options?: { duration?: number },
    ) => {
      calls.push({ viewport, options });
      current = viewport;
      return Promise.resolve({
        x: viewport.x,
        y: viewport.y,
        k: viewport.zoom,
      });
    },
  } as unknown as PanZoomInstance;

  registerPane({
    paneId: "pane-a",
    element: {} as HTMLElement,
    root: {} as Document,
    panZoom,
  });

  return {
    calls,
    get current() {
      return current;
    },
  };
};

afterEach(() => {
  clearPaneHosts();
});

describe("SyncViewport", () => {
  test("reports the viewport the engine committed", async () => {
    const pane = registerFakePane({ x: 0, y: 0, zoom: 1 });
    const target = { x: -200, y: -100, zoom: 1.25 };

    const message = await Effect.runPromise(
      SyncViewport({
        paneId: "pane-a",
        viewport: target,
        duration: Option.some(120),
      }).effect,
    );

    expect(message).toEqual({
      _tag: "CompletedSyncViewport",
      viewport: target,
    });
    expect(pane.calls).toEqual([
      { viewport: target, options: { duration: 120 } },
    ]);
    expect(pane.current).toEqual(target);
  });

  test("reports a missing pane instead of throwing", async () => {
    const message = await Effect.runPromise(
      SyncViewport({
        paneId: "missing",
        viewport: { x: 0, y: 0, zoom: 1 },
        duration: Option.none(),
      }).effect,
    );

    expect(message).toEqual({
      _tag: "FailedSyncViewport",
      reason: "pane not mounted",
    });
  });
});
