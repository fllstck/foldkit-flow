import type { FlowEdge, FlowNode } from "../model.js";
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
  // SAFETY: the memo is keyed by reference only; the element type never
  // reaches the stored value, which is a plain set of ids.
  const key = nodes as ReadonlyArray<FlowNode<unknown>>;
  const cached = hiddenMemo.get(key);
  if (cached !== undefined) return cached;

  const built = computeHiddenIds(nodes);
  hiddenMemo.set(key, built);
  return built;
};

/**
 * The nodes a collapsed subtree does not take away — the graph as the user can
 * see it, with no culling.
 *
 * Memoized on the graph array for the same reason `hiddenIds` is, and for one
 * more: the result's **identity** is what the minimap and the description memoize
 * on, so a filter that allocated a fresh array per render would silently turn
 * those caches into per-frame rebuilds. One array per graph, until the graph
 * changes.
 */
const shownNodesMemo: WeakMap<
  ReadonlyArray<FlowNode<unknown>>,
  ReadonlyArray<FlowNode<unknown>>
> = new WeakMap();

export const shownNodes = <NodeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
): ReadonlyArray<FlowNode<NodeData>> => {
  // SAFETY: keyed by the graph's reference only; the stored value is the same
  // array type with its element type erased, which cannot leak into a caller.
  const key = nodes as ReadonlyArray<FlowNode<unknown>>;
  const cached = shownNodesMemo.get(key);
  if (cached !== undefined) {
    // SAFETY: the entry was written from this exact array reference, so its
    // element type is the caller's by construction.
    return cached as ReadonlyArray<FlowNode<NodeData>>;
  }

  const hidden = hiddenIds(nodes);
  const shown = nodes.filter((node) => !hidden.has(node.id));
  shownNodesMemo.set(key, shown);
  return shown;
};

/**
 * The edges with both ends shown. An edge into a collapsed subtree is not drawn,
 * not described, not selected, and not fitted — one rule, used by `visibleEdges`,
 * `selectAll` and the description region, so the three cannot disagree.
 *
 * Memoized on the edges array, keyed additionally by the identity of the hidden
 * set: a graph change replaces the nodes array, which replaces the hidden set,
 * which invalidates this.
 */
type ShownEdgesEntry = Readonly<{
  hidden: ReadonlySet<string>;
  shown: ReadonlyArray<FlowEdge<unknown>>;
}>;

const shownEdgesMemo: WeakMap<
  ReadonlyArray<FlowEdge<unknown>>,
  ShownEdgesEntry
> = new WeakMap();

export const shownEdges = <NodeData, EdgeData>(
  nodes: ReadonlyArray<FlowNode<NodeData>>,
  edges: ReadonlyArray<FlowEdge<EdgeData>>,
): ReadonlyArray<FlowEdge<EdgeData>> => {
  const hidden = hiddenIds(nodes);
  // SAFETY: keyed by the edges' reference only; the element type is erased from
  // the stored value and restored by the cast below.
  const key = edges as ReadonlyArray<FlowEdge<unknown>>;
  const cached = shownEdgesMemo.get(key);
  if (cached !== undefined && cached.hidden === hidden) {
    // SAFETY: the entry was written from this exact array reference and the same
    // hidden set, so its element type is the caller's by construction.
    return cached.shown as ReadonlyArray<FlowEdge<EdgeData>>;
  }

  const shown = edges.filter(
    (edge) => !hidden.has(edge.source) && !hidden.has(edge.target),
  );
  shownEdgesMemo.set(key, { hidden, shown });
  return shown;
};
