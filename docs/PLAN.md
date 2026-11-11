# Foldkit Flow — design plan

A flow/node-graph canvas for Foldkit, in the spirit of React Flow and Svelte Flow.

Status: **plan only**, nothing implemented. Repo is empty. Research notes in
[`xyflow-internals.md`](xyflow-internals.md) and
[`foldkit-constraints.md`](foldkit-constraints.md).

---

## TL;DR

Build on **`@xyflow/system`** (the framework-agnostic engine both wrappers share)
but do **not** wrap either wrapper's store. Write a Foldkit-native renderer and
keep the graph **controlled by the parent app**, exactly like React Flow's
controlled mode — except that changes come back as **typed Messages and
OutMessages** instead of a `NodeChange` union reduced by `applyNodeChanges`.

The flow itself is a **stateful Submodel with a narrow Model**: interaction state
only (viewport, pane rect and id, selection, gesture, measurements). Nodes, edges,
their positions and their data stay in the parent's Model and flow in through a
`renderer()`-style view helper, and `Flow.update` receives the graph as explicit
per-dispatch `context` (§2.5). Two Mounts own the imperative edges of the system:
`XYPanZoom` on the pane (which writes the transform to the DOM during a gesture and
reports the viewport per frame), and one per node for measurement. Gestures that
span elements are driven by pane-root Subscriptions, the same way `@foldkit/ui`'s
`DragAndDrop` does it.

This gives the XYFlow programming model (nodes/edges in, events out, custom node
renderers, handles, edge types) with Foldkit's guarantees (one Model, pure
update/view, every effect at a named seam, Story/Scene testability, DevTools time
travel).

**Decisions locked** (§9): package `@fllstck/foldkit-flow`; MIT with our own CSS and
visual identity (no upstream stylesheet, no attribution component); Foldkit-native
API only, no React-Flow-shaped interop; performance gate is parity with React Flow on
xyflow's own stress fixture (25×25 = 625 nodes), with the drag overlay, memoization,
and culling in the first iteration; **v0.1 = M0–M2**, **v1.0** adds sub-flows,
resizing, minimap, and edge types.

---

## 1. What the wrappers actually are, and where they break the Foldkit model

Both wrappers are **stateful components with their own store**:

- `@xyflow/react` keeps a zustand store; `StoreUpdater` copies `nodes`/`edges`
  props into it on every render; gestures emit `NodeChange`/`EdgeChange` objects
  that the consumer reduces with `applyNodeChanges`.
- `@xyflow/svelte` keeps a runes store and additionally declares
  `let { nodes = $bindable([]), edges = $bindable([]) } = $props()`, writing back
  into the binding.

Three things in there are incompatible with Foldkit:

| Wrapper behavior                                                                        | Why it can't come along                                                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A mutable store as the render source                                                    | Foldkit's Model is the single source of truth; a second store is the "two places hold the same state" anti-pattern                           |
| Mutating `nodeLookup`/`parentLookup` maps (`adoptUserNodes`, `updateAbsolutePositions`) | Foldkit freezes the Model and derives rather than caches; these mutate in place                                                              |
| A viewport that lives only in the store/DOM and never in the loop                       | Pan/zoom state must be observable to be testable, replayable, and restorable (§4.5 keeps the gesture imperative but commits it to the Model) |

What _does_ transfer, cleanly:

- All pure geometry: `getBezierPath` / `getSmoothStepPath` / `getStraightPath`,
  `getNodesBounds`, `getViewportForBounds`, `snapPosition`, `getPointerPosition`,
  `getConnectedEdges`, `getIncomers`/`getOutgoers`, `getNodeDimensions`.
- `XYPanZoom` — params are a flat record of primitives plus callbacks, no store.
- `XYResizer`, `XYMiniMap`-style modules, same shape.
- The **DOM contract** for handles (`.source` / `.target` class, `data-handleid`,
  `data-handlepos`) that `getHandleBounds` reads.

What is expensive to transfer: `XYDrag` and `XYHandle`, because both take
`getStoreItems()` — a getter returning `nodeLookup`, `edges`, `transform`,
`updateNodePositions`, `unselectNodesAndEdges`, `panBy`, `nodeOrigin`,
`snapGrid`, … To use them you would have to build a mutable store shim, i.e.
re-create the thing Foldkit removes. Plan: don't. Own dragging in `update`.

---

## 2. The design

### 2.1 Ownership split

```
parent Model (app)                         Flow.Model (submodel)
─────────────────                          ─────────────────────
nodes: [ { id, type, position, data } ]    pane: { width, height, left, top }
edges: [ { id, source, target, ... } ]     paneId: Option<string>
                                           viewport: { x, y, zoom }
                                           selectedNodeIds: [id] / selectedEdgeIds: [id]
                                           gesture: Idle | DraggingNodes | Selecting
                                                    | Connecting   (pan/zoom is not a gesture)
                                           nodeSizes: [ { nodeId, width, height } ]
                                           handleBounds: [ { nodeId, handleId, type, position, … } ]
```

Why graph data stays with the parent:

1. Foldkit's Model is a concrete `Schema.Struct`. A library generic over user node
   data cannot own it without a schema factory per consumer.
2. The docs are unambiguous: don't copy parent state into a child to render it.
   "Pass it through `viewInputs` instead" — or, for a renderer helper, pass it as
   an argument.
3. Positions are usually domain data (persisted layout, server sync). Duplicating
   them creates exactly the two-sources-of-truth bug the anti-patterns page calls
   out.

Why interaction state stays with the flow: nobody else needs `pane.left`, the
mid-drag origin, or the measured size of node 7, and keeping them local makes
Story tests trivial.

### 2.2 The three rejected alternatives

**A. Port `@xyflow/react` wholesale** (store, `StoreUpdater`, change unions).
Rejected: needs a mutable store inside a framework that freezes the Model and
routes every change through `update`. It would also smuggle in two-way binding.

**B. Vanilla-DOM the whole canvas in a Mount** (create the flow imperatively,
never render nodes with Foldkit). Rejected: node content must be Foldkit HTML
(custom nodes, form controls, submodels inside nodes). It would also make the
canvas invisible to Scene tests and DevTools.

**C. Let the flow submodel own nodes and edges.** Rejected for the reasons in
§2.1 — generic data vs Schema, plus duplicated positions. It is the obvious
design if you arrive from React Flow, so it is worth writing down as rejected.

### 2.3 Recovering what the wrappers give for free

| XYFlow feature                                                  | Foldkit replacement                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `StoreUpdater` (props → store)                                  | nothing: parent builds the view from its Model every frame                                                                                 |
| `NodeChange`/`EdgeChange` + `applyNodeChanges`                  | Messages (`MovedPointer`, `PressedDeleteKey`, …) reduced by `update`, which knows the graph                                                |
| `onNodesChange` per frame                                       | `MovedPointer` from a document-level Subscription while `gesture` is active; `update` computes new positions from `origin` + pointer delta |
| nodes get measured by `ResizeObserver` in `NodeWrapper`         | `Mount.defineStream` per node → `MeasuredNode({ nodeId, size })`                                                                           |
| handle bounds via `getHandleBounds` DOM query                   | same function, called in the node Mount after measurement, reported as a Message                                                           |
| transform written to DOM for speed                              | view renders `transform` from the Model; during a live pan/zoom gesture the adapter also writes it directly, then commits (see §4.5)       |
| `nodeTypes` map of components                                   | one `renderNode(node, tools)` callback; consumer switches on `node.type`                                                                   |
| `<Handle type position />`                                      | `tools.handle({ id, type, position })` returning `Html`                                                                                    |
| viewport imperatively controlled (`useReactFlow().setViewport`) | `Flow.setViewport(model, vp)` helper returning `{ model, commands: [SyncViewport(...)] }`                                                  |

### 2.4 Naming, licence, and visual identity

- Package: **`@fllstck/foldkit-flow`**. The namespace stays `Flow.*` (`Flow.Model`,
  `Flow.Message`, `Flow.createRenderer`, `Flow.subscriptions`), so it reads as a
  Foldkit
  library rather than a React Flow port.
- Licence: **MIT**. `@xyflow/system` (MIT) is a dependency; nothing is vendored.
- **No upstream stylesheet, no upstream visual identity.** CSS in
  `packages/flow/style` is written from scratch against our own class prefix
  (`fflow__`), and the chrome — background pattern, controls, minimap — is our own
  design. That is a design task in M3, not a copy job.
- The one thing kept from the wrappers is _functional_: handles render
  `.source` / `.target` plus `data-handleid` / `data-handlepos` (and nodes carry
  `data-id`), because `getHandleBounds` and the engine's connection math query those
  attributes. That is geometry plumbing, and it lives behind `classes.ts` so the
  contract has one home.
- No attribution component ships: we include none of xyflow's visual components,
  Pro code, or styles, so the only obligation is the MIT notice for the dependency.

### 2.5 State and context contract

A review of the first draft found the seam between "the parent owns the graph" and
"the flow owns interaction state" underspecified. This is that contract, and it is
answered before M0 rather than during it.

**1. How `update` sees the graph.** It does not store it; it receives it.

```ts
export type Context<NodeData = unknown, EdgeData = unknown> = Readonly<{
  nodes: ReadonlyArray<FlowNode<NodeData>>
  edges: ReadonlyArray<FlowEdge<EdgeData>>
  isValidConnection?: (connection: Connection) => boolean
}>

Flow.update(model, message, context): Update.ReturnWithOutMessage<Model, Message, OutMessage>
```

`Update.foldChild`'s `update` is `(childModel, input)` with no context slot, and
Foldkit's prescribed answer is to close over per-dispatch context, so the parent
builds the fold per dispatch:

```ts
const foldFlow = (context: Flow.Context) =>
  Update.foldChild({
    update: (flowModel, message) => Flow.update(flowModel, message, context),
    read: model => Option.some(model.flow),
    write: (model, flow) => modifyFields(model, { flow: () => flow }),
    toParentMessage: message => Message.GotFlowMessage({ message }),
    foldOutMessage: /* §3.5 */,
  })

GotFlowMessage: ({ message }) => foldFlow(contextFrom(model))(model, message)
```

Cost: one closure and one config object per dispatch. The context is derived from
the parent Model at dispatch time and never stored, so there is no second source of
truth and nothing to invalidate. Graph-dependent decisions stay with the owner of
the graph: the flow reports `DeletedElements` and `ConnectedHandles`, the parent
decides what they mean.

**2. Where measured handle geometry lives.** In the flow Model, as node-local
`HandleBounds` (§3.1): `{ nodeId, handleId, type, position, x, y, width, height }`.
They are the only input to handle hit-testing and edge endpoints, which is why
`Flow.hitTestHandle(model, point)` takes no graph argument.

**3. When handle bounds are invalidated — the mechanism, not the intention.**
Re-rendering a node does **not** re-run its Mount: "a reused node keeps its Mount
running", so "a new node object re-renders and re-measures" was a wish, not a
design. Two observers, both in the node Mount (§4.2):

