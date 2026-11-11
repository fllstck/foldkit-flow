# M0 Follow-up Review

## Summary

The latest M0 changes are solid:

- `panZoom.update(...)` remains correctly wired;
- `onPanZoomEnd` uses the correct callback signature;
- cancel-then-final viewport throttling is implemented;
- pointer-pan coverage was added;
- the SyncViewport-to-rerender regression test was added;
- SyncViewport failures are surfaced through `FailedSyncViewport`;
- linting and formatting configuration is in place and passing.

All validation passed:

- `pnpm check`;
- `pnpm --filter @fllstck/foldkit-flow-benchmark exec playwright test tests/proofs.spec.ts`;
- Flow unit tests — 9 passed;
- workspace typechecking;
- Oxlint;
- Prettier formatting checks.

The browser proof suite now has four passing proofs, including the pointer-pan
test.

## Remaining issue

### High — the Flow Model is still stale after `SyncViewport`

The underlying issue remains:

- [CompletedSyncViewport](../packages/flow/src/message.ts) carries no viewport;
- [SyncViewport](../packages/flow/src/runtime/command.ts) emits only
  `CompletedSyncViewport()`;
- [update.ts](../packages/flow/src/update.ts) leaves `model.viewport`
  unchanged for `CompletedSyncViewport`;
- `panZoomUpdate.onTransformChange` remains a no-op in
  [mountPane.ts](../packages/flow/src/runtime/mountPane.ts).

The new browser regression test passes, but it does not prove that the Model was
updated. It passes because the existing pane Mount preserves the DOM and the
rerendered virtual tree still contains the same stale transform, so the diff
has no reason to rewrite the DOM.

This can become incorrect when:

- a future view reconstruction replaces the viewport subtree;
- time travel or hydration rebuilds from the Model;
- another code path explicitly synchronizes the DOM from `model.viewport`;
- the pane is remounted after the command.

The implementation should commit programmatic viewport changes to the Model.
Recommended options:

1. include the target viewport in `CompletedSyncViewport` and update
   `model.viewport`; or
2. emit a dedicated viewport message from the command path and process it in
   `update`.

The pointer-pan test now covers the gesture path correctly because
`MovedViewport` updates the Model. The missing commit applies specifically to
programmatic `SyncViewport`.

## Test recommendation

The regression should assert Model state directly, rather than only checking
the current DOM. A focused unit test can dispatch `CompletedSyncViewport` with
the target viewport and assert that `update` returns that viewport. A browser
test should then cover a remount or a view reconstruction from the committed
Model state.

## Final verdict

M0 is well validated and the new linting and formatting tooling works. The only
substantive unresolved issue is the programmatic viewport synchronization
contract: the DOM is updated, but the Flow Model is not. Resolve that before
considering the viewport lifecycle complete or building features that depend on
remounting or time travel.
