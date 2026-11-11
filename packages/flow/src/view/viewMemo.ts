import type { Html } from "foldkit/html";
import { createLazy } from "foldkit/html";

export type ViewMemo = Readonly<{
  /** Returns the VNode built the last time `inputs` were reference-equal, and
   *  rebuilds otherwise. */
  on: (inputs: ReadonlyArray<unknown>, build: () => Html) => Html;
  /** Drops the cached VNode and any pending builder, so the next `on` rebuilds.
   *  `Renderer.dispose()` calls this on every memo it owns. */
  dispose: () => void;
  /** Diagnostic: whether a builder closure is currently retained. */
  hasPending: () => boolean;
}>;

/**
 * A one-slot VNode memo for chrome that must not be rebuilt per frame.
 *
 * Chrome that reads the graph lives in the same `view` call as the transform, so
 * it runs once per viewport frame whether it needs to or not. A pan changes none
 * of its inputs — the parent's `nodes`/`edges` arrays are the same objects — so
 * returning the previous VNode skips construction *and* subtree diffing
 * (snabbdom short-circuits on an identical reference).
 *
 * It is one `createLazy` slot rather than a home-made cache: lazy results are
 * marked as memoized, which is what lets Foldkit's clone-on-reuse pass leave them
 * alone, and the slot already compares the function reference, the dispatcher,
 * and every argument by reference. `run` is stable and reads the pending builder,
 * so `build` is not part of the comparison — only `inputs` are.
 *
 * One consequence of that shape: `run` cannot be re-created per call (the slot
 * compares it), so the pending builder is instance state and a memo instance is
 * **not re-entrant** — a builder must not call `on` on the same memo.
 */
export const createViewMemo = (): ViewMemo => {
  let slot = createLazy();
  let pending: (() => Html) | undefined;

  const run = (..._args: ReadonlyArray<unknown>): Html => {
    const build = pending;
    pending = undefined;
    return build === undefined ? null : build();
  };

  return {
    on: (inputs, build) => {
      pending = build;
      const node = slot(run, [...inputs]);
      // A cache hit returns the previous VNode *without* calling `run`, so without
      // this the builder — and the HTML builder, graph arrays and dispatcher it
      // closes over — would be retained until the next miss. A miss has already
      // consumed it; clearing again is free (implicit-state audit, finding 2).
      pending = undefined;
      return node;
    },
    dispose: () => {
      slot = createLazy();
      pending = undefined;
    },
    hasPending: () => pending !== undefined,
  };
};
