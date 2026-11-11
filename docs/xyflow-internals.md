# How React Flow and Svelte Flow are built

Notes gathered from the xyflow repository, docs, and the published `@xyflow/system`
package. Versions checked: `@xyflow/system` 0.0.84 (npm tarball, unpacked to
`dist/esm`), `@xyflow/react` 12.12.x, `@xyflow/svelte` 1.5.x.

## Three packages, one engine

| Package          | Depends on                                             | Owns                                                                                          |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `@xyflow/system` | `d3-zoom`, `d3-drag`, `d3-selection`, `d3-interpolate` | geometry, edge path math, pan/zoom, drag, handle/connection logic, minimap math, shared types |
| `@xyflow/react`  | `@xyflow/system`, `zustand`, `classcat`                | store, components, hooks, rendering                                                           |
| `@xyflow/svelte` | `@xyflow/system`                                       | store (Svelte 5 runes), components, actions                                                   |

The system package is the framework-agnostic engine. Nothing in it imports React
or Svelte. Both bindings are thin: they own a state store and a renderer, and
hand the hard interaction math to the engine.

The engine's modules split into two families:

**Imperative interaction modules** — each attaches behavior to a DOM element,
listens to pointer events, and reports through callbacks. All expose
`update(params)` / `destroy()`:

- `XYPanZoom({ domNode, minZoom, maxZoom, viewport, translateExtent, onPanZoom,
onPanZoomStart, onPanZoomEnd, onDraggingChange })` → `PanZoomInstance` with
  `getViewport`, `setViewport`, `setViewportConstrained`, `scaleTo`, `scaleBy`,
  `syncViewport`, `setScaleExtent`, `setTranslateExtent`, `setClickDistance`,
  `update`, `destroy`. All three pan/zoom callbacks share one type:
  `OnPanZoom = (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void`
  — event first, viewport second. A one-argument handler silently receives the
  event, which is how a plan can write `onPanZoomEnd: (next) => …` and mean the
  viewport.
- `XYDrag({ getStoreItems, onDragStart, onDrag, onDragStop, onNodeMouseDown })` →
  `{ update(DragUpdateParams), destroy() }`.
- `XYHandle.onPointerDown(...)` — connection dragging, no persistent instance.
- `XYResizer`, `XYMiniMap` — same shape.

**Pure utilities** — usable without a store:

- Edge paths: `getBezierPath`, `getSmoothStepPath`, `getStraightPath`,
  `getSimpleBezierPath` → `[path, labelX, labelY, offsetX, offsetY]`.
- Viewport/bounds: `getViewportForBounds(bounds, width, height, minZoom, maxZoom,
padding)`, `getNodesBounds`, `getInternalNodesBounds`, `getBoundsOfRects`,
  `fitViewport` (async, needs a panZoom handle), `getPointerPosition`,
  `getEventPosition`, `snapPosition`, `clampPosition`.
- Graph: `getConnectedEdges`, `getIncomers`, `getOutgoers`, `getNodesInside`,
  `addEdge`, `isNode`, `isEdge`, `getNodeDimensions`.
- DOM reads: `getDimensions`, `getHandleBounds`, `getHostForElement`.
- **Store-shaped utilities**: `adoptUserNodes`, `updateAbsolutePositions`,
  `updateNodeInternals`, `updateConnectionLookup`. These take and **mutate**
  `Map`-based lookups (`nodeLookup`, `parentLookup`, `edgeLookup`,
  `connectionLookup`). They are not pure derivations.

## The one pattern that makes two bindings possible

The engine never imports a store. Every `XY*` module takes a getter:

```ts
XYDrag({
  getStoreItems: () => store.getState(),
  onDragStart,
  onDrag,
  onDragStop,
});
```

`getStoreItems()` must return a fairly wide record: `nodes`, `nodeLookup`,
`edges`, `nodeExtent`, `snapGrid`, `snapToGrid`, `nodeOrigin`,
`multiSelectionActive`, `transform`, `autoPanOnNodeDrag`, `nodesDraggable`,
`selectNodesOnDrag`, `nodeDragThreshold`, `panBy`, `unselectNodesAndEdges`,
`updateNodePositions`, and the drag callbacks. This is the single largest coupling
point in the whole system: `XYDrag` is only cheap to adopt if you already have a
mutable store with those actions.

`XYPanZoom` is the opposite — its params are a flat record of primitives plus
callbacks. It is cheap to adopt with no store at all.

## State: controlled props in, change unions out

React Flow is a **controlled** component. `StoreUpdater` copies the `nodes` and
`edges` props into an internal zustand store on every render; the renderer reads
only from the store. User gestures do not mutate the store's user-facing data —
they emit change objects:

```ts
type NodeChange =
  | NodeDimensionChange
  | NodePositionChange
  | NodeSelectionChange
  | NodeRemoveChange
  | NodeAddChange
  | NodeReplaceChange;
type EdgeChange =
  EdgeSelectionChange | EdgeRemoveChange | EdgeAddChange | EdgeReplaceChange;
```

The consumer reduces them: `onNodesChange: (changes) => setNodes(ns =>
applyNodeChanges(changes, ns))`. `useNodesState` is sugar for exactly that.
Svelte Flow keeps the same events but also offers two-way binding — its
component declares `let { nodes = $bindable([]), edges = $bindable([]), viewport
= $bindable(undefined) } = $props()` and its store writes back into those
bindings (`store.nodes = store.nodes.map(...)` in `updateNodePositions`).

