# Final Check of the Foldkit Flow Plan

## Summary

The fixes from the fifth-pass review are present and correct:

- `onPanZoomEnd` now uses the `(event, viewport)` callback signature;
- the `MutationObserver` is unfiltered rather than using the invalid
  `data-handle*` wildcard;
- missing pane hosts produce `Stream.empty` instead of falling back to the
  global `document`;
- `PaneHost.viewport` was removed so the Model remains the viewport authority;
- `Flow.remeasure(paneId, nodeIds)` is consistently documented;
- the revision history records all five fixes.

The plan is architecturally ready for implementation. Two documentation and
specification inconsistencies remain.

## Findings

### 1. Low — the risk table contains stale MutationObserver wording

The current observer contract in [§2.5.3](./PLAN.md#25-state-and-context-contract)
correctly specifies:

```ts
{ childList: true, attributes: true, subtree: true }
```

with no `attributeFilter`.

However, the risk table still says:

> `MutationObserver` on the node subtree (filtered to `class`, `style`,
> `data-handle*`)

See [the risk table](./PLAN.md#8-risks-and-their-mitigation).

Update that row to describe the actual design: the observer watches `childList`
and `attributes` throughout the subtree, and a per-frame coalescer limits
measurement work. Leaving the stale wording could lead an implementation to
reintroduce the invalid wildcard filter.

### 2. Medium — cancel-then-final is described but not shown in the adapter code

The prose in [§4.1](./PLAN.md#41-mount-panzoom-owns-its-gesture-the-model-owns-the-committed-viewport)
correctly requires cancel-then-final ordering:

1. cancel the pending throttled frame;
2. write the final transform;
3. queue the terminal `MovedViewport` message.

But the `onPanZoomEnd` example only shows the transform write and terminal
message. It does not show the cancellation operation:

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

Make the example executable as a specification by showing the throttler's
explicit cancellation call before the final write, for example:

```ts
onPanZoomEnd: (_event, next) => {
  if (!isLive) return;
  cancelPendingViewportFrame();
  writeTransform(paneId, next);
  Queue.offerUnsafe(
    queue,
    Message.MovedViewport({ viewport: next, isGestureEnd: true }),
  );
}
```

Use the actual helper name and make clear that cancellation also prevents the
Mount-scoped cell or timer from emitting a late non-terminal frame. The existing
Story test should assert this ordering, not merely the final viewport value.

## Final verdict

There are no remaining architectural blockers. After correcting these two
inconsistencies, the plan can be treated as final and implementation-ready.
The most important validation remains the M0 adapter compilation test and the
browser test covering cancellation of a pending viewport frame before the
terminal message.
