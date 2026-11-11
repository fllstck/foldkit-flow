# Third-Pass Critique of the Foldkit Flow Plan

## Summary

This revision resolves the seven findings from the second pass:

- handle invalidation now has explicit mechanisms;
- parent graph reconciliation is specified;
- viewport message ordering uses cancel-then-final;
- viewport behavior is described consistently;
- O(N) pan culling is acknowledged and measured;
- node-cache growth is addressed;
- `.fflow__nodrag` is correctly owned by the custom node handler.

The plan is now close to implementation-ready. I found one high-severity issue
and two lower-severity design gaps.

## Findings

### 1. High — `MeasureHandles` destroys measurements for unrelated nodes

The command accepts a subset of node IDs:

```ts
MeasureHandles({
  paneId,
  nodeIds,
})
```

See [MeasureHandles](./PLAN.md#43-host-registry-live-handles-out-of-the-frozen-model).

But it returns:

```ts
ReplacedHandleBounds({
  handles: nodeIds.flatMap(...)
})
```

`ReplacedHandleBounds` is described as replacing the entire
`model.handleBounds` collection. If a connection starts from node `A` and the
command measures only `A`, measurements for nodes `B`, `C`, and all other nodes
are removed. Hit testing then cannot find valid target handles on those nodes.

**Suggested correction:** choose one of these designs:

- return `MeasuredHandles` for each requested node and merge them;
- make `ReplacedHandleBounds` contain all currently mounted or visible nodes;
- or have the reducer replace only the requested node IDs while preserving all
  other entries.

The first option is likely the safest:

```ts
MeasuredHandles({
  nodeId,
  handles,
})
```

Also define behavior when `getNodeElement()` cannot find a requested node.
Returning an empty set silently could hide lifecycle races; use an explicit
failure or repository-standard diagnostic behavior.

### 2. Medium — renderer-cache lifetime is underspecified

The plan now says:

> `view/nodeCache.ts` keeps one `createLazy()` slot per node id in a `Map`
> owned by the renderer instance.

See [the cache design](./PLAN.md#45-the-hot-path-and-the-performance-gate).

However, `Flow.view(config, h)` is presented as a pure helper called from the
parent view. The plan does not define how a persistent renderer instance is
created or retained across view calls.

If `nodeCache.ts` creates the `Map` inside `Flow.view`, it will be recreated on
every render and provide no memoization benefit. If it uses a module-level Map,
separate Flow instances can share cache state and leak across mounts.

**Suggested correction:** specify the ownership and cleanup mechanism:

- create a renderer object once and pass it into `Flow.view`;
- store the cache in a per-pane host registry keyed by `paneId`, with mount and
  unmount cleanup;
- or expose `createRenderer()` and make `view` a method on that instance.

The cache should also be invalidated when the renderer function or dispatcher
changes, not only when node IDs are swept.

### 3. Low — parent reconciliation is not shown in the wiring example

The plan says that the parent folds `Flow.informGraphChanged` from the same
handler that mutates the graph; see [§2.5.9](./PLAN.md#25-state-and-context-contract).

But the example in [§3.5](./PLAN.md#35-wiring-in-a-consumer-app) shows
`foldOutMessage` applying positions, deleting elements, and adding edges without
calling `informGraphChanged`.

This leaves an important invariant implicit: after `deleteElements`, the parent
must reconcile the Flow Model before another Flow event can run.

**Suggested correction:** show the intended sequence in the sample:

```ts
const nextModel = deleteElements(model, nodeIds, edgeIds)
return {
  model: {
    ...nextModel,
    flow: Flow.informGraphChanged(
      nextModel.flow,
      contextFrom(nextModel),
    ).model,
  },
}
```

Alternatively, define a reusable parent helper that performs graph mutation and
Flow reconciliation atomically.

## Additional observation

The `MutationObserver` solution is appropriate for handle structure and inline
attribute/style changes, but stylesheet-only layout changes do not necessarily
produce a mutation.

The freshness `MeasureHandles` checkpoint covers connection-start hit testing,
but stored edge endpoints can still remain stale after an external CSS layout
change.

If custom node styles may change dynamically, either:

- remeasure edge geometry on relevant layout changes;
- use `ResizeObserver` or layout versioning for endpoint updates;
- or document that geometry-affecting CSS changes require an explicit remeasure
  or inform operation.

## Recommended actions

Before M2:

1. Change `MeasureHandles` so partial measurement cannot replace unrelated
   handle bounds.
2. Define the renderer-cache lifetime and cleanup behavior.
3. Show parent graph reconciliation in the consumer wiring example.

The remaining CSS-layout observation issue should be addressed in the M2
measurement contract or explicitly documented as a consumer responsibility.

## Verdict

The plan is now coherent enough to begin M0. Finding 1 should be resolved before
connection work begins, and finding 2 should be clarified before relying on the
performance benchmark. The rest of the design is substantially improved and no
longer has the earlier state-boundary or viewport-lifecycle blockers.