- `ResizeObserver` on the node element catches size changes.
- A `MutationObserver` on the node's subtree — `{ childList: true, attributes: true,
subtree: true }`, **no `attributeFilter`** — catches handle structure and position
  changes that leave the node's own size intact, the case a `ResizeObserver` misses.
  `attributeFilter` takes exact names and has no wildcard syntax, so a list would be
  a maintenance trap (forget one `data-*` and measurement silently lags); the
  per-frame coalescer absorbs the extra notifications, so there is nothing to gain by
  filtering. Callbacks are coalesced to at most one measurement per animation frame.

A `data-handles` signature attribute was proposed in revision 3 and is **removed**.
It required collecting declarations while building the view, which is mutation during
view construction — and worse, a cached node subtree never re-invokes `renderNode`,
so the collection would have been wrong exactly when it mattered. Foldkit exposes no
public VNode traversal to derive the signature purely (`foldkit/html` exports
`createLazy`/`createKeyedLazy` and types only), and the observer already watches the
real handle DOM: handle elements carry `.source`/`.target` classes and
`data-handleid`/`data-handlepos`, so any structural change is a mutation the observer
sees. The signature bought nothing the DOM could not report.

Plus a freshness checkpoint: `StartedConnection` returns a `MeasureHandles` Command
that re-reads the visible nodes through the host registry before the gesture
begins, so hit-testing never runs on a mutated-but-unobserved subtree. It emits
`MergedHandleBounds`, which **merges per node** — each entry replaces only its own
node's slice — so measuring a subset can never erase the bounds of nodes it did not
measure. Nodes it was asked about but could not find (no live element) come back in
`missingNodeIds` and are pruned, rather than silently keeping stale geometry.

One case no observer covers: a **stylesheet-only** change (toggling a class on an
ancestor, a theme swap, a CSS-variable change) can move handles without mutating the
node's subtree or changing its size. Hit-testing is still safe, because every
connection gesture starts with the checkpoint above. Edge endpoints are not: they
can point at stale handle geometry until the next mutation, resize, or explicit
remeasure. So the library exports `Flow.remeasure(paneId, nodeIds)` — the same
`MeasureHandles` Command under a public name, so it inherits merge semantics — and the
docs state the rule plainly: **geometry-affecting CSS changes need an explicit
remeasure or an `inform*` call**. "All visible" is
`Flow.remeasure(paneId, Flow.visibleNodes(model, nodes).map(n => n.id))`; there is no
implicit "measure everything" overload, because the cost is one `getBoundingClientRect`
per node plus two `querySelectorAll` passes. Node removal is pruned by
`RemovedNodeMeasurement`, the `missingNodeIds` path, **and** the reconciliation seam
in §2.5.9.

This is a **public contract**, not an implementation note, so it ships in the package
docs as three sentences a consumer can act on:

1. While a node's DOM changes through the renderer (content, handles, styles it
   applies itself), geometry stays fresh automatically — `ResizeObserver` plus
   `MutationObserver` (§4.2).
2. If **external CSS** changes layout without producing either event (a class on an
   ancestor, a theme swap, a CSS-variable change), call `Flow.remeasure(paneId,
nodeIds)`.
3. Until you do, hit-testing is still correct (every connection starts with a
   checkpoint) but **edge endpoints may point at the old handle position**.

**4. Zoom does not invalidate handle bounds.** `getHandleBounds` divides offsets by
the current zoom, and `getDimensions` reads `offsetWidth`/`offsetHeight`, which CSS
transforms do not affect. Both inputs scale with zoom and the result is normalized,
so the stored value is node-local and scale-invariant. A Story test asserts this
rather than leaving it as folklore.

**5. Initial viewport.** A Mount arg: `MountPane({ paneId, viewport })` constructs
`XYPanZoom` with that viewport, so d3's internal transform and the Model agree from
the first wheel event. Args are captured at mount, which is exactly "initial"
semantics; later programmatic changes go through `SyncViewport` (§4.3).

**6. Visibility during a pan.** Culling is derived from the Model's `viewport`, and
the pane Mount emits a throttled `MovedViewport` per animation frame while the
gesture runs, so nodes entering the viewport appear during the pan. One screen of
overscan hides the seam. The transform is still written to the DOM imperatively
first, so motion never waits for a diff (§4.5).

**7. Pinned versions.** `@xyflow/system` is pinned exactly, and every engine call
goes through `src/runtime/adapter.ts` (`XYPanZoom`, path and bounds helpers,
`setViewport(viewport, options)`). The notes in `docs/` are research snapshots of
`foldkit@0.170.0` and `@xyflow/system@0.0.84`, not a compatibility promise.

**8. Pointer identity, cancellation, hosts, editable controls.**

- Gesture state carries `pointerId`, `pointerType`, `button`. Events from a
  different `pointerId` are ignored.
- `CancelledGesture` covers `pointercancel`, window `blur`, and Escape: it drops the
  drag overlay or connection and leaves selection alone.
- Subscription targets resolve the pane's root (`element.getRootNode()`) through the
  host registry, so ShadowRoot and iframe hosts work and two flows on one page never
  share a listener — equivalent to `getHostForElement` upstream.
- Pinch belongs entirely to `XYPanZoom` (d3-zoom). No gesture state models
  multi-touch.
- Delete and Escape are ignored while the event target is an input, textarea,
  select, contenteditable, or inside `.fflow__nokey` — the `isInputDOMNode` guard.

**9. Parent graph reconciliation.** `contextFrom(model)` gives `update` the current
graph while it handles a Flow Message. It does nothing when the graph changes for a
reason the flow never sees: undo, a server push, a bulk import, or the parent
handling `DeletedElements` by removing nodes.

Without a seam, `selectedNodeIds`, `nodeSizes`, and `handleBounds` keep dead ids, and
`Flow.hitTestHandle(model, point)` can return a handle for a node that no longer
exists. Two mechanisms, both cheap:

- `Flow.informGraphChanged(model, context)` returns `{ model }` with everything
  pruned to the ids present in `context`: selection, sizes, handle bounds, and a
  gesture whose nodes disappeared (its `delta` overlay refers to dead ids). The
  parent folds it from the same handler that mutated the graph — the
  _Informing Submodels_ pattern, not a stored copy.
- Gesture-initiating Messages (`PressedNode`, `StartedConnection`,
  `PressedDeleteKey`) verify the id exists in `context` and are ignored when it does
  not. This is O(N) once per user action, never per frame, and it is the guard that
  keeps a mid-gesture graph change from producing an OutMessage about a dead node.

`hitTestHandle` stays Model-only because it only runs inside an active connection
gesture, which begins with the `MeasureHandles` checkpoint in §2.5.3.

---

## 3. Public API sketch

Sketches below target the real `foldkit@0.170.0` API (`defineMessageUnion`,
`Schema.Struct`, `defineTaggedUnion`, `Command.define`, `Mount.defineStream`,
`Subscription.make`, `HtmlBuilder`). They are not yet compiled.

### 3.1 Model

```ts
// packages/flow/src/model.ts
import { Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number });
export type Point = typeof Point.Type;

export const Rect = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  left: Schema.Number,
  top: Schema.Number,
});
export type Rect = typeof Rect.Type;

export const Size = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
});
export type Size = typeof Size.Type;

export const Viewport = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  zoom: Schema.Number,
});
export type Viewport = typeof Viewport.Type;

export const HandleRef = Schema.Struct({
  nodeId: Schema.String,
  handleId: Schema.Option(Schema.String),
  type: Schema.Literals(["Source", "Target"]),
});
export type HandleRef = typeof HandleRef.Type;

export const NodeSize = Schema.Struct({
  nodeId: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
});

export const HandlePosition = Schema.Literals([
  "Top",
  "Right",
  "Bottom",
  "Left",
]);

/** Node-local, zoom-normalized handle geometry: measured once per handle change,
 *  hit-tested and used for edge endpoints without touching the DOM (§2.5, §4.2). */
