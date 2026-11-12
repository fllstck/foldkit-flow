# M6 research: the eleven deliberate gaps, decided

`PLAN.md` §7 M6 asks for one thing before any code: the eleven gaps M4 left behind,
each answered from primary sources, each ending in a verdict. This is that document.
The code that follows it is `docs/M6-FINDINGS.md`'s subject; this file is the decision.

**Read 2026-11-12.** Everything below is dated, and the dates matter: two of the
gaps changed shape between the milestone that named them and today.

## Method, and how it was applied

The plan's six rules, and what each one meant in practice:

1. **Primary sources only.** The pinned engine is the artifact this library actually
   runs against, so it is the first source for every claim: `@xyflow/system@0.0.84`
   (published **2026-11-02T09:55:10Z**, npm `dist-tags.latest` as of
   **2026-11-08T12:01:42Z**), whose bundled ESM (`dist/esm/index.js`, cited below by
   line) is what `runtime/adapter.ts` type-checks against. The wrapper sources are
   the pinned `@xyflow/react@12.12.1` (**2026-11-02T09:56:13Z**) and
   `@xyflow/svelte@1.7.1` (**2026-11-02T09:53:58Z**) in
   `packages/benchmark/node_modules`. All three were published from one release
   commit, and the repository's newest commit is that release (**`1bc405cd`,
   2026-11-02T09:52:15Z**) — so the pin is upstream HEAD, not a lagging version.
2. **Documentation is a claim, not the answer.** The API-reference pages
   (`reactflow.dev`) are all stamped _Last updated on October 11, 2026_; where one
   disagrees with the pinned source the disagreement is recorded (§4).
3. **A second implementation per point.** tldraw, Cytoscape.js, JointJS, Excalidraw,
   and — where the library world has nothing — the platform guidance (W3C APG, MDN,
   the CSS `pointer-events` values). The point is to separate "how xyflow does it"
   from "what the problem is".
4. **Two dated sources per factual claim.** The pinned source (with its registry
   date) plus one of: an issue or PR with its timestamps, a release note, a docs page
   with its stamp, or a spec page with its last-modified date. Live pages that carry
   no stamp are marked _fetched 2026-11-12_.
5. **What the sources cannot settle is measured.** Two claims could only be settled
   by running this repo's own protocol: the cost of the culling scan (§1) and the
   frame distribution at 10k. Both numbers are from `packages/benchmark/results/`;
   the run in this milestone is in `docs/M6-FINDINGS.md` §2.
6. **Behaviour, never look.** Nothing here proposes an upstream stylesheet, an
   upstream component or an attribution component. Where a mechanism is adopted
   (the edge hit path, the aspect lock) the geometry is re-derived in this library's
   own terms and the visual result is ours (`PLAN.md` §2.4).

## Verdicts

