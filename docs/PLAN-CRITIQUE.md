# Critique of the Foldkit Flow Plan

## Summary

The plan has a strong overall direction: keeping graph data parent-owned, using
Foldkit's effect seams, avoiding a mutable XYFlow store, and isolating
framework-independent geometry are all sensible choices.

However, several parts of the design are not implementable as currently written.
The most important problem is the state boundary: `Flow.update` is expected to
perform operations that require nodes, edges, and handle definitions, but the
declared `Flow.Model` contains none of that context. Handle measurement,
viewport initialization, culling, and pointer ownership also need more precise
contracts before implementation starts.

## Blockers

### 1. `Flow.update` cannot perform several required operations

The flow Model contains interaction state only:

- selection
- viewport
- gesture
- node sizes

See [the Model declaration](./PLAN.md#31-model) and the parent wiring in
[§3.5](./PLAN.md#35-wiring-in-a-consumer-app).

Nevertheless, the flow update logic is expected to:

- delete selected nodes and edges;
- select nodes and edges;
- validate connections;
- identify connection targets;
- perform handle hit testing.

The parent-owned `nodes` and `edges` are supplied to `Flow.view`, but not to
`Flow.update` as context. The plan also says that `update` “knows the graph” in
[§2.3](./PLAN.md#23-recovering-what-the-wrappers-give-for-free), although the
declared API does not provide that information.

**Suggested correction:** choose one explicit mechanism:

1. pass graph context into every update/helper call;
2. add `informNodesChanged` and `informEdgesChanged` messages that maintain
   derived interaction indexes;
3. move graph-dependent operations back into the parent update; or
4. make the flow a generic context-aware submodel.

The chosen mechanism should be part of the public API before M1.

### 2. Handle geometry is described but not represented

The plan says node mounts emit `MeasuredHandles` in
[§4.2](./PLAN.md#42-mount-per-node-measurement-and-handle-bounds), but
`MeasuredHandles` is not present in the Message union in
[§3.2](./PLAN.md#32-messages-and-outmessages).

The Model contains `nodeSizes`, but no handle-bounds collection. Yet
`hitTestHandle(model, nodes, point)` is advertised in
[§3.4](./PLAN.md#34-pure-helpers-the-consumer-calls-from-update).

Because `renderNode` is opaque to the flow, handle definitions cannot be derived
from the `nodes` array. The DOM measurement therefore needs to be stored
somewhere and made available to update, but the current design does not specify
where.

**Suggested correction:** add a concrete handle-bounds representation to the
Model, or explicitly move hit testing into an imperative DOM interaction seam.
Define lifecycle rules for:

- node mount;
- node resize;
- custom handle changes;
- node removal;
- viewport zoom changes.

### 3. Handle bounds become stale after zoom or transform changes

The plan measures handles after node measurement only:

> “After measurement, `getHandleBounds(...)` … emit `MeasuredHandles`”

XYFlow's `getHandleBounds` uses the current zoom when converting DOM coordinates
to node-local coordinates. The proposed node mount has no reactive zoom
dependency and is not restarted when the viewport changes. Handle bounds can
therefore become incorrect after zooming.

The upstream implementation queries the DOM and divides offsets by zoom:

- [`getHandleBounds` in XYFlow](https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/dom.ts)

**Suggested correction:** either:

- recompute handle bounds whenever zoom changes;
- store zoom-independent local geometry; or
- perform hit testing directly against current DOM geometry.

This should be an explicit M2 design decision.

### 4. Pan/zoom starts with the wrong internal viewport

The sample `MountPane` constructs `XYPanZoom` with:

```ts
viewport: { x: 0, y: 0, zoom: 1 }
```

See [§4.1](./PLAN.md#41-mount-panzoom-owns-its-gesture-the-model-owns-the-committed-viewport).

The surrounding text acknowledges that the real viewport must come from the
Model, but leaves two alternatives open. Writing the CSS transform from the view
does not initialize d3-zoom's internal transform. The first wheel or pan can
therefore jump to a different transform.

The upstream implementation initializes the zoom transform from the constructor
viewport and exposes `syncViewport` separately:

- [`XYPanZoom`](https://github.com/xyflow/xyflow/blob/main/packages/system/src/xypanzoom/XYPanZoom.ts)

**Suggested correction:** make the initial viewport a mount argument, or define
a guaranteed `MountedPane → SyncViewport` sequence. Do not leave both approaches
as unresolved alternatives.

### 5. The planned `setViewport` call may not match the XYFlow API

The plan uses:

```ts
panZoom.setViewport(viewport, Option.getOrUndefined(duration))
```

See [the `SyncViewport` command](./PLAN.md#43-host-registry-live-handles-out-of-the-frozen-model).

Current XYFlow source takes a `PanZoomTransformOptions` object as its second
parameter, with the duration nested inside that object. The exact API may differ
in the pinned version, but the plan does not lock or compile-check that contract.

**Suggested correction:**

- pin the exact `@xyflow/system` version;
- verify the signatures in M0;
- put version-specific calls behind a small adapter;
- test `setViewport`, `syncViewport`, and callback signatures.

## High-risk correctness issues

### 6. Viewport culling conflicts with imperative pan rendering

The plan says that:

- pan/zoom writes the transform directly to the DOM;
- the Model is updated only at the end of the gesture;
- visible nodes are recomputed only on viewport commit.

See [the motion tiers](./PLAN.md#45-the-hot-path-and-the-performance-gate).

Nodes entering the viewport during a pan will remain culled until pointer
release. A user can pan over a blank canvas and see newly exposed nodes appear
only after the gesture ends.

**Suggested correction:** choose one of:

- update the culling window during pan, perhaps once per animation frame;
- retain an overscan region large enough for the expected pan distance;
- temporarily disable culling during viewport gestures; or
- maintain a separate imperative visibility layer.

The current “recompute only on commit” rule is not visually correct.

### 7. Selection cannot represent nodes and edges unambiguously

The Model uses:

```ts
selection: Schema.Array(Schema.String)
```

But `SelectedElements` and `DeletedElements` distinguish node IDs from edge
IDs. A single string array cannot distinguish a node and edge with the same ID,
nor can it represent the selection kind without consulting the parent graph.

**Suggested correction:** use a tagged selection item:

```ts
SelectionItem =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
```

Alternatively, store separate selected-node and selected-edge arrays.

### 8. Global document subscriptions are unsafe for embedded views

The subscription uses `document` directly in
[§4.4](./PLAN.md#44-subscriptions-gestures-that-span-elements).

This can behave incorrectly when:

- the flow is inside a ShadowRoot;
- multiple flows exist on one page;
- the flow is in an iframe;
- another pointer gesture is active;
- the pointer leaves the relevant browsing context.

XYFlow explicitly derives the relevant DOM host:

- [`getHostForElement`](https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/dom.ts)

**Suggested correction:** capture the pane's root/document from the mounted
element, scope subscriptions to that root, include `pointerId` in gesture state,
and ignore unrelated pointer events.

### 9. Keyboard handling can delete nodes while editing custom content

The keyboard subscription is keyed only by `hasSelection`. Custom nodes are
explicitly allowed to contain buttons and form controls, but Delete or Escape
inside an input, textarea, select, or contenteditable should not necessarily
operate on the graph.

XYFlow has an input-target guard:

- [`isInputDOMNode`](https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/dom.ts)

**Suggested correction:** define keyboard behavior for editable elements and add
tests for inputs, textareas, selects, and contenteditable content.

## Performance and planning issues

### 10. The memoization key is incomplete

The proposed key is:

```text
nodeId | position | selection | dragDelta
```

See [§4.5](./PLAN.md#45-the-hot-path-and-the-performance-gate).

It omits values that can change rendered output:

- `node.data`;
- `node.type`;
- `draggable`;
- `selectable`;
- measured size;
- visibility/culling state;
- renderer configuration;
- handle definitions;
- parent/layout information.

A node can therefore retain stale markup after its data changes.

**Suggested correction:** include all render-affecting inputs, use immutable
identity/version fields, or restrict memoization to the generated node shell.
Also, the Foldkit notes recommend profiling before adding `createKeyedLazy`;
making it mandatory in M1 before measuring it adds unnecessary risk.

### 11. The benchmark gate is not reproducible enough

“Parity with React Flow” and “same drag and pan frame distribution” are not
reproducible until the plan fixes:

- browser and OS;
- production versus development builds;
- exact React Flow and Svelte Flow versions;
- warm-up runs;
- fixture dimensions and node DOM complexity;
- sample count;
- throttling policy;
- whether the implementations run side-by-side or separately;
- statistical comparison method;
- treatment of startup, layout, and garbage-collection work.

The 10k requirement is intentionally non-numeric:

> “must stay interactive; no numeric promise until measured”

That is a research goal, not a release gate.

**Suggested correction:** define a benchmark protocol and numeric acceptance
criteria before making M1 depend on it. Keep exploratory 10k results separate
from merge-blocking criteria.

## Medium issues

### 12. Pointer gesture state is underspecified

The gesture messages do not contain:

- `pointerId`;
- pointer type;
- button;
- initial screen coordinates;
- pointer-capture or lost-capture handling;
- a `pointercancel` path.

See [the pointer messages](./PLAN.md#32-messages-and-outmessages).

This makes touch, stylus, multi-pointer input, and interrupted gestures
difficult to implement correctly. The plan claims pinch support in browser tests,
but the declared state machine is not sufficient to model pinch independently
from node dragging.

**Suggested correction:** add pointer identity and cancellation messages, and
decide whether pinch belongs entirely to `XYPanZoom` or to the Flow gesture
state machine.

### 13. Event propagation is not defined

The pane, node wrappers, and handles all receive pointer handlers. The plan does
not specify whether node and handle events stop propagation.

Without an explicit policy, a handle press may also trigger pane selection, node
selection, panning, or connection start.

**Suggested correction:** document propagation rules for pane, node, handle, and
nested interactive-control presses, then test each case.

### 14. The dependency research is already aging

The supporting notes are pinned to `foldkit@0.170.0` and
`@xyflow/system 0.0.84`; see [the XYFlow notes](./xyflow-internals.md) and
[the Foldkit notes](./foldkit-constraints.md).

That is acceptable for a spike, but the plan should state whether these are
exact implementation pins, research snapshots, or minimum supported versions.
Otherwise the implementation can silently drift from the documented API.

## Recommended changes before M0

Add a short “state and context contract” section answering:

1. How does `update` access current nodes and edges?
2. Where are measured handle bounds stored?
3. When are handle bounds invalidated?
4. How are node and edge selections represented?
5. How is the initial viewport passed into `XYPanZoom`?
6. How are newly visible nodes handled during pan?
7. What exact XYFlow version and adapter API are supported?
8. How are pointer cancellation, pointer identity, ShadowRoots, and editable
   controls handled?

Until these are resolved, the plan is directionally strong but not yet
implementable end-to-end.
