import type { FlowNode } from "../model.js";
import { ancestorIds } from "./positions.js";

/**
 * `FlowNode.hidden` means **collapsed**, not merely "not drawn" (§7 M4).
 *
 * A hidden node is not rendered, its edges are not rendered, and neither is any
 * descendant: a container layout whose box disappears must take its contents with
 * it, and a child left floating at coordinates derived from a hidden parent is a
 * node with no visible cause. That is the semantic the 10k story needs —
 * upstream's own answer to very large graphs is "collapse large node trees" — so
 * it is the one this library ships, and there is no second "flat hide" flag.
 *
 * The set is memoized on the graph array's reference, which is the M2 §2.5 lesson
 * applied to a per-render scan: a drag frame reuses it, a graph change rebuilds it.
 */
const hiddenMemo: WeakMap<
  ReadonlyArray<FlowNode<unknown>>,
  ReadonlySet<string>
> = new WeakMap();

const computeHiddenIds = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlySet<string> => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));

  const hidden = new Set<string>();
  nodes.forEach((node) => {
    // The chain is `[node, parent, grandparent, …]`, so a hidden ancestor
    // anywhere in it collapses this node too, and a hidden node hides itself.
    const isCollapsed = ancestorIds(node, byId).some(
      (id) => byId.get(id)?.hidden === true,
    );
    if (isCollapsed) hidden.add(node.id);
  });

  return hidden;
};

/** Every node id hidden by its own flag **or** by an ancestor's. */
export const hiddenIds = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlySet<string> => {
  const key = nodes as ReadonlyArray<FlowNode<unknown>>;
  const cached = hiddenMemo.get(key);
  if (cached !== undefined) return cached;

  const built = computeHiddenIds(nodes);
  hiddenMemo.set(key, built);
  return built;
};