export const HandleBounds = Schema.Struct({
  nodeId: Schema.String,
  handleId: Schema.Option(Schema.String),
  type: Schema.Literals(["Source", "Target"]),
  position: HandlePosition,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type HandleBounds = typeof HandleBounds.Type;

/** Identity of the pointer that owns the current gesture. Events carrying a
 *  different `pointerId` are ignored (§2.5.8). */
export const Pointer = Schema.Struct({
  pointerId: Schema.Number,
  pointerType: Schema.String,
  button: Schema.Number,
});
export type Pointer = typeof Pointer.Type;

export const Gesture = defineTaggedUnion({
  Idle: {},
  // No `Panning` variant: pan and zoom (including pinch) are owned by XYPanZoom,
  // which uses d3-zoom, so they never enter Flow's gesture state machine.
  DraggingNodes: {
    pointer: Pointer,
    nodeIds: Schema.Array(Schema.String),
    origin: Point, // flow-space position where the press happened
    delta: Point, // live offset, applied on top of the parent-owned positions
    hasMoved: Schema.Boolean,
  },
  Selecting: { pointer: Pointer, origin: Point, current: Point },
  Connecting: {
    pointer: Pointer,
    from: HandleRef,
    current: Point,
    maybeTarget: Schema.Option(HandleRef),
  },
});

export const Model = Schema.Struct({
  pane: Rect,
  // Identity of the mounted pane, set on `MountedPane`: subscriptions resolve the
  // pane's DOM root from it instead of hardcoding `document` (§2.5.8).
  paneId: Schema.Option(Schema.String),
  viewport: Viewport,
  // Nodes and edges stay separate: one string array cannot say which kind an id
  // is, and `SelectedElements` / `DeletedElements` need that distinction.
  selectedNodeIds: Schema.Array(Schema.String),
  selectedEdgeIds: Schema.Array(Schema.String),
  nodeSizes: Schema.Array(NodeSize),
  handleBounds: Schema.Array(HandleBounds),
  gesture: Gesture,
});

export type Model = typeof Model.Type;

export const init = (maybeViewport?: Viewport) => ({
  model: {
    pane: { width: 0, height: 0, left: 0, top: 0 },
    paneId: Option.none(),
    viewport: maybeViewport ?? { x: 0, y: 0, zoom: 1 },
    selectedNodeIds: [],
    selectedEdgeIds: [],
    nodeSizes: [],
    handleBounds: [],
    gesture: Gesture.Idle(),
  },
});
```

### 3.2 Messages and OutMessages

Names are verb-first facts. OutMessages are what the parent must act on.

```ts
// packages/flow/src/message.ts
export const Message = defineMessageUnion({
  // element lifecycle
  MountedPane: { paneId: Schema.String },
  FailedMountPane: { reason: Schema.String },
  ResizedPane: { pane: Rect },

  // measurement
  MeasuredNode: { nodeId: Schema.String, size: Size },
  MeasuredHandles: {
    nodeId: Schema.String,
    handles: Schema.Array(HandleBounds),
  },
  // batch from the `MeasureHandles` checkpoint (§2.5.3). Merges per node:
  // entries replace only their own node's slice, so a partial sweep can never
  // erase measurements for nodes it did not measure.
  MergedHandleBounds: {
    entries: Schema.Array(
      Schema.Struct({
        nodeId: Schema.String,
        handles: Schema.Array(HandleBounds),
      }),
    ),
    // requested but no live element: their slices are pruned rather than
    // silently kept (a node with no element has no handles to hit)
    missingNodeIds: Schema.Array(Schema.String),
  },
  RemovedNodeMeasurement: { nodeId: Schema.String },
  FailedMeasureHandles: { reason: Schema.String },

  // pointer gestures (all carry the owning pointer; §2.5.8)
  PressedPane: { point: Point, isAdditive: Schema.Boolean, pointer: Pointer },
  PressedNode: {
    nodeId: Schema.String,
    point: Point,
    isAdditive: Schema.Boolean,
    pointer: Pointer,
  },
  MovedPointer: {
    screenX: Schema.Number,
    screenY: Schema.Number,
    pointerId: Schema.Number,
  },
  ReleasedPointer: { pointerId: Schema.Number },
  CancelledGesture: {
    reason: Schema.Literals(["PointerCancel", "WindowBlur", "Escape"]),
  },
  ScrolledPane: { deltaX: Schema.Number, deltaY: Schema.Number },
  PressedDeleteKey: {},
  PressedEscape: {},

  // connections
  StartedConnection: { from: HandleRef, pointer: Pointer },
  HoveredHandle: { handle: Schema.Option(HandleRef) },

  // viewport: one Message shape for the throttled frames and the commit, so the
  // subscriber sees a single transition and `ChangedViewport` fires once (§4.5)
  MovedViewport: { viewport: Viewport, isGestureEnd: Schema.Boolean },
  CompletedSyncViewport: {},
  FailedSyncViewport: { reason: Schema.String },
});

// packages/flow/src/outMessage.ts
export const OutMessage = defineMessageUnion({
  MovedNodes: {
    nodes: Schema.Array(
      Schema.Struct({
        nodeId: Schema.String,
        x: Schema.Number,
        y: Schema.Number,
      }),
    ),
  },
  SelectedElements: {
    nodeIds: Schema.Array(Schema.String),
    edgeIds: Schema.Array(Schema.String),
  },
  ConnectedHandles: {
    source: HandleRef,
    target: HandleRef,
  },
  DeletedElements: {
    nodeIds: Schema.Array(Schema.String),
    edgeIds: Schema.Array(Schema.String),
  },
  ChangedViewport: { viewport: Viewport },
});
```

`update` returns `{ model, commands?, outMessage? }` — the standard `Update.Return`
shape. Four transitions worth naming, because they are where the Model and the
OutMessages are decided:

- `MountedPane` sets `model.paneId`, which is what the subscriptions resolve their
  target from.
- `MovedViewport({ isGestureEnd: false })` writes `model.viewport` only, so culling
  follows the pan. `isGestureEnd: true` writes it and emits `ChangedViewport`, so
  the parent persists one value per gesture.
- `ReleasedPointer` on a `DraggingNodes` gesture emits **one** `MovedNodes` carrying
  the committed positions (`node.position + delta`) and clears the overlay;
  `CancelledGesture` clears the overlay without emitting anything.
- `MeasuredHandles` replaces that node's entries in `model.handleBounds`;
  `MergedHandleBounds` merges per node (the connection-gesture checkpoint) and
  prunes `missingNodeIds`; `RemovedNodeMeasurement` drops one node's entries.

### 3.3 The view helper

```ts
// packages/flow/src/view/view.ts
export type FlowNode<Data = unknown> = Readonly<{
  id: string
  type?: string
  position: Point
  data: Data
  /** Optional size hint; used for edge paths and fitView before measurement. */
  size?: { width: number; height: number }
  draggable?: boolean
  selectable?: boolean
  parentId?: string
}>

export type FlowEdge<Data = unknown> = Readonly<{
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: 'Bezier' | 'Straight' | 'Step' | 'SmoothStep'
  label?: string
  data?: Data
}>

export type NodeTools = Readonly<{
  handle: (spec: HandleSpec) => Html
  isSelected: boolean
  isDragging: boolean
}>

export type RendererConfig<NodeData, EdgeData> = Readonly<{
  /** Stable across renders: this function reference is part of each node's
   *  memoization identity (§4.5), so it must not be rebuilt per render. The
   *  builder arrives per call — the parent's builder, threaded through — so the
   *  renderer can exist at module scope without storing one. */
  renderNode: (
    node: FlowNode<NodeData>,
    tools: NodeTools,
    h: HtmlBuilder<any>,
  ) => Html
  renderEdgeLabel?: (edge: FlowEdge<EdgeData>, h: HtmlBuilder<any>) => Html
  paneId: string // host-registry key, see §2.5
  minZoom?: number
  maxZoom?: number
}>

export type ViewInput<ParentMessage, NodeData, EdgeData> = Readonly<{
  model: Model
  nodes: ReadonlyArray<FlowNode<NodeData>>
  edges: ReadonlyArray<FlowEdge<EdgeData>>
  toParentMessage: (message: Message) => ParentMessage
}>

export const createRenderer = <NodeData = unknown, EdgeData = unknown>(
  config: RendererConfig<NodeData, EdgeData>,
): Renderer<NodeData, EdgeData>

export type Renderer<NodeData, EdgeData> = Readonly<{
  view: <ParentMessage>(
    input: ViewInput<ParentMessage, NodeData, EdgeData>,
    h: HtmlBuilder<ParentMessage>,
  ) => Html
  /** Drops every cached VNode and returns the renderer to its initial state. Safe to
   *  call on route unmount, and safe to keep rendering afterwards (the cache
   *  repopulates). A live renderer is not required to call it: the per-render sweep
   *  already bounds the cache to the current graph. */
  dispose: () => void
}>
```

`renderer.view` is a **render helper, not `h.submodel`**, deliberately: the
callbacks run in the parent's boundary, so a button inside a custom node
dispatches a parent Message with no wrapper, and nested renderers work. That is
the shape the docs prescribe for "shared renderers" and the shape `Button.view`,
`DragAndDrop.draggable`, and `SnippetCopy.renderer` use. The state/update
boundary is still the submodel's (`Update.foldChild`).

**The instance owns the node cache, and that is why it exists.** `createRenderer`
returns a closure holding one `createLazy()` slot per node id. Three consequences,
all explicit:

- Create it **once** at module or app scope and call `renderer.view(...)` from the
  parent's view. Calling `createRenderer()` inside a view function recreates the
  cache every render: the output stays correct and memoization silently stops
  working.
- Two flow instances mean two renderers (or two `paneId`s). There is no module-level
  cache, so instances cannot share slots or leak into each other.
- Cache invalidation is delegated to the slot, which compares the function
  reference, dispatcher, Mount render owner, and arguments. A new `renderNode` or a
  new dispatcher invalidates on its own; the renderer only sweeps ids absent from
  the render pass (§4.5). That is why `renderNode` lives in `RendererConfig` — stable
  by construction — while `nodes`, `edges`, `model`, and `toParentMessage` arrive per
  render in `ViewInput`.

Full DOM produced:

```
div.foldkit-flow__pane        [OnWheel, OnPointerDown → PressedPane, OnMount(MountPane)]
  div.foldkit-flow__viewport  [style transform from model.viewport]
    svg.foldkit-flow__edges   [one <g> per edge, keyed by edge id, path from geometry]
    div.foldkit-flow__nodes   [one div per node, keyed, style translate(position), OnPointerDown]
      renderNode(node, tools) [consumer markup, tools.handle() for handles]
    svg.foldkit-flow__selection  [selection box, only while Selecting]
    svg.foldkit-flow__connection [connection line, only while Connecting]
  div.foldkit-flow__controls  [optional ZoomIn / ZoomOut / FitView buttons]
  div.foldkit-flow__minimap   [optional]
```

Handles render with the exact contract the engine's geometry needs:

```ts
h.div(
  [
    h.Class(`foldkit-flow__handle ${type === 'Source' ? 'source' : 'target'}`),
    h.DataAttribute('handleid', spec.id ?? ''),
    h.DataAttribute('handlepos', spec.position),
    h.DataAttribute('nodeid', nodeId),
    h.OnPointerDown(...),
  ],
  [],
)
```

### 3.4 Pure helpers the consumer calls from `update`

```ts
// geometry, all pure, all Model-first
Flow.screenToFlow(model, { screenX, screenY }): Point // model.pane + model.viewport
Flow.flowToScreen(model, point): Point
Flow.dragDelta(model): Point // the live overlay delta
Flow.visibleNodes(model, nodes): ReadonlyArray<FlowNode> // culling + overscan
Flow.visibleEdges(model, edges, nodes): ReadonlyArray<FlowEdge>
Flow.nodeBounds(model, nodes): Rect
Flow.fitViewport(model, nodes, padding?): Viewport // wraps getViewportForBounds
Flow.hitTestHandle(model, point): Option<HandleRef> // model.handleBounds; no nodes arg
Flow.isDeleteKeyAllowed(event): boolean // the isInputDOMNode guard (§2.5.8)

// child entry points (the "helpers the parent folds" pattern from the docs)
Flow.setViewport(model, viewport): { model: Model; commands: [SyncViewport] }
Flow.zoomBy(model, factor): { model: Model; commands: [SyncViewport] }
Flow.selectAll(model, context): { model: Model; outMessage: SelectedElements }
Flow.clearSelection(model): { model: Model; outMessage: SelectedElements }

// reconciliation seam (§2.5.9): prune everything that refers to ids the parent
// no longer owns. Folds from the handler that mutated the graph.
Flow.informGraphChanged(model, context): { model: Model }
```

Helpers that need the graph take it explicitly through `context` (§2.5.1), never
through a stored copy. Helpers that need only interaction state take the Model
alone — which is the test for whether something belongs in `Flow.Model`.

### 3.5 Wiring in a consumer app

```ts
// app model
export const Model = Schema.Struct({
  graph: Schema.Struct({
    nodes: Schema.Array(GraphNode),
    edges: Schema.Array(GraphEdge),
  }),
  flow: Flow.Model,
});

// app message
export const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
  MovedNodes: { nodes: Schema.Array(NodePosition) },
  ConnectedHandles: { source: Flow.HandleRef, target: Flow.HandleRef },
  DeletedElements: {
    nodeIds: Schema.Array(Schema.String),
    edgeIds: Schema.Array(Schema.String),
  },
  ChangedViewport: { viewport: Flow.Viewport },
});

const contextFrom = (model: Model): Flow.Context => ({
  nodes: model.graph.nodes,
  edges: model.graph.edges,
  isValidConnection: (connection) => !wouldCreateCycle(model.graph, connection),
});

// Any parent-side change that can remove ids is reconciled in the same step, so the
// Flow Model never keeps selection, sizes, or bounds for nodes the graph dropped
// (§2.5.9). Undo, import, and server-push handlers use the same helper.
const withGraphChanged = (model: Model, mutate: (m: Model) => Model): Model => {
  const next = mutate(model);
  const reconciled = Flow.informGraphChanged(
    next.flow,
    contextFrom(next),
  ).model;
  return modifyFields(next, { flow: () => reconciled });
};

// The fold is rebuilt per dispatch so `Flow.update` sees the current graph without
// the flow storing a copy of it (§2.5.1). `foldOutMessage` returns an update Step,
// so the parent decides the consequence of each fact the flow reports.
const foldFlow = (context: Flow.Context) =>
  Update.foldChild({
    update: (flowModel, message) => Flow.update(flowModel, message, context),
    read: (model: Model) => Option.some(model.flow),
    write: (model, flow) => modifyFields(model, { flow: () => flow }),
    toParentMessage: (message) => Message.GotFlowMessage({ message }),
    foldOutMessage: (outMessage) =>
      Flow.OutMessage.match({
        MovedNodes:
          ({ nodes }) =>
          (model) => ({ model: applyPositions(model, nodes) }),
        ConnectedHandles:
          ({ source, target }) =>
          (model) => ({
            model: addEdge(model, source, target),
          }),
        DeletedElements:
          ({ nodeIds, edgeIds }) =>
          (model) => ({
            model: withGraphChanged(model, (m) =>
              deleteElements(m, nodeIds, edgeIds),
            ),
          }),
        SelectedElements: () => (model) => ({ model }),
        ChangedViewport:
          ({ viewport }) =>
          (model) => ({
            model: persistViewport(model, viewport),
          }),
      })(outMessage),
  });

Message.match<Update.Return<Model, Message>>(message, {
  GotFlowMessage: ({ message }) => foldFlow(contextFrom(model))(model, message),
  // …
});

// app view — the renderer is created once at module scope, because it owns the node
// cache (§3.3). `h` is threaded into `renderNode` per call, so nothing here stores a
// builder.
const flowRenderer = Flow.createRenderer({
  paneId: "main-flow",
  renderNode: (node, tools, h) =>
    h.div(
      [h.Class("node-shell")],
      [
        h.span([h.Class("node-title")], [node.data.label]),
        h.button(
          [h.OnClick(Message.ClickedResetNode({ nodeId: node.id }))],
          ["Reset"],
        ),
        tools.handle({ id: "out", type: "Source", position: "Right" }),
      ],
    ),
});

