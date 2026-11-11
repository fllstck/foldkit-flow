import { Effect } from "effect";
import { Server } from "foldkit/experimental";
import type { HtmlBuilder } from "foldkit/html";
import { describe, expect, test } from "vitest";

import { init } from "../model.js";
import { createViewMemo } from "./viewMemo.js";
import type { ViewMemo } from "./viewMemo.js";

type Observed = {
  builds: number;
  first: unknown;
  second: unknown;
  pendingAfterBuild: boolean;
  rebuilt: unknown;
  pendingAfterDispose: boolean;
  sameAfterDispose: boolean;
};

/**
 * Drives one memo through a real view, because a VNode can only be built with an
 * `HtmlBuilder`. The identity comparisons happen inside the view, where both nodes
 * exist at once.
 */
const exercise = async (): Promise<Observed> => {
  const observed: Observed = {
    builds: 0,
    first: undefined,
    second: undefined,
    pendingAfterBuild: false,
    rebuilt: undefined,
    pendingAfterDispose: false,
    sameAfterDispose: false,
  };
  const memo: ViewMemo = createViewMemo();
  const inputs = [{ graph: "unchanged" }];

  const view = (_model: unknown, h: HtmlBuilder<never>) => {
    const build = () => {
      observed.builds += 1;
      return h.div([], []);
    };

    observed.first = memo.on(inputs, build);
    observed.second = memo.on(inputs, build);
    observed.pendingAfterBuild = memo.hasPending();

    memo.dispose();
    observed.pendingAfterDispose = memo.hasPending();
    observed.rebuilt = memo.on(inputs, build);
    observed.sameAfterDispose = observed.rebuilt === observed.first;

    return { title: "memo", body: h.div([], []) };
  };

  await Effect.runPromise(
    Server.renderToString(
      { init: () => ({ model: init().model }), view },
      { isHydratable: false },
    ),
  );

  return observed;
};

describe("ViewMemo (implicit-state audit, finding 2)", () => {
  test("a cache hit reuses the VNode and builds once", async () => {
    const observed = await exercise();

    expect(observed.second).toBe(observed.first);
    // Two `on` calls, one build, one rebuild after dispose.
    expect(observed.builds).toBe(2);
  });

  test("a cache hit does not retain the builder closure", async () => {
    // The bug: `pending = build` was assigned before the slot call, and a hit does
    // not call `run`, so the most recent builder stayed referenced — with the HTML
    // builder, the graph arrays and the dispatcher it closes over.
    const observed = await exercise();

    expect(observed.pendingAfterBuild).toBe(false);
  });

  test("dispose drops the VNode and any pending builder", async () => {
    const observed = await exercise();

    expect(observed.pendingAfterDispose).toBe(false);
    expect(observed.sameAfterDispose).toBe(false);
    expect(observed.rebuilt).not.toBe(observed.first);
  });
});
