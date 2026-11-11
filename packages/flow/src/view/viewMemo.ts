import type { Html } from "foldkit/html";
import { createLazy } from "foldkit/html";

export type ViewMemo = Readonly<{
  /** Returns the VNode built the last time `inputs` were reference-equal, and
   *  rebuilds otherwise. */
  on: (inputs: ReadonlyArray<unknown>, build: () => Html) => Html;
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
 */
export const createViewMemo = (): ViewMemo => {
  const slot = createLazy();
  let pending: (() => Html) | undefined;

  const run = (..._args: ReadonlyArray<unknown>): Html => {
    const build = pending;
    pending = undefined;
    return build === undefined ? null : build();
  };

  return {
    on: (inputs, build) => {
      pending = build;
      return slot(run, [...inputs]);
    },
  };
};
