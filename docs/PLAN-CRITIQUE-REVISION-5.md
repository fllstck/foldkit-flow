# Fifth-Pass Critique of the Foldkit Flow Plan

## Summary

The latest revision successfully applies the four fourth-pass fixes:

- the `data-handles` signature was removed;
- renderer disposal was added;
- `PaneHost` now contains the live element, root, pan/zoom instance, and viewport;
- the stale Mount invalidation wording was corrected;
- `Flow.remeasure` was promoted to a public contract.

The overall architecture is now coherent and suitable for implementation. I
found three remaining issues in the interaction and DOM-observation details,
plus two minor consistency items.

## Online validation

The callback and observation concerns below are based on current upstream
behavior:

- [React Flow's `ZoomPane`](https://github.com/xyflow/xyflow/blob/main/packages/react/src/container/ZoomPane/index.tsx)
  passes `(event, viewport)` to `onPanZoom`, `onPanZoomStart`, and
  `onPanZoomEnd`.
- [XYFlow callback types](https://github.com/xyflow/xyflow/blob/main/packages/system/src/types/general.ts)
  define the move callbacks as
  `(event: MouseEvent | TouchEvent | null, viewport: Viewport) => void`.
- [MDN's `MutationObserver.observe()` documentation](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe)
  specifies that `attributeFilter` contains exact attribute names; it does not
  support wildcard patterns.

## Findings

### 1. High — `onPanZoomEnd` uses the wrong callback signature

The pane Mount uses the correct two-argument form for `onPanZoom`:

```ts
onPanZoom: (_event, next) => {
  // ...
}
```

But `onPanZoomEnd` is written as:

```ts
onPanZoomEnd: (next) => {
  if (!isLive) return;
  writeTransform(paneId, next);
  Queue.offerUnsafe(
    queue,
    Message.MovedViewport({ viewport: next, isGestureEnd: true }),
  );
}
```

See [§4.1](./PLAN.md#41-mount-panzoom-owns-its-gesture-the-model-owns-the-committed-viewport).

Current XYFlow supplies the event as the first argument and the viewport as the
second. As written, `next` would be the event rather than the viewport, so the
terminal viewport message and transform write would receive the wrong value.

Use the same signature as the other callbacks:

```ts
onPanZoomEnd: (_event, next) => {
  if (!isLive) return;
  writeTransform(paneId, next);
  Queue.offerUnsafe(
    queue,
    Message.MovedViewport({ viewport: next, isGestureEnd: true }),
  );
}
```

The M0 adapter compilation test should cover both `onPanZoom` and
`onPanZoomEnd` so this mismatch cannot recur.

### 2. Medium — `data-handle*` is not a valid `attributeFilter` entry

The plan says that the `MutationObserver` watches attributes filtered to:

```text
class, style, data-handle*
```

See [§2.5.3](./PLAN.md#25-state-and-context-contract) and [§4.2](./PLAN.md#42-mount-per-node-measurement-and-handle-bounds).

`MutationObserverInit.attributeFilter` accepts exact attribute names. It does
not interpret `data-handle*` as a wildcard, so changes to attributes such as
`data-handleid` or `data-handlepos` would not reliably trigger measurement.

Use the exact attributes used by the handle renderer, for example:

```ts
attributeFilter: [
  "class",
  "style",
  "data-handleid",
  "data-handlepos",
  "data-nodeid",
]
```

Alternatively, omit `attributeFilter` and filter mutation records inside the
callback. Add a browser test that changes `data-handleid` and `data-handlepos`
without changing the node dimensions.

### 3. Medium — missing pane hosts must not fall back to global `document`

The subscription design currently uses a fallback like:

```ts
target: () =>
  Option.getOrElse(getPaneRoot(paneId), () => document)
```

See [§4.4](./PLAN.md#44-subscriptions-gestures-that-span-elements).

This undermines the host isolation established by `PaneHost`. If a pane is
unmounted, remounted, or temporarily unavailable, its subscription can attach
to the global document. That can cause a removed flow to receive events, allow
two flows to interfere, bypass ShadowRoot or iframe isolation, and retain
listeners against the wrong host.

Do not fall back to `document`. Instead, make a missing host produce an empty
stream or an explicit subscription failure:

```ts
Option.match(getPaneRoot(paneId), {
  onNone: () => Stream.empty,
  onSome: (root) =>
    Dom.streamFromEventFilterMap({
      target: root,
      // ...
    }),
})
```

Apply the same rule to pointer-end and keyboard subscriptions. If a
document-level subscription is intentionally required for a specific gesture,
the document or root must be captured from the mounted `PaneHost`, not selected
as a global fallback.

## Minor consistency items

### Keep `PaneHost.viewport` synchronized or remove it

`PaneHost.viewport` is described as the last viewport known to the Model and is
used for initialization and synchronization; see [§4.3](./PLAN.md#43-host-registry-live-handles-out-of-the-frozen-model).
However, the shown `MovedViewport` path does not visibly call
`setPaneViewport`.

Either update the host record when viewport messages are processed, or remove
`viewport` from `PaneHost` if it is only incidental to the initial Mount. The
plan should state which owner is authoritative at each point in the lifecycle.

### Standardize the public `Flow.remeasure` signature

Some prose describes `Flow.remeasure(paneId)`, while the exported helper takes
both `paneId` and `nodeIds`. Standardize the public API and examples on one
signature. If omitting `nodeIds` is intended to mean “remeasure all nodes,”
specify that behavior and its performance cost explicitly.

## Recommended actions

Before M0:

1. correct the `onPanZoomEnd` callback parameters;
2. replace the wildcard MutationObserver filter with exact names or callback
   filtering;
3. remove the global `document` fallback from pane-scoped subscriptions;
4. either synchronize or remove `PaneHost.viewport`;
5. standardize the `Flow.remeasure` API signature.

## Verdict

The revised plan has no remaining architectural blockers. The three primary
findings are implementation-level correctness and lifecycle-isolation issues
that should be fixed before interaction code is written. After those changes,
the plan should be ready to proceed through M0, with the adapter compilation
test and browser observer/subscription tests providing the appropriate
regression coverage.
