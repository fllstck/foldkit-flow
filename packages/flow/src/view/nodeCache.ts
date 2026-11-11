import { createLazy } from "foldkit/html";
import type { Html } from "foldkit/html";

type LazySlot = ReturnType<typeof createLazy>;

export type NodeCache = Readonly<{
  /** Renders `fn(...args)` through the slot owned by `nodeId`. A slot is created
   *  on first use and reused while the function reference, the dispatcher, and
   *  every argument are unchanged. */
  render: <Args extends ReadonlyArray<unknown>>(
    nodeId: string,
    fn: (...args: Args) => Html,
    args: Args,
  ) => Html;
  /** Drops every slot whose id is absent from the render pass that just ran, so
   *  memory follows the current graph rather than its history (§4.5). */
  sweep: (nodeIds: ReadonlyArray<string>) => void;
  /** Drops every slot, and every VNode reference the slots retained. */
  dispose: () => void;
  count: () => number;
}>;

/**
 * One `createLazy()` slot per node id, owned by the renderer object.
 *
 * `createKeyedLazy` is deliberately not used for node ids: its entries are never
 * evicted, so unique ids from create/delete churn would grow the map for the
 * page lifetime. Owning the map lets the renderer sweep ids absent from the
 * latest render, which is the eviction variant Foldkit's own docblock names as
 * the upgrade path.
 */
export const createNodeCache = (): NodeCache => {
  const slots = new Map<string, LazySlot>();

  return {
    render: (nodeId, fn, args) => {
      const existing = slots.get(nodeId);
      if (existing !== undefined) return existing(fn, args);
      const slot = createLazy();
      slots.set(nodeId, slot);
      return slot(fn, args);
    },
    sweep: (nodeIds) => {
      const keep = new Set(nodeIds);
      const stale = [...slots.keys()].filter((id) => !keep.has(id));
      stale.forEach((id) => slots.delete(id));
    },
    dispose: () => {
      slots.clear();
    },
    count: () => slots.size,
  };
};