// …and called from the parent's view with the per-render data.
flowRenderer.view(
  {
    model: model.flow,
    nodes: model.graph.nodes,
    edges: model.graph.edges,
    toParentMessage: (message) => Message.GotFlowMessage({ message }),
  },
  h,
);
```

---

## 4. Runtime internals

### 4.1 Mount: pan/zoom owns its gesture, the Model owns the committed viewport

```ts
// packages/flow/src/runtime/mountPane.ts
const MountPane = Mount.defineStream("MountPane", {
  // The initial viewport is an arg: args are captured at mount, which is exactly
  // "initial" semantics, and d3-zoom starts in agreement with the Model (§2.5.5).
  args: { paneId: Schema.String, viewport: Viewport },
  messages: [
    Message.MountedPane,
    Message.FailedMountPane,
    Message.MovedViewport,
    Message.ResizedPane,
  ],
  execute: ({ element, paneId, viewport, viewStateChanges }) =>
    Stream.callback((queue) =>
      Effect.gen(function* () {
        // Mount-scoped adapter state: while DevTools shows a historical view, the
        // adapter stops writing the transform and stops emitting viewport Messages.
        // The signal is not translated into application state (Mount docs).
        let isLive = true;

        // Mount-scoped throttle. Not a general utility — it exists so the terminal
        // Message can be ordered against the streamed ones, and so no timer outlives
        // the element (cancelled in the release below).
        const viewportThrottle = makeViewportThrottle((next) =>
          Queue.offerUnsafe(
            queue,
            Message.MovedViewport({ viewport: next, isGestureEnd: false }),
          ),
        );

        const panZoom = yield* Effect.acquireRelease(
          Effect.sync(() =>
            XYPanZoom({
              domNode: element,
              minZoom: 0.1,
              maxZoom: 2,
              viewport,
              translateExtent: infiniteExtent,
              // DOM first: motion never waits for a diff. The Message is throttled
              // to one per frame so culling and the Model stay current (§4.5).
              onPanZoom: (_event, next) => {
                if (!isLive) return;
                writeTransform(paneId, next);
                viewportThrottle.offer(next);
              },
              // `OnPanZoom = (event, viewport) => void` for all three callbacks; the
              // event is first. Dropping it here would type the viewport as an event.
              // Cancel before the final write: a pending non-terminal frame must not be
              // able to land after (or instead of) the commit.
              onPanZoomEnd: (_event, next) => {
                if (!isLive) return;
                viewportThrottle.cancel();
                writeTransform(paneId, next);
                Queue.offerUnsafe(
                  queue,
                  Message.MovedViewport({ viewport: next, isGestureEnd: true }),
                );
              },
              onDraggingChange: () => {},
            }),
          ),
          (instance) =>
            Effect.sync(() => {
              viewportThrottle.cancel();
              releasePane(paneId, instance);
            }),
        );
        // The host record carries everything other parts need: the instance for
        // Commands, the root for subscriptions, the element for measurement (§4.3).
        registerPane({
          paneId,
          element,
          root: element.getRootNode() as Document | ShadowRoot,
          panZoom,
        });
        Queue.offerUnsafe(queue, Message.MountedPane({ paneId }));

        // Drive the `isLive` flag from the view-state Stream. Time travel pauses the
        // rendered view, not the application, so this affects adapter behaviour only.
        yield* viewStateChanges.pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              isLive = state === "Live";
            }),
          ),
          Effect.forkScoped,
        );

        // ResizeObserver → ResizedPane
        yield* observePane(element, queue);
        return yield* Effect.never;
      }),
    ),
});
```

Three rules from the Mount docs are load-bearing here:

- **The initial viewport arrives as an arg.** Args are captured at mount, so
  `MountPane({ paneId, viewport })` constructs `XYPanZoom` with the Model's
  viewport, and d3-zoom's internal transform agrees with the Model from the first
  wheel event. Later programmatic changes go through `SyncViewport` (§4.3). There is
  no "seed it afterwards" path and no ordering question.
- **The gesture streams, the commit is one Message.** `onPanZoom` writes the
  transform and emits a throttled `MovedViewport({ isGestureEnd: false })` per frame
  so culling and the committed viewport stay current while panning; `onPanZoomEnd`
  emits the final `isGestureEnd: true`, which is the only frame that produces the
  `ChangedViewport` OutMessage. Ordering is guaranteed by **cancel-then-final**: the
  throttler keeps the latest viewport in a Mount-scoped cell, and `onPanZoomEnd`
  cancels any pending frame, writes that final value, then queues
  `isGestureEnd: true`. A late non-terminal frame therefore cannot overwrite the
  commit. The ordering is asserted directly against `makeViewportThrottle` with a fake
  rAF (`offer` twice → one emit; `offer` then `cancel` → no emit), and the Story test
  covers the Message-level consequence. The timer is cancelled on release too, so it
  cannot outlive the element.
- **Mounts re-run under DevTools time travel.** Constructing a pan/zoom on a fresh
  element and destroying it is idempotent and DOM-local; `viewStateChanges` keeps the
  paused view read-only and stops DOM-derived Messages while `Paused`.

The throttle itself is small and worth pinning down, because it carries the ordering
guarantee:

```ts
// packages/flow/src/runtime/viewportThrottle.ts
export type ViewportThrottle = Readonly<{
  offer: (viewport: Viewport) => void;
  cancel: () => void;
}>;

/** Coalesces viewport reports to one per animation frame. `cancel` drops the pending
 *  frame *and* the pending value, so a terminal Message can never be overtaken. */
export const makeViewportThrottle = (
  emit: (viewport: Viewport) => void,
): ViewportThrottle => {
  let pending: Viewport | undefined;
  let frame: number | undefined;

  const flush = () => {
    frame = undefined;
    if (pending === undefined) return;
    const next = pending;
    pending = undefined;
    emit(next);
  };

  return {
    offer: (viewport) => {
      pending = viewport;
      if (frame === undefined) frame = requestAnimationFrame(flush);
    },
    cancel: () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      pending = undefined;
    },
  };
};
```

`pending` and `frame` are the only mutable cells in the integration, they live and die
with the Mount, and `cancel` runs in both the terminal callback and the release — so a
late `requestAnimationFrame` cannot emit a viewport for an element that is gone.

### 4.2 Mount per node: measurement and handle bounds

One `Mount.defineStream('MountNode', { args: { nodeId } })` per node element,
keyed by `node.id` so the DOM node — and its Mount — follow the entity:

- `ResizeObserver` → `MeasuredNode({ nodeId, size })` (only when the size actually
  changes; the differ reuses the element, so the Mount does not restart).
- After each measurement, `getHandleBounds('source' | 'target', nodeElement, rect,
zoom, nodeId)` for both types → one `MeasuredHandles({ nodeId, handles })`. The
  returned `x`/`y` are divided by zoom and `width`/`height` come from
  `offsetWidth`/`offsetHeight`, so the values are node-local and need no re-measure
  on zoom (§2.5.4).
- Invalidation is explicit (§2.5.3), and the Mount is **not** restarted: a new node
  object makes the differ patch the existing element, and the `MutationObserver` on
  that element's subtree — not the Mount — sees the structural or attribute change
  and schedules one measurement per animation frame. The Mount re-runs only if the
  element itself is replaced (tag or identity change), which is exactly when the
  observer would be torn down and re-created. Node removal queues
  `RemovedNodeMeasurement` from the release, so `handleBounds` never keeps dead ids.
- One Mount per element: measurement and handle bounds live in the same Mount; the
  docs warn that a second `h.OnMount` on the same element silently replaces the
  first.

Because measurement is DOM truth, it can never come from `view`. It cannot come
from a Command either: the cause is "this element exists", not "update just
handled a message".

### 4.3 Host registry: live handles out of the frozen Model

```ts
// packages/flow/src/runtime/host.ts
// One record per mounted pane. The root travels with the pan/zoom instance because
// subscriptions need it (ShadowRoot, iframe, two flows on a page) and Commands need
// the element for measurement — see §4.4 and §2.5.8.
type PaneHost = Readonly<{
  paneId: string;
  element: HTMLElement;
  root: Document | ShadowRoot;
  panZoom: PanZoomInstance;
  // No `viewport` field: the Model owns the viewport, and `MountPane` receives it as
  // an arg at construction. A third copy in the registry was a second source of truth
  // that nothing kept honest (revision 6 removed it).
}>;

const paneHosts = new Map<string, PaneHost>();

// `root` is captured from the element at mount: `element.getRootNode()` is what
// `getHostForElement` uses upstream.
export const registerPane = (host: PaneHost) => {
  paneHosts.set(host.paneId, host);
};

export const getPane = (paneId: string): Option<PaneHost> =>
  Option.fromNullishOr(paneHosts.get(paneId));

export const getPaneRoot = (paneId: string): Option<Document | ShadowRoot> =>
  Option.map(getPane(paneId), (host) => host.root);

export const getPaneElement = (paneId: string): Option<HTMLElement> =>
  Option.map(getPane(paneId), (host) => host.element);

// Identity-safe release: a remount under the same paneId must not be deleted by the
// old mount's finalizer.
export const releasePane = (paneId: string, panZoom: PanZoomInstance) => {
  panZoom.destroy();
  const host = paneHosts.get(paneId);
  if (host !== undefined && host.panZoom === panZoom) paneHosts.delete(paneId);
};
```

This is `examples/map/src/mapHost.ts`'s pattern — the Model carries the id, the
module carries the instance, Commands cross by id and return `Failed*` when it is
missing — widened to a record because three different consumers need three different
things from the same mount: Commands need `panZoom` and `element`, subscriptions need
`root`. Three consumers, three fields, one authority each: the Model owns the
viewport, the Mount owns construction, the registry owns the live handles.

Reuse rules, stated once: `registerPane` overwrites a record with the same id (a
remount wins) and `releasePane` deletes only when the instance matches, so an old
finalizer cannot erase a new mount.

**Where the root comes from.** `element.getRootNode()` at mount, which is exactly what
`getHostForElement` does upstream and is correct for a ShadowRoot host and for an
iframe (a same-origin iframe's root is its own `Document`).

```ts
export const SyncViewport = Command.define("SyncViewport", {
  args: {
    paneId: Schema.String,
    viewport: Viewport,
    duration: Schema.Option(Schema.Number),
  },
  messages: [Message.CompletedSyncViewport, Message.FailedSyncViewport],
  execute: ({ paneId, viewport, duration }) =>
    Option.match(getPane(paneId), {
      onNone: () =>
        Effect.succeed(
          Message.FailedSyncViewport({ reason: "pane not mounted" }),
        ),
      onSome: (host) =>
        Effect.promise(() =>
          // `PanZoomTransformOptions`, not a bare number: { duration?, ease?,
          // interpolate? }. `syncViewport(viewport)` takes no options at all.
          host.panZoom.setViewport(viewport, {
            duration: Option.getOrUndefined(duration),
          }),
        ).pipe(Effect.as(Message.CompletedSyncViewport())),
    }),
});

// Freshness checkpoint for handle geometry (§2.5.3): re-read the visible nodes
// through the host registry right before a connection gesture begins, so
// hit-testing never runs on a subtree that changed without an observer firing.
// Merge semantics, not replace: measuring three nodes must not erase the bounds
// of the other thirty (§2.5.3, revision 4).
export const MeasureHandles = Command.define("MeasureHandles", {
  args: { paneId: Schema.String, nodeIds: Schema.Array(Schema.String) },
  messages: [Message.MergedHandleBounds, Message.FailedMeasureHandles],
  execute: ({ paneId, nodeIds }) =>
    Option.match(getPane(paneId), {
      onNone: () =>
        Effect.succeed(
          Message.FailedMeasureHandles({ reason: "pane not mounted" }),
        ),
      onSome: () =>
        Effect.sync(() => {
          const measured = nodeIds.map((nodeId) => ({
            nodeId,
            maybeHandles: readHandleBounds(paneId, nodeId),
          }));

          return Message.MergedHandleBounds({
            entries: measured.flatMap(({ nodeId, maybeHandles }) =>
              Option.match(maybeHandles, {
                onNone: () => [],
                onSome: (handles) => [{ nodeId, handles }],
              }),
            ),
            missingNodeIds: measured.flatMap(({ nodeId, maybeHandles }) =>
              Option.isNone(maybeHandles) ? [nodeId] : [],
            ),
          });
        }),
    }),
});

// Explicit remeasure, for the case no observer sees: a stylesheet-only change that
// moves handles without resizing the node (§2.5.3). Returns the same
// MergedHandleBounds, so it can never erase bounds it did not measure.
export const Remeasure = (paneId: string, nodeIds: ReadonlyArray<string>) =>
  MeasureHandles({ paneId, nodeIds });
