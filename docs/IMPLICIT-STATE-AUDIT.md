# Implicit state-machine audit

## Scope

This audit reviewed mutable state outside the explicit `Flow.Model.gesture`
union, including renderer closures, memoization, Mounts, subscriptions,
observers, animation-frame scheduling, the pane-host registry, and the
`XYPanZoom` adapter.

The explicit Flow state machine remains clear and appropriately modeled through
the tagged gesture variants in `model.ts`, typed `Message` transitions, and
typed `OutMessage` facts. Most of the other mutable state is intentional
imperative state at a documented boundary rather than a second semantic graph
state machine.

## Findings

### 1. MEDIUM — `Renderer.dispose()` does not reset all renderer-owned state

**Location:** [`packages/flow/src/view/view.ts`](../packages/flow/src/view/view.ts)

`createRenderer()` owns more state than the per-node cache:

- `indexedBounds` and `handleIndex`;
- `geometryInputs` and `endpointsByEdgeId`;
- the minimap and description `ViewMemo` instances;
- VNodes retained by those memo slots;
- pending builder closures held by the `ViewMemo` instances.

However, `dispose()` currently only calls `cache.dispose()`. A renderer that
has been permanently unmounted can therefore retain graph-derived arrays,
VNode trees, and closures through the remaining closure caches until the
renderer itself becomes unreachable.

The disposal contract should reset or dispose every renderer-owned cache. Add a
regression test that renders graph-dependent chrome and edge geometry, calls
`dispose()`, then renders again and verifies that the memoized subtrees and
derived geometry are rebuilt rather than reused.

### 2. LOW — `ViewMemo` retains a pending builder on cache hits

**Location:** [`packages/flow/src/view/viewMemo.ts`](../packages/flow/src/view/viewMemo.ts)

`ViewMemo.on()` assigns `pending = build` before calling `createLazy()`. When
the inputs are unchanged, `createLazy()` returns its cached VNode without
calling `run()`. Consequently, `pending` is not cleared on a cache hit.

This does not normally change the rendered output, but it leaves the latest
builder closure retained until a later cache miss. That closure may capture the
HTML builder, graph arrays, dispatcher, and other render inputs.

The memo should clear pending state when a cached result is returned, or use a
resettable/disposable memo abstraction that does not require a mutable pending
callback. A focused test should exercise repeated cache hits and verify the
memo's disposal/reset behavior.

## Intentional imperative state

The following mutable state was reviewed and is considered intentional:

- `XYPanZoom`'s internal transform and pointer-gesture state;
- `MountPane.isLive`, which suppresses engine callbacks while the Foldkit view
  is paused;
- pending viewport and animation-frame state in
  [`packages/flow/src/runtime/viewportThrottle.ts`](../packages/flow/src/runtime/viewportThrottle.ts);
- the identity-safe live-pane registry in
  [`packages/flow/src/runtime/host.ts`](../packages/flow/src/runtime/host.ts);
- pointer, keyboard, and modifier subscription lifetimes;
- `ResizeObserver`/`MutationObserver` state and measurement-frame coalescing in
  `mountNode.ts`;
- renderer node slots, which are swept against the current graph and explicitly
  disposed;
- `WeakMap` geometry and hidden-subtree memoization, which is keyed by graph
  array identity and does not constitute semantic Model state.

The pane-host registry intentionally uses `paneId` as its key. Its documented
reuse rule is that a new mount replaces the old record and an old finalizer
cannot remove the replacement because release is identity-safe. Concurrent
mounts using the same `paneId` remain an API-level uniqueness requirement; no
additional correctness issue was found in the current documented lifecycle.

## Conclusion

The explicit Flow state machine is sound. Two lifecycle/cache findings should
be addressed before treating renderer disposal and memo retention as complete:

1. dispose all renderer-owned caches and memo slots;
2. eliminate or explicitly clear `ViewMemo`'s pending builder on cache hits.

No changes were made as part of this audit.