| #   | Gap                                                  | Verdict              | One line                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | The culling scan                                     | **Keep out**         | 0.9 ms of a 16.7 ms frame at 1k and 5.5 ms at an expanded 10k, with pan p95 at 16.8 and zero long frames: an index would buy nothing measurable and cost a rebuild per measurement.                                                 |
| 3   | Edge selection                                       | **Ship**             | A press on an edge selects it, through an invisible hit path at a fixed flow-space width, with the edges layer still below the nodes.                                                                                               |
| 11  | Edge focus and the tab order                         | **Ship**             | Edges become real tab stops with a role, a name and Enter/Space, because an edge you can select but not focus is half a feature.                                                                                                    |
| 1   | `XYResizer`                                          | **Keep out**         | Its `getStoreItems()` is read per drag event and its node lookup is walked per gesture start; the Mount seam has neither. Our gesture stays; one piece of its geometry is adopted under #6.                                         |
| 2   | Minimap interaction                                  | **Ship differently** | Click **and** drag (upstream's `pannable`), **not** wheel and not per-node targets (upstream defaults both off).                                                                                                                    |
| 4   | `nodeOrigin`                                         | **Keep out**         | Every position here is a property of the graph alone; an origin makes it a property of the graph _and_ a measurement, so the first paint could not be drawn from the Model.                                                         |
| 5   | Parent resize re-placing children                    | **Keep out**         | The compensation is one pure function, but it is only correct if the _consumer_ applies the child positions we would have to report; a consumer that does not would watch the children snap back on release — the M4 §14 bug again. |
| 6   | `keepAspectRatio`, `resizeDirection`, `shouldResize` | **Ship differently** | Aspect locking as a held modifier, not a renderer prop: upstream binds nothing, tldraw binds Shift, and our config has no per-node surface. Edge controls and `shouldResize` stay out.                                              |
| 7   | Interactive edge labels                              | **Keep out**         | An interactive label is a control, and a control in this library is a node. What would change it is written down with the exact shape.                                                                                              |
| 8   | Multi-node resize                                    | **Keep out**         | Upstream has no precedent; tldraw's answer is a second resize _mode_ with its own semantics for non-resizable shapes. One box per gesture, documented.                                                                              |
| 9   | Handle geometry during a resize                      | **Keep out**         | Upstream re-measures from its own `ResizeObserver` too, so the one-frame lag is the same lag; the fix available to us is a pure re-derivation that cannot be exact for consumer CSS.                                                |

---

## 1. The culling scan (item 10)

**The question.** How the wrappers cull, what other libraries use for the same job,
and whether an index, a coarser cadence, or both is the right fix at 10k.

### What the pinned source does

React Flow culls through a **store selector**, not a spatial structure:

- `useVisibleNodeIds` (`@xyflow/react@12.12.1` `dist/esm/index.js:2141`) reads
  `selector$c(onlyRenderVisible)` through `useStore(…, shallow)`. The selector
  (`:2129`) is `onlyRenderVisible ? getNodesInside(s.nodeLookup, {x:0,y:0,width,height},
s.transform, true).map(node => node.id) : Array.from(s.nodeLookup.keys())`.
- `getNodesInside` (`@xyflow/system@0.0.84` `dist/esm/index.js:320`) iterates **every**
  node in the lookup, computes an overlapping area against the viewport rect, and
  keeps a node when it is fully inside (`overlappingArea >= area`) — or partially
  inside when `partially` is true, which is what culling passes. Two escape hatches
  are worth copying: `forceInitialRender = !node.internals.handleBounds` (an
  unmeasured node always renders) and `node.dragging` (a dragged node always
  renders).
- Edges: `useVisibleEdgeIds` (`index.js:2420`) loops every edge and calls
  `isEdgeVisible` (`@xyflow/system` `index.js:1075`), which builds the union box of
  the two endpoint nodes and tests overlap. Same shape as this library's `edgeBox`
  in `geometry/visible.ts`.
- So the scan is **O(N) per selector evaluation**, and `useStore`'s `shallow`
  comparison does not prevent the _work_, only the re-render.

Svelte Flow does the same in a `$derived`: `store/initial-store.svelte.js` declares
`visible = $derived.by(...)` over `[nodes, _edges, nodeLookup, viewport, width,
height]`, and `store/visibleElements.js` has `getVisibleNodes` (→ `getNodesInside`,
`partially = true`) and `getLayoutedEdges` (→ `isEdgeVisible`), with one addition
worth noting: a `previousEdges` reuse map keeps an edge object when
`edge === previous.edge && sourceNode == previous.sourceNode && targetNode ==
previous.targetNode`. That is a per-edge memo, not an index.

**Where the docs and the source disagree.** None — but the _emphasis_ is a finding.
`reactflow.dev/learn/advanced-use/performance` (_Last updated on October 11, 2026_)
recommends four things for large graphs: memoize components, memoize functions, do
not read the store's `nodes` array in components, collapse large node trees, and
simplify node/edge styles. **`onlyRenderVisibleElements` is not among them.**
Upstream's _documented_ answer to a large graph is structural, which is what
`PLAN.md` §9 decision 4 already says.

### A second implementation

tldraw threw the O(n) scan out and put an R-tree (RBush) underneath — and then spent
two releases making the index's _maintenance_ cheap:

- PR **#3439**, merged **2024-04-15**: "integrate RBush for spatial querying and
  culling … Culling. Helps a lot with panning as we don't have to compute the culled
  shapes from scratch. Instead we just query rbush again."
- PR **#7676**, merged **2026-01-16**: `SpatialIndexManager`, "O(log n) spatial
  queries instead of O(n) iteration"; shipped in **v4.4.0**
  (`tldraw.dev/releases/v4.4.0`).
- Issue **#8882** → PR **#9093**, merged **2026-07-01**: "Previously every shape diff
  (i.e. every pointer move during a drag) iterated all indexed shapes and pulled
  their page bounds to catch derived-bounds changes — O(page) work per update." The
  fix is a structural dirty set, "O(affected) per update".

That last item is the finding that decides this row. An index buys a query cost and
charges a maintenance cost, and in our geometry the index's key — absolute position
plus measured size — changes exactly when either the parent's graph or the
measurement changes. Both happen per dispatch, so a memoized index would be rebuilt
during a drag, every time a `MeasuredNode` lands, which is the case tldraw had to
engineer around twice.

### What the sources cannot settle: the numbers

Measured with this repo's own protocol (`BENCHMARKS.md`), at the commit that carries
this file; the full run is in `docs/M6-FINDINGS.md` §2.

| Fixture            | `cullScanMs` per call | pan median / p95 / longest | long frames |
| ------------------ | --------------------- | -------------------------- | ----------- |
| 625                | 0.48                  | 16.7 / 16.7 / 16.8         | 0           |
| 1k culled          | 0.88                  | 16.7 / 16.8 / 16.8         | 0           |
| 1k culled + chrome | 0.69                  | 16.7 / 16.8 / 16.8         | 0           |
| 10k collapsed      | 3.29                  | 16.7 / 16.8 / 16.8         | 0           |
| 10k expanded       | 5.51                  | 16.7 / 16.8 / 33.4         | 0           |

The scan is 3 % of a frame at 625, 5 % at 1k, and 32 % at an expanded 10k — where the
frame still lands at 16.8 ms p95 with zero long frames. The number that is _not_ a
frame cost is the one that hurts at 10k: **1.19 s to settle**, because the first
render happens before the pane is measured, so culling is off for it and all 10,000
nodes mount before the measurement trims the DOM to 280.

### Verdict — **keep out**

- The scan is inside the frame at every size this project can measure, and the gate
  at 1k (p95 < 33 ms) passes with a factor of two of headroom. An index would be
  complexity bought with no number.
- A coarser cadence (recompute every K frames) would be _visible_: our overscan is
  one screen, and delaying the scan means a node entering it late gets inserted a
  frame or two before it is needed. Upstream recomputes per frame for the same
  reason.
- What would change this: a graph where the scan alone exceeds ~8 ms on the target
  machine (≈16k nodes at today's per-node cost), or a viewport whose overscan is
  many screens, which would turn `O(N)` into `O(N × screens)`.
- **What is written down instead**: the 10k cost is _startup_, not the scan. It is
  not on M6's list, so it goes to `docs/M6-FINDINGS.md` §7 as a candidate with its
  number, not into code.

---

## 2. Edge selection and edge focus (items 3 and 11, one unit)

**The questions.** For 3: `interactionWidth` and its default, the `pointer-events`
history of the invisible helper path, how selection happens without lifting the edges
layer above the nodes, and `elementsSelectable`. For 11: `nodesFocusable`,
`edgesFocusable`, `disableKeyboardA11y`, the `aria` labels upstream emits, and how
focus order is decided across both kinds of element.

### The hit path, and why it is a path

`BaseEdge` (`@xyflow/react@12.12.1` `dist/esm/index.js:2587`) renders **two** paths:
the visible one, and — when `interactionWidth` is non-zero — a second one with the
same `d`, `fill: none`, `strokeOpacity: 0`, `strokeWidth: interactionWidth`, and
`className: react-flow__edge-interaction`. `interactionWidth` **defaults to 20**
(`:2587`; the api-reference page for `<BaseEdge>` agrees, _2026-10-11_).

The layering is CSS, not DOM order. `@xyflow/react@12.12.1` `dist/style.css`:

- `.react-flow .react-flow__edges svg { pointer-events: none; }` — the edges layer is
  transparent to the pointer as a whole.
- `.react-flow__edge { pointer-events: visibleStroke; }` — each edge re-enables
  _only its own stroke_.
- `.react-flow__edge.inactive { pointer-events: none; }` and
  `.react-flow__edge.selectable { cursor: pointer; }`.

So the edges layer never needs to be lifted above the nodes: an `<svg>` that ignores
the pointer cannot intercept a press meant for a node, and the one path that wants a
press says so. That is the whole mechanism, and it is five lines of CSS.

**The history is the argument for the second path.** Issue **#1211** (opened
**2021-05-20**) is "a way to increase select-ability size of edges". On **2021-05-27**
a maintainer answered: _"We changed the pointer-events of the edges to visiblestroke.
That was a bad idea.. I will look into it."_ On **2021-07-20** a contributor posted
the workaround the ecosystem then used — two paths, one transparent with
`stroke-width: 28`. On **2022-01-12** the maintainer called that "the preferred
solution" and closed the issue; on **2022-10-20** a commenter found
`interactionWidth` in the source and the maintainer confirmed _"We added this feature
in v11"_. Issue **#3127** (**2023-06-09** → closed **2023-06-30**) is the counterpart:
`interactionWidth` "not honoured" until `pointer-events: all` — closed as a
third-party stylesheet setting `pointer-events` on the parent `<g>`. Both halves of
the lesson: the fat invisible path is the mechanism, and `pointer-events` inheritance
is what silently breaks it.

Selection itself is one line in the wrapper: `isSelectable = edge.selectable ||
(elementsSelectable && edge.selectable === undefined)` (`index.js:2936`), and a press
calls `addSelectedEdges([id])` (`:2985`).

### The tab order

The pinned source (`index.js:3043`) puts on the edge's `<g>`:

- `tabIndex: isFocusable ? 0 : undefined`, where
  `isFocusable = edge.focusable || (edgesFocusable && edge.focusable === undefined)`
  (`:2936`) — **`edgesFocusable` defaults true**;
- `role: edge.ariaRole ?? (isFocusable ? 'group' : 'img')`,
  `aria-roledescription: 'edge'`;
- `aria-label: 'Edge from <source> to <target>'` unless the edge sets one;
- `aria-describedby` → a hidden description element, and an `onKeyDown` gated by
  `disableKeyboardA11y` that acts on `elementSelectionKeys` =
  `['Enter', ' ', 'Escape']` (`@xyflow/system` `index.js:28`) — Enter/Space select,
  Escape clears and blurs.

`reactflow.dev/learn/advanced-use/accessibility` (_2026-10-11_) states the intent:
"By default, all nodes and edges are keyboard-focusable and operable… Pressing Tab
moves focus through all focusable nodes and edges. These elements receive
`tabIndex={0}` and, by default, `role="group"`".

**How focus order is decided**: by the DOM, and the edges layer renders **before** the
nodes layer — so in React Flow the tab sequence is _all edges, then all nodes_. That
is not a bug; it is what "DOM order is tab order" means, and it is why the wrapper
exposes `edgesFocusable` / `disableKeyboardA11y` as an escape hatch for a consumer
with 1,000 edges.

### A second implementation

For the hit path, canvas libraries do not use a path at all: Cytoscape.js hit-tests in
the canvas with a style-level tolerance — `overlay-padding`, documented on
`js.cytoscape.org` (_fetched 2026-11-12_) as "the area outside of the element within
which the overlay is shown", which is also the selection/hover tolerance. A tolerance
around a geometric primitive is the same idea as a fattened stroke; what differs is
that a canvas never has to answer a `pointer-events` question.

For the tab order, the library world has nothing comparable on canvas (a canvas
element cannot be a tab stop), so the second source is the platform: W3C **ARIA
Authoring Practices, "Developing a Keyboard Interface"** (_fetched 2026-11-12_) — "The
default order of elements in the tab sequence is the order of elements in the DOM… It
is important to keep the keyboard tab sequence and the screen reader reading order
[consistent]", and the composite-widget rule (one tab stop for a composite, arrow
keys inside). Both are directly actionable here: our tab order is DOM order, and a
graph is _not_ a composite widget with one tab stop in either library — that question
is out of scope for M6 and is recorded as such in `docs/M6-FINDINGS.md` §7.

