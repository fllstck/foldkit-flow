# M6 follow-up research: solutions for the retained gaps

**Read 2026-11-12.** This is a follow-up to
[`M6-RESEARCH.md`](M6-RESEARCH.md), not a replacement for its verdicts. The
purpose is to check whether current platform and library guidance provides a
solution that fits Foldkit's model-first, snapshot-based architecture.

It answers to [`M6-RESEARCH-FOLLOW-UP-REVIEW.md`](M6-RESEARCH-FOLLOW-UP-REVIEW.md),
which says which of the four I would take, reshapes §1, and records that §3 corrects
a verdict of M6's. Three of the four are built in M7 (§2, §3, §4) and the record is
[`M7-FINDINGS.md`](M7-FINDINGS.md); §1 is not.

## Summary

The original M6 decisions remain valid. The online evidence identifies four
practical, low-risk follow-ups:

1. Test an estimated first viewport, with a pane-measurement gate as the fallback,
   to address the 10k startup cost.
2. Provide a consumer-owned HTML overlay primitive for interactive edge labels.
3. Add a pure resize-policy callback rather than importing `XYResizer`'s live
   store contract.
4. Add a pure helper for parent-resize child compensation while leaving
   persistence to the consumer.

The remaining gaps either need a separate interaction design or are inherent in
consumer-owned DOM geometry.

## 1. The 10k startup cost

### Evidence

The committed M6 benchmark records **523 ms to first view** and **1,201 ms to
settle** on the expanded 10k fixture. The first render occurs before the pane
has dimensions, so culling is disabled and all nodes mount before the first
`ResizedPane` ([`expanded.spec.ts`](../packages/benchmark/tests/expanded.spec.ts),
[`M6-FINDINGS.md`](M6-FINDINGS.md) §2).

The current renderer explicitly enables culling only when `cull: true` and the
pane has a positive width and height (`view/view.ts`). The pane mount emits
`MountedPane`, then measures and emits `ResizedPane`
(`runtime/mountPane.ts`). A startup change must therefore be scoped to
`cull: true`; `cull: false` must preserve today's behavior.

TanStack Virtual exposes two relevant patterns:

- `initialRect` allows a consumer to provide the viewport rectangle before
  mount.
- `estimateSize` allows virtualization to begin from estimates and correct
  them after measurement.

Source: [TanStack Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer),
fetched 2026-11-12.

The platform's `content-visibility: auto` can defer layout and painting for
off-screen content, but it does not prevent the application from creating all
10,000 node mounts. It is therefore a possible secondary optimization, not a
fix for this startup mechanism.

Sources:

- [MDN: `content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility),
  fetched 2026-11-12.
- [MDN: `contain-intrinsic-size`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain-intrinsic-size),
  fetched 2026-11-12.

### Proposed solution

Measure three states before choosing the mechanism:

1. today's behavior;
2. an estimate-first path using the pane element's initial box or a documented
   `initialPane` renderer option;
3. a pane-measurement gate that renders no graph nodes until `ResizedPane`.

The estimate is the leading candidate because it avoids a blank first frame and
can be corrected by the first real measurement. The gate is the fallback if the
estimate cannot prevent the 10k mount cost.

The readiness signal must change with the implementation. The existing
`tests/expanded.spec.ts` readiness condition waits for
`data-measured >= 10,000`; that condition is incompatible with a culled startup
that intentionally mounts only the visible region. SSR/hydration must also be
measured explicitly: [`tests/proofs.spec.ts`](../packages/benchmark/tests/proofs.spec.ts)
currently checks the hydrated transform, not whether a gated graph visibly pops
in after hydration.

### Verdict

**Strong candidate for the next milestone, but not yet an implementation choice.**
It directly targets the largest measured cost without adding a spatial index or
changing graph geometry.

Required proof:

- startup time, first meaningful paint, and settle time at 625, 1k, and expanded
  10k for today's behavior, estimate-first, and gate;
- rendered-node count before and after the first `ResizedPane`;
- a redesigned expanded-fixture readiness signal;
- no regression to SSR/empty-pane behavior;
- the existing 625/1k frame gate.

## 2. Interactive edge labels

### Evidence

React Flow's official `EdgeLabelRenderer` uses a portal with an HTML `div`
positioned above the edge layer. Its documented interaction requirements are
`pointer-events: all` and the `nopan` class. Its example positions the label
with a screen-space translation around the edge midpoint.

Source: [React Flow: `EdgeLabelRenderer`](https://reactflow.dev/api-reference/components/edge-label-renderer),
last updated 2026-10-11.

This agrees with M6's finding that interactive labels are not SVG text
interactions. They are HTML controls layered above the graph, with explicit
pointer and pan ownership.

The existing M6 research also identifies the equivalent inverse-zoom transform
used by xyflow:

```text
translate(x, y) scale(1 / zoom) translate(-50%, -50%)
```

See [`M6-RESEARCH.md`](M6-RESEARCH.md) §8.

### Proposed solution

Add a consumer-owned edge overlay primitive, preferably as two separate pieces:

1. A pure helper that returns an edge label anchor in flow coordinates.
2. A renderer/panel hook that places consumer-provided HTML at that anchor,
   applies inverse zoom, and marks the element as non-pan interaction.

The library should not turn `renderEdgeLabel` into an HTML control renderer.
The consumer should own the button/menu markup and its messages.

### Verdict

**Closeable with a small, well-bounded public primitive.** This preserves the
existing SVG edge renderer and keeps control semantics in the consumer.

Required proof:

- label remains screen-size-stable while zooming;
- overlay paints above edges and below nodes;
- clicking a label does not pan or clear edge selection;
- the pane handler declines the label press;
- keyboard focus reaches the consumer control;
- labels remain anchored during pan and resize.

Because M6 edges are themselves focusable, the contract must also state that a
focusable overlay control creates a second tab stop at the same visual location
as the edge. The overlay is not nested in the edge's SVG subtree, so this is not
an ARIA nesting violation, but it is a deliberate tab-order consequence.

## 3. Resize vetoes and per-node resize policy

### Evidence

M6 correctly rejected direct adoption of xyflow's `XYResizer`: it requires
live store reads at gesture start and during every drag event. That does not
fit Foldkit's Mount boundary.

tldraw documents two distinct resize modes:

- `resize_bounds` for direct manipulation of one shape;
- `scale_shape` for scaling shapes as part of a larger selection.

Source: [tldraw `TLResizeMode`](https://tldraw.dev/reference/editor/TLResizeMode),
fetched 2026-11-12.

This supports separating resize policy from the low-level gesture rather than
adding more mutable renderer state.

### Proposed solution

Add a pure, consumer-supplied veto named `canResize` to `Flow.Context`:

```ts
type CanResize<NodeData> = (input: {
  node: FlowNode<NodeData>;
  start: Rect;
  next: Rect;
  modifier: boolean;
}) => boolean;
```

The state machine would call it with the current snapshot and proposed box.
Returning `false` would reject that frame without allowing the callback to
rewrite gesture state or read the DOM.

Per-node configuration such as horizontal-only resizing should remain data or
policy owned by the consumer. It should not recreate the `XYResizer` prop/update
channel.

### Verdict

**Closeable as a pure veto callback.** This addresses the useful part of
`shouldResize` while preserving the existing ownership boundary. It reverses
the original M6 `shouldResize` keep-out, but does not justify adopting
`XYResizer` or allowing the callback to return a replacement box.

## 4. Parent-resize child compensation

### Evidence

M6's original keep-out is about persistence, not arithmetic: the compensation
formula is simple, but only the consumer can apply the resulting child
positions to its graph.

The pinned xyflow implementation reports child position changes together with
the parent's dimension change. The full source analysis and formula are recorded
in [`M6-RESEARCH.md`](M6-RESEARCH.md) §6.

### Proposed solution

Expose a pure helper that computes the consumer changes without applying them:

```ts
compensateChildPositions(parentBefore, parentAfter, children);
```

The helper should return child-relative positions or position changes. It must
not mutate the Model, emit an `OutMessage`, or silently assume that the parent
will persist the result.

The delta is the direct parent's change in the parent's own coordinate space.
For nested containers, the helper must receive the before/after pair that the
consumer persists for that parent; it must not recompute the delta from an
absolute grandparent position. The helper compensates direct children only;
grandchildren follow when their own parent is compensated.

### Verdict

**Closeable as a convenience helper, not as automatic renderer behavior.**
This makes the documented workaround reliable while preserving the consumer's
authority over graph persistence. It is lower priority than `canResize` because
no current example consumer needs it.

## 5. Multi-node resize

### Evidence

xyflow's `XYResizer` is single-node. tldraw explicitly distinguishes
single-shape bounds resizing from selection scaling through `TLResizeMode`.
Its API therefore treats multi-selection resizing as a separate semantic mode,
not as several ordinary resize gestures.

Sources:

- [tldraw `TLResizeMode`](https://tldraw.dev/reference/editor/TLResizeMode),
  fetched 2026-11-12.
- [tldraw `Editor.resizeToBounds`](https://tldraw.dev/reference/editor/Editor#resizeToBounds),
  fetched 2026-11-12.

### Proposed solution

If demand justifies it, introduce a separate selection-scale gesture with:

- a selection bounds snapshot;
- a scale and translation per selected node;
- explicit handling for non-resizable nodes;
- a new output shape carrying transformed boxes, not only one delta;
- a documented policy for parent/child relationships.

This should not be added by looping the current single-node resize code.

### Verdict

**Possible, but not a gap closure for the current resize feature.** It is a new
interaction mode and should wait for a concrete consumer requirement.

## 6. Composite keyboard navigation

### Evidence

The WAI-ARIA grid pattern provides one tab stop for a composite and arrow-key
navigation among its descendants. It is specifically intended to reduce
large numbers of tab stops.

Source: [WAI-ARIA APG: Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/),
fetched 2026-11-12.

However, a graph is not inherently a row/column grid. The library would need to
define whether navigation follows graph topology, screen-space proximity,
render order, or separate node and edge collections. It would also need to
define how edge activation and node editing interact with arrow keys.

### Verdict

**Technically possible, but not ready to implement.** This is a keyboard-model
and state-design decision, not a straightforward accessibility attribute
change. A roving-tabindex implementation needs an active item that survives
focus leaving and returning; that state must be replay-safe in Foldkit's Model
or an explicitly managed host registry. M6's current behavior is conformant:
the APG's default tab sequence is DOM order, which is what the library uses.

## 7. Handle geometry during resize

### Evidence

React Flow's official guidance requires an explicit
`useUpdateNodeInternals()` call when handles are added, removed, or moved.
This confirms that handle geometry is a post-DOM-update measurement concern,
not purely a box-geometry calculation.

Source: [React Flow: `useUpdateNodeInternals`](https://reactflow.dev/api-reference/hooks/use-update-node-internals),
last updated 2026-10-11.

MDN states that `ResizeObserver` notifications are delivered before paint, but
also documents that cyclic or deferred notifications can span multiple paint
cycles. Foldkit's deliberate requestAnimationFrame coalescing adds another
known scheduling boundary.

Source: [MDN: `ResizeObserver`](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver),
last modified 2025-11-07.

### Verdict

**No general exact fix exists for arbitrary consumer DOM.** A synchronous
per-pointer measurement would trade the one-frame lag for layout reads on every
resize event. A pure re-derivation is only correct for known handle layouts.
The pinned engine also accepts declared handle geometry (`userNode.handles`),
and Foldkit's view-level handle specification already has the required shape.
That makes a declared-geometry mode available, but it is only correct when the
declaration agrees with the consumer's CSS.

The viable future options are:

- a consumer-declared handle geometry mode;
- a resize-specific measurement flush, if profiling proves the lag visible;
- retaining the current coalesced measurement contract.

The current keep-out remains justified.

## 8. `nodeOrigin`, `XYResizer`, and the culling index

The online review found no compatible solution that changes the original M6
verdicts:

- **`nodeOrigin`** remains best handled by a boundary conversion when a consumer
  has center-based coordinates.
- **`XYResizer`** still requires live store and DOM-adjacent channels that
  conflict with Foldkit's Mount contract.
- **The culling index** remains unjustified at current measured costs. An index
  should be reconsidered only when the scan itself exceeds the frame budget or
  the graph size/overscan policy changes materially.

## Recommended order

1. Pane-measurement gate for expanded 10k startup.
2. Consumer-owned edge overlay primitive.
3. Pure resize policy callback.
4. Pure parent-child compensation helper.
5. Revisit multi-node resize only with a concrete use case.
6. Revisit composite keyboard navigation only with a defined graph navigation
   model.
