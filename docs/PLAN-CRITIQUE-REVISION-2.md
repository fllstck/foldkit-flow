# Second-Pass Critique of the Foldkit Flow Plan

## Summary

The revision substantially improves the plan. It addresses the earlier concerns
about graph context, selection representation, handle storage, viewport
initialization, pointer identity, cancellation, editable controls, event
propagation, culling during pan, pinned APIs, and benchmark reproducibility.

The design is now directionally implementable. Before starting M1, however,
several lifecycle and consistency issues should still be resolved. The most
important are handle invalidation when markup changes, reconciliation when the
parent graph changes independently, ordering of throttled viewport messages,
and contradictory descriptions of viewport updates.

## Findings

### 1. High — handle invalidation on markup changes is not actually wired

The plan says that a new node object causes the node subtree to re-render and
handles to be re-measured:

- [state and context contract](./PLAN.md#25-state-and-context-contract)
- [node Mount design](./PLAN.md#42-mount-per-node-measurement-and-handle-bounds)

But the Mount is keyed only by `node.id`, and the DOM node is otherwise reused.
Under the documented Foldkit Mount semantics, re-rendering an existing DOM node
does not rerun its Mount. A `ResizeObserver` also will not necessarily fire when
handles appear or disappear if the node's overall size remains unchanged.

For example:

1. A node initially renders handle `a`.
2. The parent replaces the node object with a renderer that renders handle `b`.
3. Foldkit reuses the node element.
4. The Mount does not rerun.
5. The node dimensions do not change.
6. `handleBounds` still contains `a`.

**Suggested correction:** choose an explicit invalidation mechanism:

- include a handle/render version in the Mount identity;
- use a `MutationObserver`;
- provide a Command or explicit message to remeasure;
- or put the handle-bearing subtree behind a key that guarantees remounting.

The phrase “re-renders and re-measures” currently describes an intended result,
not a specified mechanism.

### 2. High — parent graph changes can leave stale selections and dead handles

The new context is derived per dispatch through `contextFrom(model)`; see
[the parent wiring](./PLAN.md#35-wiring-in-a-consumer-app). This solves access to
current graph data while processing a Flow message, but it does not synchronize
the Flow Model when the parent graph changes for another reason.

For example:

1. A node is selected.
2. The parent receives `DeletedElements`.
3. The parent removes the node from `graph.nodes`.
4. No Flow message necessarily runs to prune `selectedNodeIds` or
   `handleBounds`.

The plan relies on node Mount release to emit `RemovedNodeMeasurement`; see
[measurement cleanup](./PLAN.md#42-mount-per-node-measurement-and-handle-bounds).
Relying on asynchronous DOM teardown to reconcile application-owned graph data is
fragile, particularly because Mount messages after unmount may be discarded.

This matters because:

```ts
Flow.hitTestHandle(model, point)
```

takes no graph context and can therefore return a handle for a node that no
longer exists.

**Suggested correction:** define a parent-to-flow reconciliation seam, such as:

```ts
Flow.informGraphChanged(model, {
  nodeIds,
  edgeIds,
})
```

or a `GraphChanged` message carrying current IDs. Use it to prune:

- selected node IDs;
- selected edge IDs;
- node sizes;
- handle bounds;
- active gestures referring to removed nodes.

Alternatively, make `hitTestHandle` accept current graph context and explicitly
reject unknown node IDs.

### 3. Medium — throttled viewport messages can arrive out of order

The pane Mount emits throttled non-terminal messages and then immediately queues
a terminal message; see [the pane Mount callbacks](./PLAN.md#41-mount-panzoom-owns-its-gesture-the-model).

The plan does not define what happens if a scheduled throttled frame is still
pending when `onPanZoomEnd` runs. A possible sequence is:

1. `MovedViewport({ isGestureEnd: false })` is scheduled.
2. `onPanZoomEnd` queues `MovedViewport({ isGestureEnd: true })`.
3. The scheduled frame runs afterward.
4. The Model regresses to an older viewport, and terminal commit ordering is
   violated.

**Suggested correction:** make the throttler explicitly one of:

- flush-before-final;
- cancel-before-final;
- sequence-numbered, with stale messages ignored;
- or a single coalescing stream that guarantees terminal ordering.

Add a Story test for a pending frame followed by gesture end.

### 4. Medium — viewport behavior is described inconsistently

The revised contract correctly says that:

- `MovedViewport({ isGestureEnd: false })` is emitted during the gesture;
- the Flow Model is updated per frame so culling follows the pan;
- only the terminal message emits `ChangedViewport`.

See [the viewport transition rules](./PLAN.md#32-messages-and-outmessages) and
[the Mount rules](./PLAN.md#41-mount-panzoom-owns-its-gesture-the-model).

However, the hot-path description still says:

> “`onPanZoomEnd` emits one `MovedViewport`, which commits the value into the
> Model.”

See [the motion tiers](./PLAN.md#45-the-hot-path-and-the-performance-gate).
That wording contradicts the per-frame Model updates described elsewhere. An
implementer could follow it and omit the per-frame updates required for culling.

**Suggested correction:** explicitly distinguish:

1. direct DOM transform writes;
2. throttled per-frame `MovedViewport` messages;
3. the terminal `MovedViewport({ isGestureEnd: true })`;
4. the single `ChangedViewport` OutMessage.

### 5. Medium — culling remains O(total nodes) per viewport frame

The plan claims that per-frame work scales with the dragged set plus culled edge
endpoints; see [the performance rationale](./PLAN.md#45-the-hot-path-and-the-performance-gate).

But `visibleNodes(model, nodes)` is described as a rectangle test over the
supplied node array. If the parent passes all nodes, each throttled viewport
message still scans every node. The culling step is therefore O(N) per pan frame,
not proportional only to visible nodes or dragged nodes.

This may be acceptable at 625 or 1,000 nodes, but it weakens the justification
for the 10k exploration.

**Suggested correction:** either:

- state honestly that culling is O(N) per viewport frame;
- use a spatial index;
- update visibility less frequently than the transform;
- or maintain a derived index outside the Model with a documented lifecycle.

At minimum, record culling-scan cost as a separate benchmark metric.

### 6. Medium — `createKeyedLazy` memory usage is unbounded

The plan explicitly says that entries are never evicted; see
[the memoization design](./PLAN.md#45-the-hot-path-and-the-performance-gate).
It describes this as “bounded by graph churn,” but graph churn is not a bound:
repeatedly creating unique node IDs can grow the cache for the lifetime of the
page.

This matters for an editor where nodes may be created and deleted frequently.

**Suggested correction:** either:

- avoid using `createKeyedLazy` for unbounded entity IDs;
- add an eviction or reset lifecycle if Foldkit supports one;
- scope the lazy cache to a Flow instance and recreate it when appropriate; or
- document this as a deliberate memory tradeoff with a measured upper bound.

Do not call it bounded unless an actual bound or eviction policy exists.

### 7. Low — `noDragClassName` is attributed to the wrong subsystem

The propagation section says that `XYPanZoom` reads `noPanClassName`,
`noWheelClassName`, and `noDragClassName` equivalents; see
[§4.6](./PLAN.md#46-event-propagation-rules).

In the current XYFlow API, `XYPanZoom` has pan and wheel class options. Node-drag
suppression belongs to the drag subsystem, which this plan intentionally does
not use. Since dragging is implemented by Foldkit's own node handlers,
`.fflow__nodrag` must be enforced by those handlers.

**Suggested correction:** state that:

- `noPanClassName` and `noWheelClassName` are passed to `XYPanZoom`;
- `.fflow__nodrag` is checked by the custom node pointer handler;
- handle and nested-control propagation is handled by Foldkit attributes.

The adapter should verify this distinction.

## Minor consistency issues

- The top-level ownership diagram still shows `selection: [ids]`, while the
  Model now correctly has separate `selectedNodeIds` and `selectedEdgeIds`.
- The TL;DR still implies that viewport state is committed only at gesture
  completion, while the revised design updates the Flow Model every throttled
  frame.
- “One Mount per node” should explain how changed handle structure forces
  remeasurement rather than implying keyed rendering does this automatically.
- The plan says both that the transform is written directly without a diff and
  that every viewport frame updates the Model and culling. These are compatible,
  but the ordering and conflict-resolution rule should be stated explicitly.

## Recommended changes before M0/M1

Before starting M0, clarify the exact XYFlow adapter and viewport ordering.
Before starting M1, resolve:

1. handle-structure invalidation;
2. parent-to-flow graph reconciliation;
3. terminal viewport-message ordering;
4. the contradictory viewport description.

The culling complexity and memoization memory behavior should be measured and
documented in the M0 benchmark report.

## Verdict

The revision is now close to an implementable design and fixes nearly all of the
original blockers. It should not yet be treated as implementation-ready until
the four high-priority lifecycle and consistency issues above are made explicit
in the API and tested in the milestone criteria.
