# M1 Review

## Summary

M1 is broadly successful, and [M1-FINDINGS.md](./M1-FINDINGS.md) accurately
records most implementation differences from the plan.

Validation passed:

- `pnpm check`
  - typechecking passed;
  - Oxlint passed;
  - Prettier passed;
  - 75 unit tests passed;
- `pnpm build`;
- M1 interaction and M0 browser proofs — 10 passed.

The implementation reviewed includes:

- [update.ts](../packages/flow/src/update.ts)
- [view.ts](../packages/flow/src/view/view.ts)
- [mountNode.ts](../packages/flow/src/runtime/mountNode.ts)
- [measure.ts](../packages/flow/src/runtime/measure.ts)
- [nodeCache.ts](../packages/flow/src/view/nodeCache.ts)
- [interaction.spec.ts](../packages/benchmark/tests/interaction.spec.ts)

## Findings

### High — connection preview ignores the selected handle ID

The connection geometry helper in
[view.ts](../packages/flow/src/view/view.ts) resolves a handle using only its
node and type:

```ts
entry.nodeId === ref.nodeId && entry.type === ref.type;
```

It does not compare `ref.handleId`.

When a node has multiple source or target handles, the connection preview can
therefore originate from or terminate at the first measured handle of that
type rather than the handle the user selected. The state machine and
`hitTestHandle` preserve `handleId`, but the renderer drops that identity while
calculating the preview line.

Use the same identity comparison as `update.ts`:

```ts
entry.nodeId === ref.nodeId &&
  entry.type === ref.type &&
  Option.getOrUndefined(entry.handleId) === Option.getOrUndefined(ref.handleId);
```

Add a test with two handles of the same type at different positions and assert
that the preview follows the selected handle.

### Medium — culling can remove a node during a drag

Culling is applied before the drag overlay is rendered:

```ts
const nodes = isCulling ? visibleNodes(model, input.nodes) : input.nodes;
```

`visibleNodes` uses the parent graph position, not `position + gesture.delta`.
If a dragged node moves beyond the overscan region, it can disappear from the
DOM while the drag is still active.

This conflicts with the intended drag-overlay behavior. Keep actively dragged
IDs in the rendered set, or include their overlay position in visibility
calculation:

```ts
const nodes = isCulling
  ? includeDraggedNodes(
      visibleNodes(model, input.nodes),
      draggedIds,
      input.nodes,
    )
  : input.nodes;
```

Add a browser test that drags a node beyond the culling overscan boundary and
verifies that it remains rendered throughout the gesture.

### Medium — additive selection is not wired through the pointer layer

The state machine supports `isAdditive`, and unit tests cover additive
selection, but the renderer handlers currently emit:

```ts
isAdditive: false;
```

for both node and pane presses. No modifier key is inspected, so additive
selection is unavailable through actual browser interaction even though the
update logic supports it.

If additive selection is an M1 requirement, derive it from the pointer event's
modifier state and add a browser test. If it is intentionally deferred,
document that the state-machine capability is preparatory and remove
additive-selection claims from the M1 interaction contract.

## Additional observations

The following M1 findings are appropriately documented rather than defects:

- unfiltered `MutationObserver` with per-frame coalescing;
- ignoring the node wrapper's own transform mutation;
- deriving measurement scale from the element;
- best-effort `RemovedNodeMeasurement`;
- culling being opt-in;
- renderer cache ownership and sweeping;
- heap-after-churn being deferred;
- no box selection, fit view, reconnect, or full edge geometry yet.

## Verdict

M1's core interaction, measurement, culling, caching, ShadowRoot handling, and
performance work is well validated. Before proceeding to M2, fix the
handle-ID resolution bug. Also decide whether additive selection and
dragged-node retention under culling are M1 guarantees or explicitly deferred
behaviors.