### Verdict — **ship**, both, as one unit

- **Ship** a press target per edge: an invisible interaction path at a **fixed
  flow-space width** (20 — the same number upstream defaults to), because a
  zoom-dependent width would invalidate the edge memo per viewport frame, and because
  the geometry it sits on is flow-space anyway.
- **Ship differently** from upstream on three points, each for a reason this library
  already has:
  1. **Opt-in per renderer** (`edgeSelection: true`), like every other behaviour here
     (`resize`, `cull`, `reconnect`). The gate pages configure nothing, so the gate's
     DOM is unchanged; and a consumer that does not delete edges should not pay an
     extra element per edge.
  2. `pointer-events: stroke` on the _interaction path itself_ rather than
     `visibleStroke` on the group, so a consumer stylesheet cannot make the group
     inherit the wrong value (#3127 is the exact failure).
  3. `role="button"` + `aria-pressed` for an edge, matching this library's nodes
     rather than upstream's `role="group"`. A press selects; `aria-pressed` says so,
     and it is the one thing a screen reader needs in this graph.
- The edges svg loses `aria-hidden="true"` when `edgeSelection` is on — a focusable
  descendant of an `aria-hidden` subtree is an ARIA violation, so the attribute has
  to move with the feature. With the feature off, the layer stays hidden as it is
  today.
- Tab order stays DOM order: edges (rendered before nodes) then nodes. Documented,
  not fixed.

---

## 3. `XYResizer` (item 1)

**The question.** Can its `getStoreItems` be satisfied without a reactive store —
what do the wrappers pass, must `update()` be re-called per render, what happens if the
box changes mid-gesture, and did anything change after 0.0.84?

### The seam

`XYResizer({ domNode, nodeId, getStoreItems, onChange, onEnd })`
(`@xyflow/system@0.0.84` `dist/esm/index.js:3426`), and
`update({ controlPosition, boundaries, keepAspectRatio, resizeDirection,
onResizeStart, onResize, onResizeEnd, shouldResize })`.

`getStoreItems()` must return `{ nodeLookup, transform, snapGrid, snapToGrid,
nodeOrigin, paneDomNode }` (`xyresizer/XYResizer.d.ts`). It is called **twice, at two
different rates**:

- **at drag start** (`index.js:3456`) — the full record, plus a walk of the entire
  `nodeLookup` to collect the node's children (`:3499`–`:3519`);
- **on every drag event** (`:3521`) — `transform`, `snapGrid`, `snapToGrid`,
  `nodeOrigin`.

And `update()` is the reactive seam: React's `ResizeControl` calls
`resizer.current.update({…})` from a `useEffect` whose dependencies are the control's
props (`@xyflow/react` `index.js:4966`–`:4979`). So a live resizer is two live
channels: a callback _into_ the store on every frame, and a prop bag pushed _in_ on
every prop change.

**A mid-gesture box change is not observed.** `prevValues` and `startValues` are
closure-local (`:3440`), and the only per-frame reads are the transform and the snap
grid — so if the node's box changes during a gesture for any other reason, the
resizer overwrites it with its own arithmetic rather than re-deriving.

**A real inconsistency in the pinned wrapper**: `resizeDirection` is passed into
`update()` (`index.js:4960`) but is _missing from the effect's dependency array_
(`:4975`–`:4979`), so changing it alone does not re-run `update`.

### Did anything change after 0.0.84?

No. `@xyflow/system@0.0.84` was published **2026-11-02T09:55:10Z** and is still
`dist-tags.latest` (**2026-11-08T12:01:42Z**); the repository's newest commit is that
same release (**`1bc405cd`, 2026-11-02**); and the last commit touching
`packages/system/src/xyresizer` is **`a87e24b7`, 2026-09-02** ("onResizeEnd should
fire after onResizeStart and if shouldResize returns false…"). The next line
(`1.0.0-next.7`) is a prerelease and is not what a consumer installs.

### A second implementation

tldraw's `Resizing.ts` (`packages/tldraw/src/lib/tools/SelectTool/childStates/`, last
touched **`1a0d13d5`, 2026-10-02**) does what this library already does: a
**snapshot** at gesture start ("captures initial bounds, page transforms, aspect
ratios, and selection rotation for all selected shapes", per the design notes in
issue **#8226**), then pure per-frame math from the snapshot. It reads live modifier
state per frame (`isAspectRatioLocked = shiftKey || !canShapesDeform`) but never
consults a store for the geometry the gesture started with.

### Verdict — **keep out** (our gesture stays)

- `getStoreItems` cannot be satisfied from a Mount: Mount args are captured at mount
  and never re-evaluated (`docs/foldkit-constraints.md`), and `view` may not write.
  The two channels `XYResizer` needs — three store reads per frame plus a full node
  lookup per press — are exactly what §2.5.1 forbids this library from having.
- The snapshot design is not a workaround; it is the design tldraw also chose, and it
  is what `geometry/resize.ts` already implements (`docs/M4-FINDINGS.md` §2.6).
- **Adopted from it, into our own geometry**: the aspect-ratio arithmetic — §7.
- What would change this: a harness in which a Mount can read a live graph — which
  would mean a mutable second source of truth, i.e. a different library.

---

## 4. Minimap interaction (item 2)

**The question.** The semantics of `pannable`, `zoomable`, `onClick(event, position)`,
`onNodeClick`, `inversePan`, `zoomStep`, `offsetScale`; how `XYMinimap` handles
pointer identity, cancel and the viewBox→flow mapping; what a screen reader should be
told.

### The pinned mechanism

`XYMinimap({ domNode, panZoom, getTransform, getViewScale })` and
`update({ translateExtent, width, height, zoomStep = 1, pannable = true, zoomable =
true, inversePan = false })` (`xyminimap/index.d.ts`; `dist/esm/index.js:2675`).

It does **not** implement a gesture. It attaches **d3-zoom to the minimap element**
(`:2730`–`:2738`), and reads three events out of d3:

- `start` (`:2687`): records `panStart` from `mousedown`/`touchstart` client
  coordinates.
- `zoom` (`:2700`): on `mousemove`/`touchmove`, `panDelta = current − panStart`, then
  `moveScale = getViewScale() * Math.max(zoom, Math.log(zoom)) * (inversePan ? −1 : 1)`
  and `panZoom.setViewportConstrained({x: transform.x − panDelta.x·moveScale, …},
[[0,0],[width,height]], translateExtent)`. **Relative** panning, with a scale
  factor that grows slightly faster than the zoom.
- `zoom.wheel` (`:2677`): `nextZoom = zoom · 2^(pinchDelta · zoomStep · factor)` via
  `panZoom.scaleTo(nextZoom)` — centre-anchored, no point.

Pointer identity and cancel are **delegated to d3-zoom**, which is why there is
nothing about `pointerId` anywhere in `XYMinimap`: it never sees a raw pointerdown.

The **viewBox→flow mapping is the wrapper's**, not the engine's: React's `MiniMap`
computes `viewScale = max(boundingRect.width / elementWidth, boundingRect.height /
elementHeight)`, a padded `viewBox`, and passes `getViewScale: () => viewScale`
(`@xyflow/react` `index.js:4758`–`:4795`). `onClick(event, position)` hands the
consumer `d3-selection`'s `pointer(event)` — the point **in viewBox units**, which for
this component _is_ flow space (`:4796`–`:4801`).

**Props, from the source**: `pannable = false`, `zoomable = false`, `zoomStep = 1`,
`offsetScale = 5` (`index.js:4751`). The `<MiniMap>` api-reference page
(_2026-10-11_) agrees on `pannable`/`zoomable`/`offsetScale` and says **`zoomStep`
defaults to 10**. The pinned source says 1. Documentation is a claim; the source
wins, and a consumer reading the docs would ship a 10× faster minimap zoom. The
semantics of the props are as read above: `pannable` = drag pans, `zoomable` = wheel
zooms, `inversePan` = invert the drag direction, `offsetScale` = viewBox padding,
`onNodeClick` = a press on a node rectangle (`:4802`).

**A11y**: the minimap `<svg>` is `role="img"` with `aria-labelledby` pointing at a
`<title>` whose default text is "Mini Map" (`:4817`, and `defaultAriaLabelConfig` in
`@xyflow/system` `index.js:41`). So: announced as **an image with a name**, not as a
control — even when `pannable` is on.

**A history worth one line**: `pannable`/`zoomable` arrived together in
**`a96044b`, 2022-11-01** ("add pannable and zoomable props, remove
interactive-minimap package") — before that, interaction was a separate package.
Both default to `false` because the interaction is opt-in.

### A second implementation

JointJS's `<Navigator>` (docs v4.3, _fetched 2026-11-12_): "Minimap that shows a
bird's-eye overview of the paper and lets users pan (and optionally drag-zoom) the
main viewport by interacting with it. For speed it draws every element and link as a
single simplified SVG path instead of your real React views". Its `zoom` prop
("Enables drag-to-zoom on the minimap") **defaults to false**, and its pan is
unconditional. Same split as upstream: **pan is the interaction, zoom is the extra
one nobody enables by default.** (Our minimap already draws one `<rect>` per node
rather than one path — a difference of cost, not of semantics; at 1k that is 1,000
rects, and `BENCHMARKS.md` measures the chrome leg at 0.69 ms of scan and no long
frames.)

### Verdict — **ship differently**

- **Ship**: click-to-centre (already there) **and** drag-to-pan.
- **Ship differently** from upstream, in three stated ways:
  1. **A Flow gesture, not an engine gesture.** There is no pan/zoom handle for the
     minimap to drive — our viewport is a Model value plus one `SyncViewport`
     Command — so the drag is `Message.StartedMiniMapPan` → `Gesture.MiniMapPanning`
     → one `setViewport` per pointer move, through the same clamp and Command as
     every other programmatic move. The mapping is read **once**, at press, from the
     SVG's own `getScreenCTM()` — the same seam `miniMapFlowPoint` already uses —
     and the gesture carries the resulting _flow point_ and _scale_, so nothing
     after the press reads the DOM.
  2. **Absolute from the anchor, not accumulated.** The pan is
     `viewportCentredOn(anchorFlow)` shifted by `−(pointer − anchorScreen)·scale`:
     no drift, and a pure function of the gesture.
  3. **No wheel, and no per-node press target.** `zoomable` is off upstream by
     default, this library already has zoom controls, and a wheel handler on a
     chrome element fights the page's scroll; `onNodeClick` exists upstream because a
     minimap press there _does not_ centre (their pan is relative), whereas ours
     already centres on the pressed point — pressing a node in the minimap already
     takes you to it. Both are recorded as not shipped rather than half-built.
- **A11y**: the minimap stays `aria-hidden`. That is _better_ than upstream's
  `role="img"`-with-a-name for this library, because our description region already
  names the graph in words, and a picture that is also a control is a control with
  no keyboard path. The interaction is a redundant, faster path to something the
  keyboard can already do (`Controls`' zoom buttons, and the description).

---

## 5. `nodeOrigin` (item 4)

**The question.** Flow-level and per-node `origin`; how an origin interacts with
parent/child relative positions, `extent`, handle bounds and `getNodesBounds`; which
of our helpers would become origin-aware.

### What the pinned source does

- `getNodePositionWithOrigin(node, nodeOrigin)` (`@xyflow/system` `index.js:229`) =
  `node.position − (width·origin[0], height·origin[1])`, with
  `origin = node.origin ?? nodeOrigin` — a flow-level default and a per-node
  override.
- Children: `calculateChildXYZ` (`:1781`) computes
  `parent.positionAbsolute + getNodePositionWithOrigin(child, nodeOrigin)`, so a
  child's relative position is measured from the **parent's top-left**, and the
  _child's own_ origin shifts the child by its own size. The docs agree
  (`reactflow.dev/learn/layouting/sub-flows`, _2026-10-11_): "the child node is
  positioned relative to its parent. A position of `{ x: 0, y: 0 }` is the top left
  corner of the parent."
- Extent clamping is applied to the origin-adjusted position
  (`clampPosition(positionWithOrigin, extent, dimensions)` in
  `updateAbsolutePositions`, `:1628`), and `extent: 'parent'` clamps against the
  parent's box (`clampPositionToParent`).
- Bounds helpers take it too: `nodeToBox(node, nodeOrigin)`, `nodeToRect`,
  `getNodesBounds(nodes, { nodeOrigin })` (`:274`, `:567`, `:578`).
- **Handle bounds do not**: `getHandleBounds` measures the node element's own rect
  and divides by zoom, so handle geometry is origin-independent by construction.
- Every reader of a position needs the node's **size** before it can say where the
  node is. Upstream resolves that with `getNodeDimensions` (`:750`), falling back
  `measured → width → initialWidth → 0` — i.e. an unmeasured node is drawn at a
  position computed from a _guessed_ size, and it moves when the real one arrives.

`reactflow.dev/api-reference/types/node-origin` (_2026-10-11_): "`[0,0]` places it at
the top left corner, `[0.5,0.5]` right in the center and `[1,1]` at the bottom right
of its position."

### A second implementation

Cytoscape.js made the _other_ choice, globally: "A node's position refers to the
centre point of its body" (`js.cytoscape.org`, `#notation/position`, _fetched
2026-11-12_). Compound (parent/child) positions are also absolute rather than
relative — a difference tracked for years in issue **#530**, "Child nodes should be
able to be positioned relative to parent or origin" (opened 2015, still open at the
last update recorded on the issue). So a centre origin is not exotic; it is the
default in a library whose layouts also _produce_ centres.

### Verdict — **keep out**

- The decisive fact is architectural, not aesthetic: here, a node's absolute position
  is a property of the **graph alone**. `positionIndex(nodes)` is memoized on the
  nodes array and needs no measurement, which is why SSR can render the transform
  from the Model with no flash (`PLAN.md` §7 M0, proven since). An origin makes
  every position a function of the graph **and** a measurement, so an unmeasured
  node would be drawn at a guessed position — exactly the `measured → width → 0`
  fallback upstream lives with.
- The blast radius is every reader of a position: `positionIndex`, `nodeRect`,
  `nodeBounds`, `visibleNodes`, `visibleEdges`, the edge anchors (twelve call sites),
  hit-testing, the drag overlay, `resizeRect`, the minimap, the description and
  `fitViewport`. All of them would gain a size argument they do not have today.
- **The workaround, for a consumer who has centre coordinates** (a Cytoscape layout,
  an SVG with centre anchors): convert at the boundary —
  `position: { x: centre.x − size.width / 2, y: centre.y − size.height / 2 }` — and
  keep the flow's model top-left. It is one subtraction in the consumer's own code,
  against a size they already know because they drew the node.
- What would change it: a consumer whose positions _arrive_ centre-based and cannot
  be converted (a live collaboration stream keyed on centres), or a second product
  surface that needs a bottom-right anchor — plus a measured answer to "what does the
  first frame look like before measurement", which at 10k is a 280-node cull of a
  10,000-node graph, i.e. 9,720 nodes whose position would be a guess.

---

## 6. Parent resize re-placing children (item 5)

**The question.** `childChanges` from `XYResizer`, `extent: "parent"`,
`expandParent`, `nodeToChildExtent`; how children stay visually still when a parent's
top-left moves, and what happens to grandchildren.

### What the pinned source does

`XYResizer` collects the node's children **at drag start** (`index.js:3499`), and when
the parent's top-left moves (`isXPosChange || isYPosChange`) it emits a position
change per child (`:3552`–`:3575`):

```js
childNode.position = {
  x: childNode.position.x - xChange + nodeOrigin[0] * (width - prevWidth),
  y: childNode.position.y - yChange + nodeOrigin[1] * (height - prevHeight),
};
```

With the default origin `[0, 0]` this is `child.position -= (xChange, yChange)`: the
child's _relative_ position compensates exactly the distance the parent's top-left
moved, so it stays put on screen. Note what is **not** in the same pass: grandchildren.
They follow because their own parents did — the compensation is one level deep, and
each level's compensation is the consumer's to apply.

`extent: 'parent'` clamps the _child_ against the parent's measured box
(`clampPositionToParent`), and `expandParent` lets a _child_ drag grow its parent
(`handleExpandParent`, `:1800`), which is the opposite direction. `nodeToChildExtent`
(`:3479`) computes the extent a parent may shrink to before it would squeeze a
child — the resizer folds all children's extents into one (`childExtent`) and passes
it into the geometry.

The wrapper emits each child change as a `position` change in the same batch as the
parent's `dimensions` change (`@xyflow/react` `index.js:4924`–`:4932`), so the parent
reduces them with `applyNodeChanges` in one go and the consumer sees no intermediate
frame.

### A second implementation

tldraw does **not** compensate: a frame's children are positioned in page space, so
resizing a frame never moves them, and the frame's box is independent of its
contents. PR **#10491** (merged **2026-08-25**) is the closest analogue — "move
non-resizable shapes with the selection when resizing" — and it is about a
_selection_, not about parentage.

So the two implementations disagree, which is the useful part: compensation is a
choice about where the coordinate space lives, not a law.

### Verdict — **keep out at M6, taken in M7 as a helper**, documented as the parent's job

**Reversed in M7**, in the form this verdict itself asked for: the arithmetic ships as
`Flow.compensateChildPositions`, which **returns** the direct children's relative
positions and applies nothing — the consumer persists them, which is where the graph
is ([`M6-RESEARCH-FOLLOW-UP.md`](M6-RESEARCH-FOLLOW-UP.md) §4,
[`M7-FINDINGS.md`](M7-FINDINGS.md)). The reasoning below is why it is a return value
and not renderer behaviour.

- The compensation itself is trivial and pure — `releaseResize` could compute it in
  ten lines, and `positionIndex` already resolves the chain.
- What makes it a **keep out** is the consumer: the compensation is only _correct_ if
  the parent applies the child positions we report. A consumer that folds
  `ResizedNodes` and nothing else would see the children compensate during the
  gesture (the overlay) and snap back on the next render — the exact shape of the M4
  §14 report ("it only changes its visual size after I release the mouse button"),
  reintroduced by a feature. A library cannot ship a visual fact the consumer has no
  obligation to keep.
- **What the consumer writes instead** (and `docs/CONTRACT.md` now says): fold
  `ResizedNodes`, and for a node with children, subtract the parent's top-left delta
  from each child's `position` — the upstream formula above, verbatim. It is the
  _same_ arithmetic, in the one place that can persist it.
- What would change it: a `ResizedNodes` payload that carries child positions **and**
  a consumer that applies them; that is a public-surface change with a proof on two
  consumer pages, and it belongs to whoever needs containers with compensated
  children.

---

## 7. `keepAspectRatio`, `resizeDirection`, `shouldResize` (item 6)

**The question.** The control props `XYResizer` takes; whether upstream binds a
modifier for aspect locking; what `shouldResize` can veto.

### What the pinned source does

- `keepAspectRatio: boolean` and `resizeDirection?: 'horizontal' | 'vertical'` are
  **props of `update()`** (`xyresizer/XYResizer.d.ts`), i.e. they are pushed in and
  never read from the event. The geometry branch is in `getDimensionsAfterResize`
  (`index.js:3313`): the _other_ axis is clamped so `newWidth / aspectRatio` stays
  inside `minHeight`/`maxHeight`, and vice versa. `aspectRatio` is captured at drag
  start from the node's measured box (`:3481`).
- `resizeDirection` restricts which axis a control may write (`:3583`): `'horizontal'`
  writes only `width`, `'vertical'` only `height`. It came from issue **#2986**
  ("it's not possible to limit a control in the bottom-right corner to resize only
  horizontally"), landed in commit **`bee2f4aa`, 2025-04-17**.
- `shouldResize(event, params)` is called **per drag event** (`:3607`), and returning
  `false` rolls back to the last accepted values — parent box, start position _and_
  every child's position (`:3609`–`:3615`). It is a per-frame veto, not a one-time
  gate.
- **No modifier is bound anywhere.** The React prop table is
  `keepAspectRatio` / `shouldResize` / `onResizeStart` / `onResize` / `onResizeEnd`
  (`index.js:4848`, api-reference `<NodeResizer>`, _2026-10-11_, defaults
  `keepAspectRatio: false`), and no `event.shiftKey` reaches the resizer: the two
  `shiftKey` reads in the wrapper are the **zoom controls'** 4× step (`:2099`,
  `:2325`), not the resizer.

### A second implementation

tldraw binds the modifier: `Resizing.ts` computes
`isAspectRatioLocked = shiftKey || !canShapesDeform` per frame from live input, and
`BoundsSnaps.snapResizeShapes({ …, isAspectRatioLocked, isResizingFromCenter })`
threads both modifiers through the snapping pass. So: upstream makes it a
configuration, tldraw makes it a key, and both are defensible because they answer
different questions ("this node is always proportional" vs "this resize is
proportional").

### Verdict — **ship differently**

- **Ship aspect locking**, as a **held modifier** and not as a renderer prop.
  - Upstream's shape (a prop) does not fit: our `RendererConfig.resize` is one
    boolean for the whole pane, and adding a per-node "always proportional" would be
    a config surface with no consumer and no proof.
  - The modifier is already in the Model: `isAdditiveModifier` (Shift, Meta or
    Control) is folded by `ChangedModifierState` and read by `PressedNode`. A resize
    reading the same flag per pointer event is **live** — press or release the
    modifier mid-gesture and the box follows, which is what tldraw does — and costs
    no new Message, no new DOM read, and no new Model field.
  - The difference from upstream, stated: upstream's is per-control configuration,
    ours is a modifier on the gesture, applied from the box's _start_ aspect ratio.
- **Keep out `resizeDirection`**: our renderer already answers the same question
  differently and for a better-documented reason — the four corner controls exist
  precisely because the edge midpoints belong to the port handles
  (`M4-FINDINGS` §2.7). An axis-locked control is a fifth kind of press target with
  no place left to sit.
- **`shouldResize`: kept out at M6, reversed in M7 as `canResize`.** The reasoning
  below is left as it was written, because the reversal is a distinction and not a
  contradiction. Upstream's `shouldResize` is handed `{ node, start, next }` and
  returns either nothing (the frame stands) or a `Rect` to use instead — and that
  replacement is a second owner of the gesture: it moves the parent's box, its start
  position and every child's position
  (`@xyflow/system@0.0.84` `dist/esm/index.js:3607`–`:3615`). A **pure predicate**
  over the same inputs is not that: it is consumer policy, evaluated per pointer
  event, returning a boolean, and a rejected frame keeps the **last accepted** box.
  M7 ships it as `Context.canResize`, in the seam `isValidConnection` already
  occupies — see [`M6-RESEARCH-FOLLOW-UP.md`](M6-RESEARCH-FOLLOW-UP.md) §3,
  [`M6-RESEARCH-FOLLOW-UP-REVIEW.md`](M6-RESEARCH-FOLLOW-UP-REVIEW.md) §3 and
  [`M7-FINDINGS.md`](M7-FINDINGS.md).

  _(As M6 wrote it:)_ a per-frame veto callback is consumer code running inside a
  gesture loop, and the same policy is already expressible purely — a consumer who
  wants to refuse a box drops the `ResizedNodes` fact (the box is theirs to persist)
  or clamps it in its own `update`. A callback that can also rewrite the last accepted
  frame is a second owner of the gesture.

---

## 8. Interactive edge labels (item 7)

**The question.** How upstream labels are built: SVG text versus an HTML layer
(`EdgeLabelRenderer`, `nodrag nopan`), label backgrounds, and the `edge-toolbar` /
`node-toolbar` helpers the pinned package already exports.

### What the pinned source does

Three mechanisms, in increasing order of interactivity:

1. **SVG text with a background**, `EdgeText` → `<text>` plus a `<rect>` sized from
   `labelBgPadding` — the same halo idea this library uses, but measured rather than
   stroked (`@xyflow/react` `index.js:2587`'s label branch, and `EdgeText`).
2. **An HTML portal**: `<EdgeLabelRenderer>` renders into a `<div>` "positioned on top
   of the edges" (`reactflow.dev/api-reference/components/edge-label-renderer`,
   _2026-10-11_), with a stated default: _"The `<EdgeLabelRenderer />` has no pointer
   events by default. If you want to add mouse interactions you need to set the
   style `pointerEvents: 'all'` and add the `nopan` class on the label."_
3. **The engine's toolbar transform**: `getEdgeToolbarTransform(x, y, zoom, alignX,
alignY)` = `` `translate(${x}px, ${y}px) scale(${1 / zoom}) translate(-50%, -50%)` ``
   (`@xyflow/system` `index.js:1601`, exported as `utils/edge-toolbar.d.ts`) — the
   flow point, an inverse zoom to keep a constant screen size, and a centring
   translate. `node-toolbar` is the same helper for nodes.

So: an interactive label upstream is **HTML in a portal, on top of the edges layer,
with `pointer-events` re-enabled and pan/drag classes added by hand** — three
consumer obligations and one exported transform.

### A second implementation

Cytoscape.js renders labels **into the canvas**, and its answer to "should a label be
interactive" is a style flag, not a layer: `text-events` — "Whether events should
occur on an element if the label receives an event; may be `yes` or `no`" — alongside
`events` for the element itself (`js.cytoscape.org` `#style/events` and the label
section, _fetched 2026-11-12_). So a canvas library can make a label a _hit region_
and cannot make it a _control_: there is no element to put a button in. An
"interactive label" there is always an overlay positioned by hand — which is exactly
what the portal is. The two libraries converge on the same answer, which is a strong
signal that the mechanism is not incidental.

### Verdict — **keep out at M6, taken in M7**

**Taken in M7** as `RendererConfig.edgeOverlay`: an HTML layer inside the transformed
viewport, between the edges svg and the nodes div, anchored with
`translate(x, y) scale(1/zoom)`, consumer-owned markup, `fflow__nopan` and the
`data-fflow-overlay` guard for a press the pane must decline
([`M6-RESEARCH-FOLLOW-UP.md`](M6-RESEARCH-FOLLOW-UP.md) §2,
[`M6-RESEARCH-FOLLOW-UP-REVIEW.md`](M6-RESEARCH-FOLLOW-UP-REVIEW.md) §2,
[`M7-FINDINGS.md`](M7-FINDINGS.md)). `renderEdgeLabel` keeps its content-only
contract, which is the part of this verdict that still stands.

- An interactive label is a **control**, and this library already states where a
  control lives: "A label that is a control is a node" (`M4-FINDINGS` §8). Our
  `renderEdgeLabel(edge, h)` replaces the _content_ of an SVG `<text>`; making that
  content interactive means an HTML layer inside a transformed container, with
  `pointer-events` hygiene, a stacking rule against the nodes layer, and a decision
  about what a press on it means — a feature with a design, not a flag.
- What changed it: a consumer needed a press target on an edge, and the design is the
  one this section already described — a pane-level HTML layer anchored with
  `translate(x, y) scale(1/zoom)` (the arithmetic above), rendered from the
  consumer's own markup, not a widened `<text>`.

---

## 9. Multi-node resize (item 8)

**The question.** Any upstream precedent (group or selection-box resize); otherwise
how a second implementation transforms a multi-selection, and whether our
one-delta-per-gesture rule extends to boxes.

### What the pinned source does

`XYResizer` takes **one `nodeId`** (`xyresizer/XYResizer.d.ts`) and resizes that node.
React Flow's `NodeResizer` is mounted _inside_ a node, so a multi-selection resize is
not expressible without one resizer per selected node — and there is no
selection-box resizer in any of the three packages (the selection-level feature is
`SelectionMode`, which is about box _selection_).

### A second implementation

tldraw treats multi-resize as a **separate mode with its own semantics**:

- `TLResizeMode` is `'resize_bounds' | 'scale_shape'`, documented as: _"'scale_shape'
  — The shape is being scaled, usually as part of a larger selection. 'resize_bounds'
  — The user is directly manipulating an individual shape's bounds using a resize
  handle. It is up to shape util implementers to decide how they want to handle the
  two situations."_ (`tldraw.dev/reference/editor/TLResizeMode`, _fetched 2026-11-12_)
- The gesture snapshots **per shape** (bounds, page transform, aspect ratio, rotation
  — issue **#8226**'s research notes) and, since PR **#10491** (merged **2026-08-25**),
  moves non-resizable shapes with the selection instead of leaving them behind.
- `Editor.resizeToBounds` (PR **#8120**, merged **2026-03-03**) is the programmatic
  version, and has to handle bound arrows, parent transforms and aspect locking.

### Verdict — **keep out**; the single-node rule is permanent, and documented

- The evidence is that multi-resize is not "the same gesture with more nodes": it is
  a mode, and its hard parts are exactly the ones this library refuses to have —
  per-shape `scale` callbacks (our `renderNode` gets `tools.size`, not a transform),
  mixed resizable/non-resizable selections, rotation (we have none), and bound
  relationships (we have none).
- Our one-delta-per-gesture rule does **not** extend: a box gesture would need a
  delta _and_ two scales per node, and a consumer whose content is layout-driven
  would have to scale its own typography anyway.
- What would change it: a consumer with containers that wants a selection-box resize,
  in which case the honest shape is `ResizedNodes` carrying a transformed box per node
  (a scale per node, not a delta) plus a `NodeTools.scale` — a new public surface with
  a design, not a fifth control.

---

## 10. Handle geometry during a resize (item 9)

**The question.** How the wrappers keep edge endpoints correct while a box changes:
when `getHandleBounds` re-runs, what `updateNodeInternals` / `useUpdateNodeInternals`
exist for, and whether upstream is actually lag-free.

### What the pinned source does

- `getHandleBounds(type, nodeElement, nodeBounds, zoom, nodeId)` queries the DOM
  (`.source`/`.target`, `data-handleid`, `data-handlepos`) and divides offsets by
  zoom; sizes come from `getDimensions` (`offsetWidth`/`offsetHeight`), which a CSS
  transform does not affect — so the result is node-local and zoom-invariant.
- It runs from **`updateNodeInternals`**, which React Flow calls from its node
  `ResizeObserver` with `force: true` (`@xyflow/react` `index.js:2147`–`:2163`), and
  from the `useUpdateNodeInternals()` hook for programmatic handle changes:
  _"When you programmatically add or remove handles to a node or update a node's
  handle position, you need to let React Flow know about it"_
  (`reactflow.dev/api-reference/hooks/use-update-node-internals`, _2026-10-11_).
- So during a resize the sequence is: `onChange` writes `dimensions` into the store →
  React renders the new box → the browser lays out → the `ResizeObserver` fires →
  `updateNodeInternals` re-reads the handles → edges re-render from the new
  `handleBounds`. **The endpoints are one observer tick behind the box.** Upstream is
  not lag-free; it has the same shape of lag and a documented hook for the case it
  cannot observe.

### The timing, from the platform

MDN, `ResizeObserver` (_last modified Nov 7, 2025_): "Implementations following the
specification invoke resize events **before paint** (that is, before the frame is
presented to the user)." So an observer-driven re-measure in the same frame is
possible in principle — which locates this library's lag precisely: it is not the
observer and not paint, it is our **coalescer**. `runtime/mountNode.ts` schedules
`flush` on `requestAnimationFrame`, deliberately (one measurement per frame, §2.5.3),
so a box that changes during frame _n_ is measured at the start of frame _n+1_.

### A second implementation

Cytoscape.js has no measurement step to lag: a node's box is a **style** value
(`width`, `height` — "The width of the node's body", `documentation/md/style.md`),
and an edge's endpoints are derived from those values when the canvas is drawn, so
there is nothing to re-measure and nothing to fall behind. That is the alternative in
one sentence — and it is unavailable here for the reason the whole design exists: our
nodes' boxes are the consumer's content, and content size is only knowable from the
DOM.

### Verdict — **keep out**

- The lag is **one frame**, and it is the price of the measurement contract, not an
  oversight: upstream pays an observer tick for the same reason, and a canvas library
  avoids it only by not having consumer markup.
- The fix that is available — re-derive a resized node's handle offsets from
  `(position, oldSize, newSize)` — is exact only for handles placed at a percentage
  along an edge. For a consumer's handle at a fixed 6 px inset, or at 30% of the
  width, the derivation would be a guess that _moves the endpoint wrongly_ for a
  frame, which is worse than being a frame late. The measurement is the truth and it
  is already on its way.
- A second fix — a `MeasureHandles` Command per pointer event — replaces a coalesced
  measurement with an uncoalesced layout read per frame, in a library whose
  measurement budget is the documented cost (`BENCHMARKS.md`'s startup column).
- What would change it: a report that the lag is _visible_ — a user noticing an edge
  hanging behind a resized box — which would be fixed by tightening the coalescer for
  a resize frame, not by inventing geometry.

---

## 11. What this does not decide

Recorded so the next person does not have to re-open them accidentally. Each is a
**candidate**, in `docs/M6-FINDINGS.md` §7 with a number where there is one.

- **The 10k startup cost** (1.19 s to settle, `/large-expanded.html`): the largest
  measured cost in the library and not on M6's list. It is a design question — the
  first render happens before the pane is measured, so culling is off for it.
- **A composite-widget tab stop** (one tab stop for the graph, arrow keys inside):
  what the APG actually prescribes for a widget with many focusable parts. Both xyflow
  and this library put every node (and now every edge) in the tab sequence. Changing
  that is a keyboard-model change, not a gap.
- **An HTML overlay layer for edge controls**: the shape §8 describes, with the
  `scale(1/zoom)` arithmetic the engine already exports.
- **Resize vetoes** and per-node resize configuration: §7.
- **`1.0.0`**: the owner's rule is that it follows real usage, not a milestone
  (`docs/M5-FINDINGS.md` §13). M6 adds two opt-in behaviours and one modifier; that
  is `0.2.0`, and publishing stays the owner's decision.

## Sources

Pinned artifacts (the code this library runs against, dates from the npm registry):

- `@xyflow/system@0.0.84`, published 2026-11-02T09:55:10Z, `dist-tags.latest` as of
  2026-11-08T12:01:42Z — `dist/esm/index.js`, `dist/esm/xyresizer/`, `xyminimap/`,
  `utils/edge-toolbar.d.ts`
- `@xyflow/react@12.12.1`, published 2026-11-02T09:56:13Z — `dist/esm/index.js`,
  `dist/style.css`
- `@xyflow/svelte@1.7.1`, published 2026-11-02T09:53:58Z — `dist/lib/store/`
- xyflow repository HEAD `1bc405cd` (2026-11-02T09:52:15Z), the release commit

Documentation (each page's own stamp, 2026-10-11):

- <https://reactflow.dev/api-reference/components/minimap>
- <https://reactflow.dev/api-reference/components/node-resizer>
- <https://reactflow.dev/api-reference/components/edge-label-renderer>
- <https://reactflow.dev/api-reference/hooks/use-update-node-internals>
- <https://reactflow.dev/api-reference/types/node-origin>
- <https://reactflow.dev/learn/layouting/sub-flows>
- <https://reactflow.dev/learn/advanced-use/accessibility>
- <https://reactflow.dev/learn/advanced-use/performance>

Issues, PRs and commits (with their timestamps):

- xyflow #1211, opened 2021-05-20, closed 2022-01-12 —
  <https://github.com/xyflow/xyflow/issues/1211> (the `visibleStroke` history)
- xyflow #3127, opened 2023-06-09, closed 2023-06-30 —
  <https://github.com/xyflow/xyflow/issues/3127> (`interactionWidth` and a parent
  `pointer-events`)
- xyflow #2986 (resize direction), landed `bee2f4aa` 2025-04-17
- xyflow `a96044b` 2022-11-01 — minimap `pannable`/`zoomable`
- xyflow `a87e24b7` 2026-09-02 — last commit touching `packages/system/src/xyresizer`
- <https://xyflow.com/blog/react-flow-v11> — "Better selectable edges with a new
  `interactionWidth` option"

Second implementations:

- tldraw PR #3439 (merged 2024-04-15), PR #7676 (merged 2026-01-16), release
  <https://tldraw.dev/releases/v4.4.0>, issue #8882 → PR #9093 (merged 2026-07-01) —
  RBush culling and its maintenance cost
- tldraw `Resizing.ts`, last touched `1a0d13d5` 2026-10-02; `TLResizeMode` and
  `BoundsSnaps` reference pages; PR #8120 (merged 2026-03-03), PR #10491 (merged
  2026-08-25); issue #8226 (the resize snapshot notes)
- Cytoscape.js — <https://js.cytoscape.org/#notation/position> ("A node's position
  refers to the centre point of its body", fetched 2026-11-12) and issue #530
- JointJS `<Navigator>` — <https://docs.jointjs.com/api-react/Components/Navigator/>
  (v4.3, fetched 2026-11-12)
- Excalidraw — issue #2184 (opened 2020-09-23, still open at 2024-02-12) and PR
  #12597 (2026-11-11): a minimap interaction is still a proposal there, not a shipped
  behaviour

Platform:

- MDN `ResizeObserver`, last modified 2025-11-07 —
  <https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver> ("…before paint")
- W3C ARIA APG, "Developing a Keyboard Interface", fetched 2026-11-12 —
  <https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>
- CSS `pointer-events` (`visibleStroke`, `stroke`) and SVG2 `tabindex` as used above