```

### 4.4 Subscriptions: gestures that span elements

`@foldkit/ui`'s `DragAndDrop` is the precedent — its pointer tracking is a
document-level Subscription, not a per-element handler.

```ts
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  pointerMove: entry(
    {
      paneId: Schema.Option(Schema.String),
      pointerId: Schema.Option(Schema.Number),
    },
    {
      modelToDependencies: (model) => ({
        paneId: model.paneId,
        pointerId: Option.map(
          gesturePointer(model.gesture),
          (p) => p.pointerId,
        ),
      }),
      dependenciesToStream: ({ paneId, pointerId }) =>
        Option.match(Option.product(paneId, pointerId), {
          // No gesture, or no mounted host: no listener at all.
          onNone: () => Stream.empty,
          onSome: ([hostId, ownerPointerId]) =>
            Option.match(getPaneRoot(hostId), {
              // A missing host yields an empty stream. It never falls back to
              // `document`: that would resurrect the cross-instance leak and the
              // ShadowRoot/iframe bypass that `PaneHost` exists to prevent, and would
              // keep a removed flow listening. `target` is resolved when the scope
              // opens, so a remount under the same id still attaches to the new root.
              onNone: () => Stream.empty,
              onSome: (root) =>
                Dom.streamFromEventFilterMap({
                  target: root,
                  type: "pointermove",
                  filterMapEvent: (event) =>
                    event.pointerId === ownerPointerId
                      ? Option.some(
                          Message.MovedPointer({
                            screenX: event.clientX,
                            screenY: event.clientY,
                            pointerId: event.pointerId,
                          }),
                        )
                      : Option.none(),
                }),
            }),
        }),
    },
  ),
  pointerEnd: entry(
    {
      paneId: Schema.Option(Schema.String),
      pointerId: Schema.Option(Schema.Number),
    },
    {
      // pointerup and pointercancel on the same root, filtered by the same
      // pointerId → ReleasedPointer / CancelledGesture
    },
  ),
  keyboard: entry(
    { paneId: Schema.Option(Schema.String), hasSelection: Schema.Boolean },
    {
      // keydown on the pane root → PressedDeleteKey | PressedEscape, filtered by
      // Flow.isDeleteKeyAllowed(event): inputs, textareas, selects,
      // contenteditable and `.fflow__nokey` targets never reach the graph
    },
  ),
}));
```

The dependency record is deliberately narrow. `pointerId` is an `Option`, so the
stream shuts down when no gesture is active and restarts on the next press — and,
crucially, it stays alive for the whole gesture instead of restarting on every
`MovedPointer`. `paneId` is in the Model (set by `MountedPane`) so a subscription
can resolve the pane's root without touching the DOM tree, mirroring the
`maybeHostId` pattern from `examples/map`. Screen coordinates come out of the
subscription; conversion to flow space uses `Flow.screenToFlow(model, …)` in
`update`, which is why `pane` (the rect) also lives in the Model.

Browsers already coalesce `pointermove` to the display rate, so one Message per
event is one per frame. If profiling finds a browser delivering several per frame,
the entry moves to a `keepAliveEquivalence` stream fed by
`Subscription.animationFrameEntry` reading the latest pointer — the same escape
hatch `DragAndDrop.autoScroll` uses — without changing the Message shape.

`Subscription.lift(Flow.subscriptions)<AppModel, AppMessage>({ read, toParentMessage })`
composes it into the app. `ManagedResource.lift(Flow.managedResources)` is the
matching seam if a handle ever needs to outlive a single element; nothing in this
design does today — a Mount is enough.

### 4.5 The hot path and the performance gate

The target is parity with React Flow on xyflow's own published stress fixture.
The repo's `examples/react/src/examples/Stress` renders 25×25 = 625 nodes and
~624 edges, and records per-frame durations during a 20-step node drag; the docs
site version defaults to 10×10. Neither wrapper claims 10k nodes — React Flow's
answer to very large graphs is _structural_: "Collapse large node trees" via
`hidden`, avoid subscribing to `nodes` from components, memoize, and opt into
`onlyRenderVisibleElements`. So the gate is:

| Fixture                              | Gate                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 625 nodes / ~624 edges, simple nodes | parity with React Flow: same drag and pan frame distribution, no long frames (>50 ms)                                   |
| 1k nodes, simple nodes, culling on   | p95 frame < 33 ms during drag and pan                                                                                   |
| 10k nodes, culled and simplified     | must stay interactive; no numeric promise until measured. If it misses, document the ceiling and the structural escapes |

Everything below exists to meet the first two rows without giving up purity.

**Three tiers of motion.**

1. **Viewport gestures (pan, zoom, pinch).** Four things happen, in this order,
   and the order is the contract:

   1. `onPanZoom` writes `transform: translate(x,y) scale(z)` straight to the
      viewport element through the host registry. The pixels move before any diff.
   2. The same callback queues a throttled `MovedViewport({ isGestureEnd: false })`
      — at most one per animation frame — so `update` keeps `model.viewport` current
      and culling follows the pan.
   3. `onPanZoomEnd` cancels any pending throttled frame, writes the final value, and
      queues `MovedViewport({ isGestureEnd: true })` (cancel-then-final, §4.1).
   4. Only that terminal Message emits `ChangedViewport`, once per gesture.

   `view` always renders the transform from the Model, so time travel and SSR restore
   correctly; when a frame is written by the adapter first, the following patch is a
   no-op.

2. **Node drag.** The parent's node positions are _not_ rewritten per frame. The
   flow's own Model carries the live overlay — `DraggingNodes({ nodeIds, origin,
delta })` — and `view` renders `node.position + delta` for the dragged set. One
   `MovedPointer` Message per pointer event, which browsers already align to the
   frame rate (§4.4), one `MovedNodes` OutMessage on release. Pure, Story-testable, and
   the parent's Model stays stable for the whole gesture: exactly the "interaction
   state belongs to the submodel" split from §2.1.
3. **Committed changes.** Selection, deletion, connection completion, programmatic
   viewport changes, `fitView` — all through `update` and one diff, at human
   interaction rate.

**Why that is enough.** Per frame a drag costs one `update` (a few numbers) and one
`view` pass. The `view` pass is the real risk, so it is bounded by two mechanisms
that ship in the first iteration rather than "after profiling":

- **Per-node memoization, with a bound and an owner.** `createKeyedLazy` takes
  `(key, fn, args)`; the **key only selects a slot**, and invalidation comes from the
  arguments — compared by reference — plus the function reference and dispatcher.
  That invalidation model is right (a new node object invalidates its own subtree; a
  shared `ZERO_DELTA` keeps non-dragged nodes out of the diff) but it never evicts,
  so unique ids from create/delete churn grow the map for the page lifetime.

  So the library does not use `createKeyedLazy` for nodes. `view/nodeCache.ts` keeps
  one `createLazy()` slot per node id in a `Map` **owned by the renderer object** from
  §3.3 — created once per flow instance, not per render — and **sweeps ids absent
  from the render pass** after building the node list. That is exactly the eviction
  variant Foldkit's docblock names as the upgrade path ("a variant that drops keys
  absent from the latest render pass"). Memory follows the largest graph rendered
  rather than its history; the sweep is one `Map` delete per removed node per render;
  and because the map is a closure, two flow instances cannot share slots. Function
  and dispatcher changes invalidate through the slot itself, so the renderer never
  has to detect them.

  Retention has a second dimension worth stating: a cached VNode closes over the
  dispatcher and the renderer helpers of the frame that built it, so a live cache
  holds those references even when the flow is off-screen. `renderer.dispose()` drops
  every slot and the VNode references with it. It is optional while the flow keeps
  rendering (the per-render sweep already bounds the cache) and recommended when a
  route or tab permanently unmounts a flow. Foldkit's own note on `createLazy` — cached
  VNodes must render at exactly one position — is why the cache is per renderer rather
  than global.

- **Viewport culling, recomputed per frame, O(N).** The visible node and edge set is
  derived from `model.pane × model.viewport` in `geometry/visible.ts`, with one
  screen of overscan, and recomputed on every `MovedViewport` (§2.5.6) — but only
  then. Drag frames do not recompute it, because the viewport does not change during
  a drag. The honest cost: each pan frame does a rectangle test per node, plus one
  pass to build the position lookup that edge culling needs, so it is **O(N) per
  viewport frame**, not O(visible). At 625 and 1k that is tens of microseconds; at
  10k it is the first thing to fix (spatial index or coarser visibility cadence), and
  the M0 report records the scan cost as its own metric rather than hiding it inside
  the frame number.

So the two frame kinds cost different things, and the plan should say so plainly:

- **Drag frame:** `O(dragged)` DOM patches; no culling scan, no graph-wide work.
- **Pan frame:** `O(N)` culling scan plus `O(changed)` patches, because the
  intermediate viewport updates are real Model updates.

That second line is the honest version of "culling is cheap": it is cheap per node,
not free, and it is the measurement that decides whether 10k needs a spatial index.

**Measured, not assumed — the benchmark protocol.** M0 ships the harness _and_ the
protocol, so "parity" is a number instead of an adjective. An optimisation the
comparison does not justify is out of scope.

- **Fixtures.** `25×25 = 625` nodes and `~624` edges (xyflow's own stress fixture:
  labelled rectangles, no custom chrome), `10×10 = 100` as a smoke case, and
  generated `1k` / `10k` variants using identical node markup.
- **Build mode.** Production builds for every library (`vite build` + `vite
preview`); dev builds are never compared.
- **Environment.** One machine, one browser (Chrome stable, version recorded in the
  report), no CPU throttling during comparison runs, the same served bundle for all
  three pages, and the machine otherwise idle.
- **Script.** The drag and pan gestures are scripted, mirroring xyflow's
  `FrameRecorder`: mousedown on a known node, 20 frames of 5 px movement, mouseup —
  plus a pan variant on empty pane. One warm-up run is discarded, then 10 runs are
  recorded.
- **Metrics.** Per-frame durations per stage; report median, p95, and longest frame,
  with startup-to-first-paint and full mount time reported separately so layout cost
  is not hidden inside drag numbers. Three extra columns, because the second review
  asked for them: the culling scan, the `view()`/diff portion, and JS heap after a
  1,000-create/1,000-delete churn loop (the memo-cache bound in §4.5).
- **Acceptance.** 625 nodes: median frame ≤ React Flow's median, p95 within 10% of
  React Flow's p95, and no frame over 50 ms. 1k with culling: p95 < 33 ms. 10k:
  reported as an exploration, never a gate.
- **Layout.** React Flow, Svelte Flow, and Foldkit render on three separate pages of
  one app: side-by-side on a single page would share one main thread and one
  compositor, which makes the numbers meaningless.

### 4.6 Event propagation rules

Pane, node, and handle all receive pointer handlers, so the policy has to be
explicit rather than emergent: a handle press must not also start a node drag or
clear the selection.

| Press target                                              | Stops propagation                                                                                                                          | Result                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Handle                                                    | yes                                                                                                                                        | `StartedConnection` for that handle only                                        |
| Node wrapper                                              | yes                                                                                                                                        | `PressedNode` (select + arm drag); the pane handler never runs                  |
| Nested control inside a node (`button`, `input`, overlay) | yes, and the node wrapper does not arm a drag when the target matches `input/textarea/select/button/[contenteditable]` or `.fflow__nodrag` | the control's own Message                                                       |
| Pane                                                      | no                                                                                                                                         | `PressedPane` (clear selection unless additive); panning is left to `XYPanZoom` |
| Wheel over `.fflow__nowheel`                              | yes                                                                                                                                        | scrolls the control, does not zoom                                              |

The three class names do not belong to the same subsystem, and conflating them was
wrong in revision 2. `PanZoomUpdateOptions` exposes `noPanClassName` and
`noWheelClassName` only — there is no `noDragClassName` there, because dragging is a
subsystem this plan deliberately does not use (`XYDrag`). So:

- `noPanClassName` and `noWheelClassName` are passed to `XYPanZoom` when the Mount
  calls `update(...)`, and `classes.ts` owns their names.
- `.fflow__nodrag` is enforced by our own node pointer handler: it checks
  `event.target.closest('.fflow__nodrag, input, textarea, select, button,
[contenteditable]')` before arming a drag.
- Handle and nested-control propagation come from Foldkit attributes
  (`h.OnPointerDown` with `EventPropagation.Stop`), not from the engine.

M0 verifies the split in `adapter.ts`, because getting it backwards means nodes drag
while the user is typing or panning starts on a node control.

---

## 5. Repo layout and tooling

```
foldkit-flow/
├─ packages/
│  ├─ flow/                        # → @fllstck/foldkit-flow
│  │  ├─ src/
│  │  │  ├─ model.ts message.ts outMessage.ts update.ts index.ts
│  │  │  ├─ view/
│  │  │  │  ├─ view.ts             # createRenderer / renderer.view (§3.3)
│  │  │  │  ├─ node.ts edge.ts handle.ts
│  │  │  │  ├─ nodeCache.ts        # per-renderer createLazy() slots, swept each render (§4.5)
│  │  │  │  ├─ background.ts controls.ts minimap.ts panel.ts
│  │  │  │  └─ classes.ts          # DOM/CSS class + data-attr contract
│  │  │  ├─ geometry/              # pure, unit-tested in isolation
│  │  │  │  ├─ screen.ts bounds.ts fit.ts snap.ts paths.ts hitTest.ts
│  │  │  │  └─ visible.ts           # culling + overscan, derived from pane × viewport
│  │  │  ├─ runtime/
│  │  │  │  ├─ adapter.ts           # every @xyflow/system call; the only version-sensitive file
│  │  │  │  ├─ mountPane.ts mountNode.ts host.ts viewportThrottle.ts
│  │  │  │  ├─ command.ts subscriptions.ts pointer.ts
│  │  │  └─ test/                  # Flow.test.* helpers for Scene/Story
│  │  ├─ style/                    # our own CSS: no upstream stylesheet, no copied look
│  │  └─ package.json vite.config.ts vitest.config.ts tsconfig.json
│  ├─ benchmark/                    # M0: fixture generator + frame recorder, side by side with React Flow
│  └─ example/                     # demo app: workflow editor + kanban-ish graph
└─ docs/
```

Tooling, matching the Foldkit scaffold: Vite + `@foldkit/vite-plugin`, `oxlint`,
`vitest`, `foldkit/test/vitest` for Story/Scene expect extensions. `@xyflow/system`
is the only runtime dependency beyond `foldkit` and `effect`. `@xyflow/react` and
`@xyflow/svelte` appear only as devDependencies in `packages/benchmark` — the parity
comparison renders the same fixture through them — and the library itself never
imports either.

Publishing: `@fllstck/foldkit-flow`, MIT. No upstream stylesheet, no upstream
attribution component, no upstream visual identity; our CSS is written from scratch
(§2.4).

---

## 6. Testing strategy

The whole point of this design is that the interesting logic is pure:

- **Story tests** (no DOM): drag math (`PressedNode` + `MovedPointer` × n +
  `ReleasedPointer` → positions + one `MovedNodes` OutMessage), additive selection
  across nodes and edges, delete, connection start/complete/cancel, viewport math,
  `fitViewport`, and keyboard handling — including the cases the review flagged:
  foreign `pointerId` ignored, `CancelledGesture` for `pointercancel` / blur /
  Escape, and Delete/Escape ignored for input, textarea, select, contenteditable,
  and `.fflow__nokey` targets. Also asserts the §2.5.4 claim that stored
  `HandleBounds` are unchanged when only the viewport zoom changes
  (`expectOutMessage`, `Command.expectExact(SyncViewport)`).
- **Throttle unit tests** (fake `requestAnimationFrame`): three `offer` calls in one
  frame emit once, with the last value; `offer` then `cancel` emits nothing;
  `cancel` then `offer` starts a fresh frame; `cancel` after `flush` is a no-op. This
  is where cancel-then-final ordering is actually asserted, because the adapter is
  what implements it.
- **Lifecycle cases the second and third reviews called out**, each as a Story test:
  a pending throttled `MovedViewport` followed by `isGestureEnd: true` leaves the
  committed viewport as the terminal value; a `MergedHandleBounds`
  carrying three nodes leaves the other nodes' bounds untouched, and its
  `missingNodeIds` prune rather than keep stale geometry; `Flow.informGraphChanged`
  drops selection, sizes, bounds, and a gesture over removed ids; a `PressedNode` for
  an id absent from `context` is ignored; `PressedDeleteKey` after the graph shrank
  never emits `DeletedElements` for dead ids.
- **Renderer cache tests** (pure, no DOM): two renders with the same node object reuse
  the cached VNode; a new node object re-renders; a second renderer gets its own
  cache; an id absent from a render pass is swept, so memory follows the current
  graph. Hit and miss are asserted by **VNode reference identity** across two renders
  (`lazy.d.ts` marks `observeLazyResolutions` `@internal`, so tests do not use it).
- **Scene tests** (rendered view, accessible locators): node markup and handles
  present, `pointerDown` on a node starts a drag (`Mount.expectHas`,
  `expectOutMessage` after `pointerUp`), clicking a handle starts a connection,
  zoom buttons dispatch, delete key removes the selection, and the pane Mount is
  acknowledged/resolved. Re-rendering a node with a different handle set patches the
  existing element; the remeasure is a browser concern (Scene has no layout and no
  observers), so Scene only asserts that no Mount re-registers.
  Known gap: Scene has no `pointerMove`, so mid-drag frames are Story-only. Keep
  `MovedPointer`'s handler free of DOM dependencies so this stays true.
- **Browser tests** (Playwright, one file per feature): real pointer moves, wheel
  zoom, pinch, `ResizeObserver` + `MutationObserver` measurement, handle hit-testing,
  and the imperative transform write, nodes appearing mid-pan under culling, a flow
  inside a ShadowRoot, nested-control drag exemption (§4.6), a stylesheet-only layout
  change followed by `Flow.remeasure` (§2.5.3), and `pointercancel` from an OS
  gesture. These cover exactly the layer Story/Scene cannot.
- **Benchmark harness** (`packages/benchmark`): the 25×25 fixture rendered through
  React Flow, Svelte Flow, and `@fllstck/foldkit-flow`, with a frame recorder around
  a scripted drag and pan. This is a test artifact, not a demo: it decides whether
  an optimisation earns its complexity (§4.5).
- **Golden cases borrowed from the wrappers**: the same node/edge fixtures rendered
  by React Flow and by Flow, compared by path `d` strings and pixel screenshots —
  the fastest way to prove the geometry port is faithful.

**The boundary rule (`docs/verification.md`).** Every visual bug this project has
shipped was green at one layer and broken at the next: an edge with the right `d`
that painted nothing, a transform attribute that was inert, a wrapper that grew while
its content did not, a CSS rule that stretched a handle. The rule that came out of
those four: *assert at the layer the user perceives, and name that layer in the
test*. `docs/verification.md` lists the six boundaries between the Model and the eye
(Model → DOM value → paint → content layout → siblings → served bundle), the bug each
one produced here, and the assertion that crosses it, plus the five-question
checklist a visual feature has to answer before it is called done. §6's split above
still decides *where* a test goes; the boundary rule decides *what it asserts*.

---

## 7. Milestones

**Scope.** **v0.1 = M0–M2**: the first iteration — pan/zoom, drag, select,
connect, custom nodes, plus the performance work that makes them usable.
**v1.0 = M0–M4** as shipped: adds sub-flows, resizing, minimap, edge types, and the
polish pass. Sub-flows, resizing, minimap, and edge types are in the product scope;
they are just not in the first iteration. **M5 and M6 are post-v1.0.**

**M0 — spike, 3–4 days. Retire the risky assumptions, pin the API, stand up the
benchmark.** Static render only: nodes as positioned divs, edges as paths from
`getBezierPath`, no interaction, plus `packages/benchmark` and
`runtime/adapter.ts`. Prove six things:

1. `@xyflow/system` path utils produce correct `d` strings through Foldkit's SVG
   builder (`h.path([h.Attribute('d', path)])`).
2. A `Mount.defineStream` node wrapper + `ResizeObserver` produces `MeasuredNode`
   and re-renders without restarting the Mount.
3. `XYPanZoom` in a `Mount.defineStream` survives Model changes and can be
   `syncViewport`ed from a Command.
4. SSR/hydration renders the transform from the Model without a flash.
5. The benchmark harness works: the 25×25 fixture renders in React Flow and in
   `@fllstck/foldkit-flow`, and a frame recorder produces comparable per-frame
   numbers for the same scripted drag.
6. `runtime/adapter.ts` compiles against the pinned `@xyflow/system`, and every
   engine signature the design depends on is checked there: `XYPanZoom` params and
   callbacks, `setViewport(viewport, options)`, `syncViewport(viewport)`,
   `getHandleBounds`, and the path helpers.
   Exit criteria: a static 625-node render in Foldkit, a working benchmark page whose
   numbers are trusted enough to gate M1, and written notes on which of the six needed
   workarounds. No interaction yet.

**M1 — interaction core, measurement, and the performance gate.**
`Flow.Model`/`Message`/`update(model, message, context)` with the per-dispatch fold
(§2.5.1), pane + node Mounts, the `PaneHost` registry (element, root, panZoom,
viewport; §4.3), `paneId` in the Model, `SyncViewport`,
throttled `MovedViewport` per frame with cancel-then-final ordering, node drag with
the `DraggingNodes({ delta })` overlay, split node/edge selection, keyboard delete
with the editable-target guard, pointer identity and `CancelledGesture`,
`MeasuredNode` + `MeasuredHandles` with the §2.5.3 invalidation mechanism
(`ResizeObserver` + `MutationObserver` on the handle DOM) and the `MeasureHandles`
checkpoint, `Flow.informGraphChanged` plus the existence checks from §2.5.9, the §4.6
propagation rules, **viewport culling** (`geometry/visible.ts`), **the
renderer-owned node cache** (`Flow.createRenderer`, §3.3 and §4.5), and the §4.5 gate
(parity at 625 nodes, p95 < 33 ms at 1k with culling). Story covers the state machine,
the lifecycle cases, and cache hits/misses; Scene covers propagation; Playwright
covers the pointer layer, remeasurement, and ShadowRoot hosting.

**M2 — connections.** Connection gesture (`StartedConnection` → `MeasureHandles` →
`HoveredHandle` → `ReleasedPointer` → `ConnectedHandles` OutMessage) driven by
`Flow.hitTestHandle(model, point)` against bounds refreshed at gesture start,
connection line rendering, an `isValidConnection` predicate supplied through
`context` and evaluated in `update`, reconnect, and edge endpoints switching from
node borders to measured handle positions. Measurement contract closed out here:
merge-only updates (`MergedHandleBounds`), `missingNodeIds` pruning, and
`Flow.remeasure` documented as the answer to stylesheet-only layout changes
(§2.5.3).

_—— v0.1 ships here ——_

**M3 — own chrome and a11y.** `Background` (dot and line patterns, drawn against
our own CSS, transform-aware),
`Controls` (zoom in/out/fit), `MiniMap`, `Panel`, focusable nodes with Tab
cycling and arrow-key nudging, and a visually hidden description region listing
the nodes and their connections.

**M4 — graph features.** Parent/child sub-flows, node resizing (`XYResizer`),
snap grid, `fitView` options, edge types (step/smoothstep/labels/markers), and
`hidden`-based subtree collapsing as the documented escape hatch for very large
graphs.

_—— v1.0 ships here ——_

**M5 — hardening and docs.** Re-run the benchmark at 1k and 10k and publish the
numbers, including the ceiling if there is one. Ship the fixture gallery against
React Flow, package docs, and an example app page in the style of `foldkit.dev`'s
examples.

**M6 — the deliberate gaps, researched first.** M4 shipped v1.0 with eleven named
omissions (`docs/M4-FINDINGS.md` §8). Each was a decision taken inside a milestone,
several of them before the primary sources had been read in full: `XYResizer` was
rejected from the Mount seam's properties, edge selection was deferred, `nodeOrigin`
was scoped out, and the minimap stopped at a click. M6 pays that debt in the right
order — **research, then decide, then code only what the decision says** — and its
first deliverable is a document, not a feature.

**Method (binding, not advisory).**

1. **Primary sources only.** The pinned `@xyflow/system@0.0.84` source in
   `node_modules` and the corresponding `@xyflow/react` / `@xyflow/svelte` files on
   GitHub; their API-reference pages; the issues, discussions and release notes
   where the maintainers explain a design. Documentation prose is a claim to check
   against the source, not the answer.
2. **A second implementation per point.** For every question, one non-xyflow
   implementation of the same behaviour (tldraw, Excalidraw, LiteGraph, Cytoscape,
   or a comparable library) — to separate "how xyflow does it" from "what the
   problem is".
3. **Two independent sources per factual claim**, each dated and linked. Where the
   docs describe a newer version than the pinned one, say so and mark which
   behaviour we would get.
4. **Behaviour, never look.** §2.4 still holds: no upstream stylesheet, no copied
   visual identity, no attribution component. Research tells us what is *correct*;
   the design stays ours.
5. **What the sources cannot settle is measured**, not assumed: a Story test, a
   browser probe, or a benchmark leg, recorded with its number.
6. Every decision lands in `docs/M6-RESEARCH.md` as one of **ship**, **ship
   differently** (with the difference stated), or **keep out** (with the reason and
   what would change the answer), and then in code with a proof — or in
   `docs/M6-FINDINGS.md` as a documented gap.
7. Every **ship** verdict is proved at the layer the user perceives
   (`docs/verification.md`): pixels for anything drawn, the consumer's content for
   anything resized, the neighbours for anything restyled, and a second consumer
   page for anything that becomes a default.

**The research questions.** Each row is one section of `docs/M6-RESEARCH.md`; § is
the M4-FINDINGS section that left it open.

| #  | Gap (§)                    | What the research has to answer                                                                                                                                                                                                                                  | Decision it unblocks                                  |
| -- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1  | `XYResizer` (§2.6)         | Can its `getStoreItems` be satisfied without a reactive store — what do the wrappers pass, must `update()` be re-called per render, what happens if the box changes mid-gesture, and did anything change after 0.0.84?                                              | Adopt `XYResizer`; keep our gesture; or adopt only its geometry |
| 2  | Minimap interaction (§2.9) | The semantics of `pannable`, `zoomable`, `onClick(event, position)`, `onNodeClick`, `inversePan`, `zoomStep`, `offsetScale`; how `XYMinimap` (in the pinned package) handles pointer identity, cancel and the viewBox→flow mapping; what a screen reader should be told | Click-only, click + drag, click + drag + wheel, and whether a node is a target |
| 3  | Edge selection (§2.10)     | `interactionWidth` and its default; the `pointer-events` history of the invisible helper path; how selection is done without lifting the edges layer above the nodes; `elementsSelectable`, `edgesFocusable`                                                      | Ship edge selection, and its hit path                 |
| 4  | `nodeOrigin` (§8)          | Flow-level and per-node `origin`; how an origin interacts with parent/child relative positions, `extent`, handle bounds and `getNodesBounds`; which of our helpers would become origin-aware                                                                        | Ship, ship per-node only, or keep out with a workaround |
| 5  | Parent resize re-placing children (§8) | `childChanges` from `XYResizer`, `extent: "parent"`, `expandParent`, `nodeToChildExtent`; how children stay visually still when a parent's top-left moves, and what happens to grandchildren                                                                 | Compensate children, or document it as the parent's job |
| 6  | `keepAspectRatio`, `resizeDirection`, `shouldResize` (§8) | The control props `XYResizer` takes; whether upstream binds a modifier for aspect locking; what `shouldResize` can veto                                                                                                                          | Add aspect locking, edge controls, or neither         |
| 7  | Interactive edge labels (§8) | How upstream labels are built: SVG text versus an HTML layer (`EdgeLabelRenderer`, `nodrag nopan`), label backgrounds, and the `edge-toolbar` / `node-toolbar` helpers the pinned package already exports                                               | Whether the halo stays the primitive or becomes one branch |
| 8  | Multi-node resize (§8)     | Any upstream precedent (group or selection-box resize); otherwise how a second implementation transforms a multi-selection, and whether our one-delta-per-gesture rule extends to boxes                                                                            | Multi-resize, or a permanently documented single-node rule |
| 9  | Handle geometry during a resize (§8) | How the wrappers keep edge endpoints correct while a box changes: when `getHandleBounds` re-runs, what `updateNodeInternals` / `useUpdateNodeInternals` exist for, and whether upstream is actually lag-free                                                   | Accept the one-frame lag, or a targeted remeasure on resize frames |
| 10 | The culling scan (§6, §7)  | How the wrappers cull (`onlyRenderVisibleElements`, `getNodesInside`, `isEdgeVisible`) and what other libraries use for the same job; whether an index, a coarser cadence, or both is the right fix for `nodeSizeOf`'s O(measured) lookup at 10k               | The fix, with a measured before/after at 1k and 10k    |
| 11 | Edge focus and the tab order (§2.10, §10 a11y) | `nodesFocusable`, `edgesFocusable`, `disableKeyboardA11y`, the `aria` labels upstream emits for edges, and how focus order is decided across both kinds of element                                                                                       | Extend our tab order to edges, and the description region |

**Order.** 10 first (it is a measured number, independent of every other decision,
and it bounds what 1 and 9 can cost); then 3 with 11 as one unit (an edge you can
select but not focus is half a feature); then 1, because its answer may replace the
code that 5, 6 and 9 would otherwise extend; then 2, 4, 5 and 6; then 7 and 8.

**Definition of done.**

- `docs/M6-RESEARCH.md` exists, one section per row above, each ending in a verdict
  from the three-way choice and carrying its links and dates.
- Every **ship** verdict is implemented with a proof in the M4 style (a Story test
  for pure logic, a Playwright proof for the gesture and the paint).
- Every **keep out** verdict is in `docs/M6-FINDINGS.md` with the reason and the
  evidence that the reason still holds.
- The gate is unchanged and re-run at the committing commit: 625 at parity with
  React Flow on pan, 1k culled p95 < 33 ms with long frames inside the 2% bound.
  If 10 changes the culling scan, its before/after is recorded at 1k and 10k.
- `README.md` documents whatever shipped, and `docs/M4-FINDINGS.md` §8 is updated
  to point at the verdicts rather than leaving the old list as the last word.
- `pnpm typecheck`, `pnpm build`, `pnpm check`, `pnpm bench` green.

**Not in M6.** No re-litigation of decisions that are not on the list above; no
upstream stylesheet, component or attribution (§2.4); no new product scope — an
idea that arrives during the research is written down as a candidate, not built.

---

## 8. Risks and their mitigation

| Risk                                                                  | Mitigation                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-frame work makes the app janky                                    | drag overlay in the submodel + the bounded node cache + Model-derived culling + the §4.5 gate, which blocks M1 until the numbers exist                                                                                |
| `Mount` args not reactive → the pan/zoom handle drifts from the Model | the only non-reactive arg is the initial viewport, which is exactly "initial" semantics; every later change goes through `SyncViewport` (§2.5.5)                                                                      |
| Time travel re-runs Mounts and can produce phantom Messages           | Mount work is element-local and idempotent; `viewStateChanges` makes the paused view read-only; no Messages from DOM while `Paused`                                                                                   |
| Handle geometry wrong → connections land in the wrong place           | reproduce the `.source`/`.target` + `data-handleid`/`data-handlepos` contract, measure with `getHandleBounds` in the node Mount, golden-test against React Flow                                                       |
| Scene can't synthesize `pointermove`                                  | keep gesture math in pure functions; browser tests for the DOM layer                                                                                                                                                  |
| Generic node data vs Schema-defined Model                             | graph data stays in the parent application (§2.1); the flow Model is concrete                                                                                                                                         |
| Stale measurements after nodes are deleted                            | the node Mount's release queues `RemovedNodeMeasurement`, `Flow.informGraphChanged` prunes ids the parent no longer owns, and view/geometry ignore ids without a node (§2.5.3, §2.5.9)                                |
| React Flow habits leaking into the API                                | no interop module by decision (§9.3): `NodeChange` and `applyNodeChanges` are deliberately not reproduced. `Node`/`Edge`/`Handle` are shared vocabulary, not a compatibility promise                                  |
| Performance ceiling below React Flow's                                | the §4.5 gate is a merge blocker: parity at 625 nodes, p95 < 33 ms at 1k with culling. If 10k misses, publish the ceiling and the structural escapes (`hidden` subtrees) instead of pretending                        |
| Culling is O(N) per pan frame                                         | stated plainly in §4.5 and measured as its own metric; a spatial index or coarser visibility cadence is the 10k remedy if the number demands it                                                                       |
| Cache growth from create/delete churn                                 | the node cache is a per-renderer `Map` of `createLazy()` slots swept each render, so memory follows the largest graph, not its history; the benchmark reports heap after a 1,000-create/1,000-delete loop (§4.5)      |
| Handle geometry can change without a resize                           | `MutationObserver` on the node subtree with `{ childList, attributes, subtree }` and **no** `attributeFilter`, coalesced to one measurement per frame; the connection gesture re-measures before hit-testing (§2.5.3) |
| Stylesheet-only layout changes move handles silently                  | gesture-start checkpoint covers hit-testing; edge endpoints recover via `Flow.remeasure`, documented as a consumer responsibility for CSS that changes node-internal geometry (§2.5.3)                                |
| A partial handle sweep erases unrelated bounds                        | `MergedHandleBounds` merges per node; `missingNodeIds` prune instead of keeping stale geometry; Story test asserts a three-node sweep leaves the rest intact (§2.5.3, §4.3)                                           |
| Renderer cache recreated per render (memoization silently off)        | the cache is a closure of `Flow.createRenderer`, documented as module/app scope; two instances need two renderers; cache tests assert hit/miss and sweep (§3.3, §4.5)                                                 |
| Renderer outliving its flow retains VNodes and dispatchers            | `renderer.dispose()` drops every slot; optional while rendering (the sweep bounds the cache), recommended on route/tab unmount; cache tests assert disposal empties the cache (§3.3, §4.5)                            |
| A handle signature collected during view construction                 | removed in revision 5: view must stay pure, and a cached subtree never re-invokes `renderNode`, so the observer watches the real handle DOM instead (§2.5.3)                                                          |
| Parent graph changes outside a Flow Message                           | `Flow.informGraphChanged` prunes selection, sizes, bounds, and dead-id gestures; gesture-initiating Messages check ids against `context` (§2.5.9)                                                                     |
| A throttled viewport frame lands after the terminal one               | cancel-then-final: `viewportThrottle.cancel()` before the final write, also on release; a unit test drives the throttle with a fake rAF suite, plus a Story test for the Message-level consequence (§4.1)             |
| Fold rebuilt per dispatch (§2.5.1)                                    | one closure + config object per Message; measured in the §4.5 report, and the alternative (a stored graph copy) is the anti-pattern it avoids                                                                         |
| Attribution / naming / licence ambiguity                              | resolved (§9): `@fllstck/foldkit-flow`, MIT, own CSS and visual identity, no upstream stylesheet and no attribution component                                                                                         |

---

## 9. Decisions (answered)

Answered 2026-11-11. Each answer is folded into §2.4, §4.5, §5, or §7; the
consequences are listed under each item.

1. **Package name and branding.** Which scope and name to publish under, without
   implying affiliation with xyflow.

   **Decision.** `@fllstck/foldkit-flow`.

   **Consequence.** Package name, README, and the §5 layout use the scope. The
   public API keeps the `Flow.*` namespace, and nothing in code or docs implies
   affiliation with xyflow.

2. **Licence and attribution.** npm says all three packages are MIT:
   `@xyflow/system` 0.0.84, `@xyflow/react` 12.12.1, `@xyflow/svelte` 1.7.1.
   Attribution removal is a Pro benefit for their _components_, not a term of the
   MIT licence, and `handleAttributionWarning` in system takes
   `'react' | 'svelte' | 'vue'`. Building on the engine is therefore allowed, but
   a courtesy ask before reusing their stylesheet or visual identity is still the
   polite move, and the package name must not imply affiliation.

   **Decision.** Our package is MIT. No upstream stylesheet, no upstream visual
   identity.

   **Consequence.** New §2.4: our own CSS and chrome, written from scratch. The
   only thing kept from the wrappers is the _functional_ DOM contract that
   `getHandleBounds` reads (`.source`/`.target` classes plus the
   `data-handleid`/`data-handlepos` attributes) — geometry plumbing, not styling.
   No attribution component ships.

3. **API philosophy.** Foldkit-native (typed Messages/OutMessages, `Option` for
   optional handles, `Schema`-validated Model) versus React-Flow-shaped (`NodeChange`
   unions, `applyNodeChanges`, minimal porting friction).

   **Decision.** Foldkit-native only. No React-Flow-shaped interop module.

   **Consequence.** `NodeChange`, `EdgeChange`, `applyNodeChanges`, controlled vs
   uncontrolled props, and two-way binding are not reproduced anywhere. Messages
   and OutMessages are the only change channel. The "add interop later" risk in §8
   is closed by decision.

4. **Performance target.** How large a graph must stay smooth, and what the
   comparison point is.

   **Decision.** Parity with React Flow and Svelte Flow on their own fixture; 10k
   only if they can do it.

   **Consequence.** Upstream does not claim 10k — their repo stress example renders
   25×25 = 625 nodes and records drag frame durations, and their documented answer
   to larger graphs is structural (hide/collapse subtrees, memoize, opt into
   `onlyRenderVisibleElements`). So the gate is parity at 625 nodes, p95 < 33 ms at
   1k with culling, and 10k as a measured stretch with the ceiling published if we
   miss. This pulled performance work into M1: the `DraggingNodes({ delta })`
   overlay, pointer Messages that follow the display rate, the bounded node cache,
   Model-derived culling, and per-frame `MovedViewport` — all of which ship in the
   first iteration (§4.5, §7). The benchmark harness, with its protocol, is an M0
   deliverable.

5. **Scope of v1.** Which features are in the first iteration versus the product
   roadmap.

   **Decision.** Sub-flows, resizing, minimap, and edge types are in product scope,
   not in the first iteration.

   **Consequence.** Milestones are labelled by release: **v0.1 = M0–M2**
   (pan/zoom, drag, select, connect, custom nodes, performance gate), **v1.0 =
   M0–M5** (adds own chrome and a11y, sub-flows, resizing, minimap, edge types, then
   hardening). §7 carries the markers.

---

## 10. Revision history

**Revision 2** — after an external review (`PLAN-CRITIQUE.md`). Accepted and
applied:

| #   | Finding                                       | Resolution                                                                           |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `update` had no graph context                 | `Flow.update(model, message, context)` + per-dispatch fold (§2.5.1)                  |
| 2   | Handle geometry described but not represented | `HandleBounds` in the Model, `MeasuredHandles`, explicit invalidation (§2.5.2–3)     |
| 4   | Pan/zoom started from a placeholder viewport  | initial viewport is a Mount arg (§2.5.5, §4.1)                                       |
| 5   | `setViewport` called with a bare number       | `setViewport(viewport, { duration })`, verified in the adapter (§4.3)                |
| 6   | Culling frozen during a pan                   | throttled `MovedViewport` per frame + overscan (§2.5.6, §4.5)                        |
| 7   | Selection could not tell nodes from edges     | `selectedNodeIds` / `selectedEdgeIds` (§3.1)                                         |
| 8   | `document`-level subscriptions                | pane root from the host registry + `pointerId` filtering (§4.4)                      |
| 9   | Delete fired while editing node content       | `Flow.isDeleteKeyAllowed` guard + tests (§2.5.8, §6)                                 |
| 10  | Memoization key incomplete                    | corrected to `createKeyedLazy(key, fn, args)` semantics (§4.5)                       |
| 11  | Benchmark gate not reproducible               | protocol in §4.5; 10k explicitly exploratory                                         |
| 12  | Gesture state underspecified                  | `Pointer` in gesture states, `CancelledGesture`, pinch owned by `XYPanZoom` (§3.1–2) |
| 13  | Propagation rules undefined                   | §4.6                                                                                 |
| 14  | Versions unpinned                             | exact pin + `runtime/adapter.ts` (§2.5.7)                                            |

Rejected:

- **#3, "handle bounds go stale after zoom."** The mechanism does not hold:
  `getHandleBounds` divides offsets by zoom and `getDimensions` reads
  `offsetWidth`/`offsetHeight`, which CSS transforms do not affect, so the stored
  geometry is scale-invariant by construction. The invalidation gap the finding
  pointed at was real and is now §2.5.3.

**Revision 3** — after the second-pass review (`PLAN-CRITIQUE-REVISION-2.md`). All
seven findings accepted, plus the minor consistency list:

| #   | Finding                                                                                | Resolution                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Handle invalidation on markup change was asserted, not wired                           | `ResizeObserver` + `MutationObserver` + the `data-handles` signature the view emits, coalesced per frame, plus the `MeasureHandles` checkpoint (§2.5.3, §4.3) |
| 2   | Parent graph changes leave stale selection and bounds                                  | `Flow.informGraphChanged` + id checks on gesture-initiating Messages (§2.5.9)                                                                                 |
| 3   | Throttled viewport frames can land after the terminal one                              | cancel-then-final in the throttler, one Mount-scoped cell, Story test (§4.1)                                                                                  |
| 4   | Viewport behaviour described inconsistently                                            | one ordered four-step contract: DOM write → throttled Message → terminal Message → single OutMessage (§4.1, §4.5)                                             |
| 5   | Culling is O(N) per pan frame                                                          | stated plainly; drag-frame and pan-frame costs separated; the scan is its own benchmark metric (§4.5)                                                         |
| 6   | Memo cache unbounded                                                                   | `createKeyedLazy` per node replaced by a per-renderer `Map` of `createLazy()` slots swept each render (§4.5)                                                  |
| 7   | `noDragClassName` attributed to `XYPanZoom`                                            | corrected: pan and wheel class names go to `XYPanZoom`; `.fflow__nodrag` is checked by our node handler (§4.6)                                                |
| —   | ownership diagram, TL;DR viewport wording, "one Mount per node", DOM-vs-Model ordering | fixed in place                                                                                                                                                |

No findings rejected in this pass.

**Revision 4** — after the third-pass review (`PLAN-CRITIQUE-REVISION-3.md`). All
three findings and the stylesheet observation accepted; nothing rejected.

| #   | Finding                                                        | Resolution                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `MeasureHandles` destroyed bounds for nodes it did not measure | `ReplacedHandleBounds` replaced by `MergedHandleBounds({ entries, missingNodeIds })` with per-node merge semantics; missing elements prune explicitly instead of returning an empty set (§2.5.3, §4.3)                                                                                                                                                              |
| 2   | Renderer-cache lifetime undefined                              | `Flow.view(config, h)` replaced by `Flow.createRenderer(config)` returning `renderer.view(input, h)`; the cache is a closure of the renderer, swept per render, with slot-level invalidation for function/dispatcher changes. `renderNode` moved into the stable config; `h` is now threaded into it per call so the renderer can live at module scope (§3.3, §4.5) |
| 3   | Parent reconciliation missing from the wiring example          | `withGraphChanged(model, mutate)` helper in §3.5, used by the `DeletedElements` branch and prescribed for undo/import/server-push handlers (§2.5.9)                                                                                                                                                                                                                 |
| obs | Stylesheet-only layout changes move handles without a mutation | documented as a consumer responsibility, with `Flow.remeasure(paneId)` exported and tested; gesture-start checkpoint already covers hit-testing (§2.5.3)                                                                                                                                                                                                            |

**Revision 5** — after the fourth-pass review (`PLAN-CRITIQUE-REVISION-4.md`). Four
findings plus the documentation note accepted; nothing rejected. The review also
re-validated the architecture against React Flow, Svelte Flow, and Foldkit sources.

| #    | Finding                                                      | Resolution                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `data-handles` may violate view purity                       | **Removed.** The signature needed collection during view construction, and a cached subtree never re-invokes `renderNode`, so it would have been wrong exactly when it mattered. The `MutationObserver` watches the real handle DOM instead (§2.5.3) |
| 2    | Renderer cache cleanup incomplete                            | `renderer.dispose()` added, with what it releases (slots, cached VNodes, retained dispatchers) and when to call it; the per-render sweep remains the steady-state bound (§3.3, §4.5)                                                                 |
| 3    | Pane host registry has no root                               | replaced by a `PaneHost` record (`element`, `root`, `panZoom`, `viewport`) with `registerPane` / `getPane` / `getPaneRoot` / `getPaneElement` / `releasePane` / `setPaneViewport`, identity-safe on remount (§4.3)                                   |
| 4    | Stale §4.2 wording implied the Mount re-runs                 | rewritten: the differ patches the element, the observer reacts, the Mount only re-runs when the element itself is replaced (§4.2)                                                                                                                    |
| note | `Flow.remeasure` responsibility only in implementation notes | promoted to a three-sentence public contract in §2.5.3, repeated in the package docs deliverable                                                                                                                                                     |

**Revision 6** — after the fifth-pass review (`PLAN-CRITIQUE-REVISION-5.md`). All
three findings and both consistency items accepted; nothing rejected. All five were
implementation-level, and three of them were contradictions introduced by earlier
revisions rather than new design questions.

| #   | Finding                                                    | Resolution                                                                                                                                                            |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `onPanZoomEnd` used a one-argument signature               | `(_event, next) =>` — `OnPanZoom` passes the event first for all three callbacks; the M0 adapter check now covers start/move/end                                      |
| 2   | `data-handle*` is not a valid `attributeFilter` entry      | observer now runs unfiltered (`childList` + `attributes` + `subtree`); `attributeFilter` takes exact names only (MDN), and the per-frame coalescer absorbs the volume |
| 3   | Subscriptions fell back to global `document`               | removed: no `PaneHost` ⇒ `Stream.empty`. The fallback re-created the isolation problem `PaneHost` exists to solve (§4.4)                                              |
| 4   | `PaneHost.viewport` was never synchronised                 | field **removed**: the Model owns the viewport, the Mount receives it as an arg. Three copies, two stale (§4.3)                                                       |
| 5   | `Flow.remeasure` signature differed between prose and code | standardised on `remeasure(paneId, nodeIds)`; "all visible" is spelled out, no implicit overload (§2.5.3)                                                             |

**Revision 7** — after the final check (`PLAN-CRITIQUE-REVISION-6.md`). Both items
accepted; nothing rejected. Both were places where the plan described a design the
code sample did not show.

| #   | Finding                                                                 | Resolution                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Risk table still described the removed `data-handle*` filter            | row now states `{ childList, attributes, subtree }` with no `attributeFilter`, coalesced per frame (§8)                                                                                                                                                                                     |
| 2   | Cancel-then-final described in prose but absent from the adapter sample | `makeViewportThrottle` added as its own module with `offer`/`cancel`, called as `viewportThrottle.cancel()` before the final write **and** in the release; a throttle unit test with a fake rAF now asserts the ordering, and the Story test keeps the Message-level consequence (§4.1, §6) |

---

## Appendix: verified facts behind this plan

- The three-package split, the `getStoreItems()` pattern, `NodeChange`/`EdgeChange`
  unions, `$bindable` state in Svelte Flow, the imperative transform write, and the
  `.source`/`.target` + `data-handleid`/`data-handlepos` handle contract were read
  from `@xyflow/system@0.0.84` (`dist/esm/**/*.d.ts`, `index.mjs`) and the xyflow
  repository sources. Details and links: [`xyflow-internals.md`](xyflow-internals.md).
- `foldkit@0.170.0`: `Mount.define` / `defineStream` / `args` / `viewStateChanges`,
  `Command.define`, `Subscription.make`/`lift`/`persistentEntry`,
  `defineTaggedUnion`, `defineMessageUnion`, `Update.foldChild`,
  `HtmlBuilder` (full SVG tag set, `ViewBox`, `Style`, `Attribute`,
  `DataAttribute`, `keyed`, `OnPointerDown/Move/Up/Wheel`), `Dom.streamFromEvent*`,
  Scene helpers (`pointerDown`, `pointerUp`, `Mount.*`, `expectOutMessage` — no
  `pointerMove`). Details: [`foldkit-constraints.md`](foldkit-constraints.md).
- The host-registry pattern and the "commit on `moveend`" precedent come from
  `examples/map/src/{main.ts,mapHost.ts}`; the document-subscription gesture
  precedent comes from `@foldkit/ui`'s `DragAndDrop` and
  `examples/kanban/src/subscription.ts`.

- Performance gate facts: xyflow's repo stress example (`examples/react/src/examples/Stress`)
  renders `getNodesAndEdges(25, 25)` = 625 nodes and ~624 edges with a
  `FrameRecorder` (`performanceUtils.ts`) that samples `requestAnimationFrame`
  durations across mousedown → 20 × 5px mousemove → mouseup; the docs-site variant
  defaults to `initialElements(10, 10)` = 100 nodes. React Flow's performance page
  prescribes memoization, a separate selection field, collapsing large trees via
  `hidden`, and simpler styles — not a node-count claim.
- Licences and versions: `@xyflow/system` 0.0.84, `@xyflow/react` 12.12.1,
  `@xyflow/svelte` 1.7.1, all MIT (npm metadata).
- Zoom invariance of handle geometry: `getHandleBounds` returns
  `x: (handleRect.left - nodeRect.left) / zoom` and spreads
  `getDimensions(handle)`, which is `offsetWidth`/`offsetHeight`
  (`dist/esm/index.mjs`). `PanZoomTransformOptions` is
  `{ duration?, ease?, interpolate? }`, and `setViewport(viewport, options?)` /
  `syncViewport(viewport)` differ in arity.
- Memoization semantics: `createKeyedLazy()(key, fn, args)` — "the key only selects
  a slot"; invalidation is by function reference, dispatcher, and argument
  references; "entries are never evicted" (`foldkit` `dist/html/lazy.d.ts`).
- Submodel context: `Update.foldChild`'s `update` is `(childModel, input)` with no
  context parameter, and the docs prescribe closing over per-dispatch context
  (`foldkit` `dist/update/update.d.ts`). `Dom.streamFromEvent*` accepts
  `target: Target | (() => Target)` and reads it inside the acquire effect.
- Mount does not re-run on re-render: "the differ reuses an existing DOM node when
  its tag and identity still match. A reused node keeps its Mount running"
  (foldkit.dev/core/mount). This is the fact behind the §2.5.3 invalidation
  mechanism.
- `PanZoomUpdateOptions` exposes `noWheelClassName`, `noPanClassName`,
  `onPaneContextMenu`, `preventScrolling`, `panActivationKeyPressed`,
  `paneClickDistance`, `selectionOnDrag` — and **no** `noDragClassName`, because
  node dragging belongs to `XYDrag`, which this plan does not use
  (`dist/esm/types/panzoom.d.ts`).

Code in §3–§4 is a sketch: it follows verified signatures but has **not** been
type-checked or run. M0 exists to compile it.
