# M0 Review

## Summary

The M0 implementation is in good shape, and [M0-FINDINGS.md](./M0-FINDINGS.md)
accurately records the main implementation discoveries and deliberate
limitations.

The repository checks passed:

- `pnpm -r typecheck`
- `pnpm --filter @fllstck/foldkit-flow test` — 9 tests passed
- M0 Playwright proofs — 3 tests passed

The implementation was reviewed in:

- [adapter.ts](../packages/flow/src/runtime/adapter.ts)
- [mountPane.ts](../packages/flow/src/runtime/mountPane.ts)
- [viewportThrottle.ts](../packages/flow/src/runtime/viewportThrottle.ts)
- [proofs.spec.ts](../packages/benchmark/tests/proofs.spec.ts)

## Confirmed findings

The following M0 findings are correct and implemented:

1. `panZoom.update(...)` is required and is now called.
2. Mount messages are lifted with `Mount.mapMessage`.
3. `onPanZoomEnd` uses the correct `(_event, next)` signature.
4. Cancel-then-final ordering is implemented through `throttle.cancel()`.
5. `Option.none()` is used for the initial pane ID.
6. The renderer receives a stable `toParentMessage`.
7. Initial SSR transform ownership correctly remains with the view.

The documented M0 limitations are also accurate: node dragging, selection,
handles, culling, `MutationObserver` invalidation, and the renderer cache are
not implemented yet.

## New finding

### High — `SyncViewport` leaves the Flow Model stale

[SyncViewport](../packages/flow/src/runtime/command.ts) calls
`host.panZoom.setViewport(...)`, updating the pan/zoom instance and the DOM.
However:

- `panZoomUpdate.onTransformChange` is a no-op in
  [mountPane.ts](../packages/flow/src/runtime/mountPane.ts);
- `CompletedSyncViewport` carries no viewport;
- [update.ts](../packages/flow/src/update.ts) does not update
  `model.viewport` when the command completes.

After a programmatic viewport sync, the DOM and pan/zoom instance contain the
new viewport while `model.viewport` still contains the old viewport. A later
ordinary rerender can therefore apply the stale Model transform again.

The current proof only checks the DOM immediately after the command and does
not catch this stale-state case. Add a regression test that:

1. executes `SyncViewport`;
2. waits for command completion;
3. triggers a rerender;
4. asserts that the synchronized transform remains in place.

Possible fixes include:

- emitting a viewport message from the programmatic viewport path and updating
  the Model; or
- including the viewport in `CompletedSyncViewport` and updating
  `model.viewport` there.

The selected approach should preserve the intended separation between
DOM-first gesture motion and committed Model state.

## Test coverage gap

The current proof suite verifies `SyncViewport`, but does not exercise an
actual pointer pan. It therefore does not yet prove that:

- `onPanZoom` fires after `update`;
- throttled viewport frames are emitted;
- `onPanZoomEnd` cancels a pending frame;
- the terminal viewport becomes the committed value.

These are appropriate M1/browser-test additions. The terminal-ordering test
described in the plan should be added before claiming that the complete
viewport lifecycle is proven.

## Verdict

M0 is successfully implemented, and its findings document is substantively
correct. The stale Model after `SyncViewport` is the main issue to resolve
before M1. Aside from that issue and the identified pointer-gesture coverage
gap, the current milestone and its explicitly stated limitations are sound.