So the two bindings agree on the _data_ contract (user-owned nodes/edges, change
events) and differ only in whether writes go back through a binding or out
through a callback.

## Rendering contract

Component tree (React, same shape in Svelte):

```
ReactFlow → Wrapper (provider) → createStore()
          → StoreUpdater            // props → store
          → GraphView → FlowRenderer  // keyboard shortcuts
            → ZoomPane → Pane         // XYPanZoom lives here
              → Viewport (one div, transform: translate(x,y) scale(z))
                → EdgeRenderer (one <svg>, one EdgeWrapper per edge)
                → ConnectionLine (only while connecting)
                → NodeRenderer (one NodeWrapper per node, div, XYDrag per node)
                  → user's node component → Handle(s) → XYHandle
            → Panel, MiniMap, Controls, Attribution, a11y nodelist
```

Details that matter for a re-implementation:

- **Transform is written to the DOM imperatively.** `Viewport` seeds the style
  from the store once, then a store subscription writes
  `viewportRef.current.style.transform` on change — explicitly "to keep React
  out of the hot path". Pan/zoom frames never re-render React components.
- **Edges come first in DOM order**, so nodes paint over edges.
- **Handles are located by DOM query**: `getHandleBounds(type, nodeElement,
nodeBounds, zoom, nodeId)` runs `nodeElement.querySelectorAll('.source' |
'.target')` and reads `data-handleid` and `data-handlepos`. Offsets are computed
  relative to the node rect **divided by zoom**, and sizes come from
  `getDimensions`, which is `offsetWidth`/`offsetHeight` — unaffected by CSS
  transforms. The result is therefore **node-local and zoom-invariant**, which is why
  a renderer can measure once per handle change rather than re-measuring on every
  zoom. Any renderer that wants the engine's connection math must reproduce
  `.source` / `.target` classes and those two data attributes.
- **Node measurement** is a `ResizeObserver` per node wrapper, which becomes a
  `dimensions` change and feeds `updateNodeInternals` → handle bounds. The observer
  fires on the node's own box only, so a renderer that can change its handle
  structure without changing that box needs another trigger (a mutation observer, or
  a declared-handle attribute the wrapper watches).
- **Pan/zoom class options are split from drag**: `PanZoomUpdateOptions` carries
  `noPanClassName`, `noWheelClassName`, `preventScrolling`, `panActivationKeyPressed`,
  `paneClickDistance`, `selectionOnDrag` and `onPaneContextMenu` — but no
  `noDragClassName`. Drag suppression belongs to `XYDrag`, which a renderer that owns
  node dragging itself does not use. `panActivationKeyPressed` means "pan is
  currently allowed", not "pan is happening".
- **User nodes are copied into `InternalNode`s** (`adoptUserNodes`) that add
  `measured`, `internals.positionAbsolute`, `internals.z`,
  `internals.handleBounds`, and a pointer back to the user object. The renderer
  only ever reads internals.
- **CSS is per-binding**: class prefixes (`react-flow__*` vs whatever Svelte uses)
  live in each package's own stylesheet.

## Consequences for a third binding

1. There is no framework-neutral renderer to reuse. Each binding writes its own
   node/edge/panel rendering; only math and interaction modules are shared.
2. `XYPanZoom`, `XYResizer`, `XYMiniMap`-style modules and all pure path/bounds
   math transfer cleanly to any framework, including one with explicit state.
3. `XYDrag` and `XYHandle` are usable only by adopting a mutable store shim.
   `XYHandle.onPointerDown` needs `getStoreItems` for the node/handle lookups
   mid-drag; `XYDrag` additionally needs `updateNodePositions`,
   `unselectNodesAndEdges`, and `panBy` actions.
4. `adoptUserNodes` / `updateAbsolutePositions` mutate `Map`s. A framework with
   immutable state must either rebuild those maps (allocation per render) or keep
   a mutable shadow store — i.e. re-create the store the framework is designed to
   remove.
5. Licence and identity: all three packages are MIT (verified on npm:
   `@xyflow/system` 0.0.84, `@xyflow/react` 12.12.1, `@xyflow/svelte` 1.7.1), and
   attribution removal is a Pro benefit for their components rather than a licence
   term. **Decision for this project:** depend on the engine only, write our own CSS
   and chrome, ship no attribution component (PLAN §2.4).

## Sources

- https://github.com/xyflow/xyflow/tree/main/packages/system (README)
- https://serawi.com/blog/2026-09-29-react-flow-overview (component tree, store
  shape, `getStoreItems` pattern, with file/line references)
- `packages/react/src/container/Viewport/index.tsx` (imperative transform write)
- `packages/react/src/components/StoreUpdater/index.tsx` (props → store)
- `packages/svelte/src/lib/store/index.ts`, `container/SvelteFlow/SvelteFlow.svelte`
  (`$bindable` nodes/edges/viewport, `updateNodePositions` writing back)
- `packages/system/src/utils/dom.ts` (handle DOM contract), `utils/store.ts`
  (`adoptUserNodes` signature), `xypanzoom/XYPanZoom.ts`, `xydrag/XYDrag.ts`
- https://reactflow.dev/api-reference/utils/apply-node-changes,
  https://reactflow.dev/learn/advanced-use/state-management,
  https://svelteflow.dev/api-reference/svelte-flow
