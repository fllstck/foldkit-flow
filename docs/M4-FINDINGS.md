# M4 findings

M4 is the graph features: parent/child sub-flows, `hidden` collapsing, node
resizing, the snap grid, `fitView` options, edge markers and labels, and minimap
click-to-centre. Where the code differs from `docs/PLAN.md`, this file records the
diff and why; §11 records the one edit the plan has since received (an M6 that
researches the gaps M4 left). v1.0 ships at this milestone.

Verification state at the commit that carries this file — the authoritative
numbers; every earlier figure in this document is historical and marked as such.

| Check                                          | Result                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm typecheck`                               | flow → example → benchmark                                            |
| `pnpm build`                                   | flow → example → benchmark                                            |
| `pnpm check`                                   | typecheck, Enfect lint, Prettier, **270** Vitest tests green          |
| `packages/flow` unit tests                     | 270 in 26 files (M3 had 194 in 20)                                    |
| `packages/benchmark/tests/m4.spec.ts`          | 9 passed (M4 proofs 38–46)                                            |
| `packages/benchmark/tests/hidden.spec.ts`      | 1 passed (the 10k exploration)                                        |
| `packages/benchmark/tests/chrome.spec.ts`      | 17 passed (M3 proofs 22–37)                                           |
| `packages/benchmark/tests/connection.spec.ts`  | 5 passed (M2 proofs 17–21)                                            |
| `packages/benchmark/tests/interaction.spec.ts` | 9 passed (M1 proofs 8–16)                                             |
| `packages/benchmark/tests/proofs.spec.ts`      | 4 passed (M0 proofs 2, 3, 3b, 4)                                      |
| `packages/benchmark/tests/bench.spec.ts`       | 3 passed (625 comparison, 1k culled gate, 1k culled gate with chrome) |
| whole Playwright suite                         | 48 tests = 44 proof tests + 3 gate tests + 1 exploration, in 3.3 min  |

`pnpm check` still needs a build first when the public surface changed: the
example and the benchmark typecheck against the library's `dist/*.d.ts`.

## 1. What M4 changed, against the handoff's checklist

| Handoff item                     | Shipped                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Parent/child position resolution | `geometry/positions.ts`: one memoized absolute-position index, read by every position-derived helper (proof 38, §2 below)           |
| `hidden` subtree collapsing      | `geometry/hidden.ts` + a reductive filter in the renderer, and pruning in `informGraphChanged` (proof 39, §3)                       |
| Snap grid                        | `snapPosition` behind the adapter, stamped onto the press, applied once per pointer event in `MovedPointer` (proofs 40, 45)         |
| `fitView` options                | `fitViewport(model, nodes, { padding, minZoom, maxZoom, nodes })` plus `RendererConfig.fitView` on the `Controls` button (proof 41) |
| Edge markers and labels          | `<defs>`/`<marker>` in the edges SVG, a halo-backgrounded label, `renderEdgeLabel` finally called (proofs 42, 43)                   |
| Node resizing                    | A Flow gesture with pure geometry in `geometry/resize.ts`, four corner controls, `OutMessage.ResizedNodes` (proofs 44, 45)          |
| Minimap interaction              | Click-to-centre (proof 46). Drag-to-pan deliberately out (§3)                                                                       |
| Gate and evidence                | Re-run at 1k with M4 in the tree (§6); the 10k `hidden` number is recorded in `results/hidden-10k.json` (§7)                        |

## 2. The decisions the handoff asked for

### 2.1 Where the parent chain is resolved: one index, not a normalised context

A child carries a position **relative to its parent** — upstream's data model, and
the only one where moving a parent does not rewrite every descendant. The flow
holds no store, so the chain is resolved by `geometry/positions.ts`:
`positionIndex(nodes)` returns `Map<nodeId, Point>` of absolute positions, and
every position-derived helper takes it (`nodeRect`, `nodeBounds`, `visibleNodes`,
`visibleEdges`, `edgeAnchor`, `indexedEdgeEndpoints`, `hitTestHandle`,
`fitViewport`, the minimap, the description and the renderer's transform).

Why the helper rather than a normalised `Context` the parent builds: the parent's
data stays honest (a child's position means what it says), and the cost is paid
once per graph change instead of once per frame. The index is memoized on the
**array reference**, which a frozen Foldkit Model makes a sound identity, so a
drag frame or a pan frame reuses it and a graph edit rebuilds it. Three rules are
load-bearing: a missing `parentId` resolves as absolute (a child vanishes only if
the parent removed it), a parent cycle keeps its nodes at their own coordinates,
and **there is no depth limit**.

_Superseded detail, kept so the history reads straight:_ this section originally
said the resolution walked each node's chain, bounded by `maxParentDepth (12)`.
That cap was removed in `§12.4` (it truncated valid nesting and made the result
depend on array order) and the walk became a downward breadth-first pass in
`§13.1` (the per-node walk was quadratic on a large flat graph). See those two
sections for the current algorithm and its measured cost.

### 2.2 Dragging a parent moves the subtree for free, and the child is not dragged

`Gesture.DraggingNodes` keeps `nodeIds`, and `update` filters out any node whose
**ancestor is also in the set** (`hasDraggedAncestor`). The parent carries the
delta; every descendant moves because its absolute position is built from the
parent's. One fact on release, about the parent — the child's relative position
did not change, so there is nothing to report for it. The renderer computes the
moving set with `withDescendants` so that children follow the overlay mid-gesture
and cannot be culled out from under the pointer (M1 §6.2's rule, extended).

`MovedNodes` and `ResizedNodes` report positions **in the space the flow received
them** — absolute for a top-level node, parent-relative for a child — so a parent
applies them verbatim.

### 2.3 `hidden` means collapsed

A hidden node is not rendered, its edges are not rendered, **its descendants are
not rendered either**, and its measurement and selection are pruned by
`informGraphChanged`. The alternative (hide exactly one node) leaves children
floating at coordinates derived from something the user cannot see, and the 10k
story depends on "collapse a subtree". There is no second "flat hide" flag.

Collapsing is not culling: it applies with `cull` off, it is applied before the
rect test, and a collapsed node is not fitted by `fitViewport`, not drawn in the
minimap and not listed in the description. The set itself is memoized on the graph
array, so a page that never sets `hidden` pays one memoized set lookup per render
and nothing per node.

### 2.4 The snap grid lives in `RendererConfig`, not the Model

The precedent is M3's `isAdditiveModifier`: the renderer stamps it onto the press,
and the gesture carries it. Nothing in `update` needs a grid outside a gesture, so
a Model field would be state with one reader. `snapGrid` is stamped onto
`PressedNode` and `StartedResize` and stored in the gesture, so a drag cannot
change grid mid-flight and a page that configures no grid runs no snap code.

Snapping happens in exactly one place — `MovedPointer`'s drag branch, once per
pointer event — and it snaps the **grabbed node's** position to a multiple, so the
overlay the user sees and the position released on pointerup are the same number.
Every other dragged node keeps its offset from that anchor. Snapping only at
release was rejected: it shows one position for the whole gesture and drops
another.

### 2.5 `fitView` options live in the renderer, and the clamp can only tighten

`Flow.fitViewport(model, nodes, options)` gained `padding`, `maxZoom`, `minZoom`
and a `nodes` filter. The `Controls` fit button carries the renderer's
`fitView` defaults inside `ClickedFitView` (as `Option` fields, so "not
configured" is a value rather than an absent property), and `update` resolves them
where the Model is. A per-fit clamp is `Math.min(option, Model.maxZoom)`, so the
Model's bounds remain the single source of truth and an option looser than them is
ignored (proved in `geometry/fit.test.ts`). A filtered fit resolves positions
against the **whole** graph and measures only the filtered nodes — fitting a child
alone places it where it is drawn.

### 2.6 Resizing is a Flow gesture, and `XYResizer` is not used

The handoff names `XYResizer` behind the adapter and asks for the design decision
about its `getStoreItems`. That decision, made explicitly: **it cannot be driven
correctly from this architecture, so M4 does not use it.**

`XYResizer` reads `nodeLookup`, `transform`, `snapGrid`, `nodeOrigin` and
`paneDomNode` from a `getStoreItems()` thunk **at pointer-down**, and that data
has to be fresh — the node's position and measured box at the moment of the press.
The only seams a Mount has are its args, which Foldkit captures at mount and never
re-evaluates ("a reused DOM node does not run `execute` again"), and `view`, which
must not write. Re-keying the handles on every measurement change to force a
remount would destroy the d3-drag listener mid-gesture; handing the Mount a live
graph would put a second source of truth in the registry, which §2.5.1 forbids.

So resizing is a `Gesture.Resizing` variant with the same shape as the drag: the
renderer reports the control, `update` runs `geometry/resize.ts` against a `start`
rect captured at press time, and the release emits `OutMessage.ResizedNodes`. The
gesture carries its own anchor, so no frame reads the graph. What `XYResizer`
would have computed — control direction, min/max clamps, snapping the moving edge
— is pure and Story-tested instead (`geometry/resize.test.ts`, seven cases).

**A resize is a measurement event, not a view mutation.** On release the box is
written into `nodeSizes` (the same store the node Mount's `ResizeObserver` writes)
so geometry agrees with the DOM without waiting a frame, and the parent persists
the fact; with `resize` on, the renderer draws `node.size` as the node's box, which
is how the box survives the render after the gesture.

### 2.7 Four resize controls, not eight

The first version rendered all eight. Proof 17 failed immediately: a resize handle
at an edge midpoint sits exactly where this library's own stylesheet puts a port
handle (`.fflow__handle.source` at `right: 50%`, `.target` at `left: 50%`), so the
press that starts a connection hit the resize handle instead and the gesture never
left `Idle`. The renderer now draws the four corners; `geometry/resize.ts` still
computes all eight, so a parent that draws its own edge controls gets the same
arithmetic. This is the handoff's "a resize or minimap gesture must not become a
connection" in its exact form.

### 2.8 Edge markers and labels are data, not configuration

`FlowEdge.markerStart` / `markerEnd` are `"Arrow"` / `"ArrowClosed"` — our own
glyphs (§2.4: no ported visual identity), emitted into a `<defs>` block that exists
only when an edge asks for one, with `markerUnits="userSpaceOnUse"` so the arrow
scales with the viewport rather than with the path's `non-scaling-stroke`, and
`orient="auto-start-reverse"` so one marker serves both ends. Ids are derived from
`paneId`, so two flows on a page cannot share one.

`edge.label` now renders **without** a renderer config — M3 required
`renderEdgeLabel` to be set and then ignored it. The label is a `<text>` at the
path's own label point with `paint-order: stroke` and an edge-width stroke in the
pane's background colour: a halo, not a measured `<rect>`, so a label needs no
measurement to stay readable where an edge crosses it. `renderEdgeLabel`, when
configured, replaces the label's _content_ at the same point.

Per-edge styling is `[data-edgeid]` plus the consumer's own stylesheet. No `style`
prop was added: the parent owns the edge, and CSS is already the styling seam.

### 2.9 Minimap: click-to-centre, not drag-to-pan

_(The demo also gained a **Jump to group** button: the group fixture is parked
above the grid, and with `preserveAspectRatio="xMidYMid meet"` a click in the
minimap's letterbox band extrapolates past the graph's edge rather than landing on
it, which made the fixture hard to find by hand. The button is the parent-side
equivalent — `Flow.setViewport(model, Flow.viewportCentredOn(model, point))` and
its Command — so the public helper has a worked example as well as a proof.)_

A press inside the minimap is converted to a flow point by the SVG's own screen
matrix (`getScreenCTM()`, which includes the `viewBox` mapping and the element's
position on the page) and dispatched as `ClickedMiniMap({ point })`; `update` turns
it into one `setViewport(model, viewportCentredOn(model, point))`, so the existing
zoom clamp and the existing `SyncViewport` Command still own the move.

Drag-to-pan is **not** in v1.0. It is a second pointer gesture with its own
identity, cancel path and `NoPan` requirements, and it needs a coordinate space
that changes while it runs; the handoff allows leaving it out if the omission is
named. Named here. The M5 handoff should not claim it shipped.

### 2.10 Edge selection from the pointer layer: still not in v1.0

`model.selectedEdgeIds` is still written only by `selectAll` and cleared by
deselect; nothing in the pointer layer sets it (M2 §8 left it open and M4 closes it
the same way). M4 makes an edge a first-class object visually — a marker and a
label — but selecting one from the canvas needs a wider invisible hit path and a
`PressedEdge` message, and the edges layer must stay below the nodes layer
(`M3-FINDINGS` §3). That is a gesture-surface change, not a graph feature; it is
recorded as not shipped rather than half-built.

## 3. Where the code differs from `PLAN.md`

### 3.1 §3.3 — `FlowNode` and `FlowEdge` gained fields, and the optional ones say `| undefined`

`parentId` (declared and never read since M0) is now read; `hidden` is new;
`FlowEdge` gained `label`'s real behaviour plus `markerStart` / `markerEnd`. Every
optional field is typed `?: T | undefined`, matching `exactOptionalPropertyTypes`
without forcing callers into conditional spreads — the same reason
`FitOptions` does.

### 3.2 §3.3 — `RendererConfig` gained `snapGrid`, `resize`, `fitView`

All three are opt-in and default to the M3 DOM: `resize` renders eight (four, §2.7)
extra press targets per node, `snapGrid` runs no code when absent, and `fitView`
only changes what a `Controls` press means. The gate pages configure none of them.

### 3.3 §4.2 — the node Mount is unchanged, and that is why the resize overlay exists

The Mount still owns `ResizeObserver` + `MutationObserver` and remains the only
reader of node geometry. A resize writes the box through the Model (so `view`
stays pure), the observer then reports the same numbers, and the release writes
`nodeSizes` directly so the two paths cannot disagree for a frame.

### 3.4 §7 M4 — `Click` vs `OnPointerDown` for the minimap

The minimap uses `OnPointerDown`, not `OnClick`, so the press is the same kind of
event as every other gesture in the library and `NoPan` handles it identically.
`OnClick` would have fired after a drag across the minimap.

### 3.5 §6 — the demo's fixture grew by five nodes, so the earlier proofs count 630

The demo is the proofs' instrumentation (M1 §10), and `hidden` and sub-flows need
something to collapse. The playground gained a container (`group`) and four
children (`g1`–`g4`) parked above the grid, plus one arrowhead and label on the
existing `e1`. The 625-node layout, its 416 edges and every position the earlier
proofs press are untouched; the assertions that counted nodes moved from 625 to
630 (and the description's "575 more" to "580 more").

## 4. The M4 proofs, and what each one can see

| Proof | Claim                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| 38    | A child is drawn at its parent's origin + its own offset, and dragging the parent moves it (read mid-gesture) |
| 39    | Collapsing a container removes its subtree, its element, and its measurement — and expanding restores it      |
| 40    | A snapped drag lands the grabbed node on a grid multiple, in the committed position                           |
| 41    | The fit button uses the renderer's clamp (0.6, below the graph's natural fit) and keeps every node in view    |
| 42    | A marker is painted: the clip where the glyph sits has 52 stroke-coloured pixels with it, 29 without          |
| 43    | A label is painted: foreground pixels appear under the label and none when it is hidden                       |
| 44    | A corner resize grows the box without moving the node, and the parent's persisted box survives the release    |
| 45    | The same resize snaps to the demo's 20-unit grid                                                              |
| 46    | A minimap click centres the view on the flow point under the cursor                                           |

Proofs 42 and 43 exist because `M3-FINDINGS` §14 established that an attribute
assertion cannot see paint. Both compare the same clip on the same page with one
attribute — or one `visibility` — changed, which is the cheapest thing that could
possibly show a difference.

## 5. Bugs found during M4

1. **Resize handles swallowed connections** (§2.7). Found by an existing proof
   (17), not a new one, which is the point of keeping the old suite: the M4 change
   broke M2 behaviour and the M2 proof said so within a minute.
2. **`fitViewport` with a filter measured the ancestors it kept.** The first
   implementation appended a filtered node's ancestors to the list it measured, so
   "fit the child" fitted the parent's whole box. Fixed by building the position
   index from the full graph and measuring only the filtered rects
   (`boundsOfRects`).
3. **A quadratic walk in the first position index**: the first version
   resolved a node's position by walking its chain per node with a `visiting` set
   copied per level. Correct, but quadratic on a deep chain; the memo now resolves
   each ancestor once (`positions.test.ts` asserts a 200-level chain resolves in one
   pass).
4. **The `hidden` count in the 10k exploration was wrong for a day**: 9,702
   children are collapsed but the number the page reports is 9,800, because the 98
   collapsed containers are hidden too. The proof now says so.

## 6. The gate, with M4 in the tree

Same protocol as M3 (`M3-FINDINGS` §5): production builds, Brave headless, one
worker, warm-up discarded, 10 recorded runs. Numbers below are from the run at the
commit that carries this file (`results/benchmark.json`,
`results/benchmark-1k.json`, `results/benchmark-1k-chrome.json`).

| Leg                   | drag (median / p95 / longest) | pan (median / p95 / longest) | long frames |
| --------------------- | ----------------------------- | ---------------------------- | ----------- |
| 625, React Flow       | 0 (not verified, M1 §10)      | 16.7 / 16.8 / 33.3           | 0           |
| 625, Svelte Flow      | 16.7 / 16.8 / 16.8            | 16.7 / 16.7 / 16.8           | 0           |
| 625, Foldkit          | 16.7 / 16.7 / 16.8            | 16.7 / 16.8 / 33.4           | 0           |
| 1k culled             | 16.7 / 16.8 / 16.8            | 16.7 / 16.8 / 50.0           | 0           |
| 1k culled + M3 chrome | 16.7 / 16.7 / 16.8            | 16.7 / 16.8 / 33.4           | 0           |

Parity with React Flow on pan holds at 625 (median and p95 identical). Both 1k legs
are inside the 33 ms p95 gate with zero long frames; the 50.0 ms pan outlier in the
1k bare leg is a single frame at the recorder's 50 ms class boundary, which
`longFrames` counts as _not_ long, exactly as §4.5's 2% bound defines it.

The per-dispatch cost went up slightly and is recorded rather than hidden:
`updatePerDispatchMs` is 0.0018 at 625 and 0.0018–0.0019 at 1k on this run
(M3 recorded 0.0019–0.0027 across its legs; the 625 figure moves the most from run
to run). The new per-frame work is `visibleIds`/`shiftById`/`positions`, which a
render does now that a position can be relative.

**The culling scan is the number to watch.** `cullScanMs` is 6.7 (1k bare), 6.2 (1k with chrome)
and 2.8 at 625 on this run, against 6.67 / 6.23 / 3.92 on the run before it and
5.72–5.81 / 2.55 at M3 — the scan is noisy at the ±1 ms level on this machine, and
the level itself is the finding. Per scan, not per node. It is O(N) per scan times an O(measured) size
lookup inside `nodeSizeOf`, so at 1k a scan costs about a third of a 16.7 ms frame.
M4 does not fix it (the gate passes with zero long frames, and the fix is a
measured change that deserves its own before/after); it is named here as the first
thing M5 should change, and §7 is why it matters.

## 7. Ten thousand nodes with `hidden`

`/large-hidden.html` holds 10,000 nodes: 100 containers of 99 children, 98 of them
collapsed, so 9,800 nodes are hidden and 200 are rendered. Five pans of 20 frames
each, warm-up discarded (`results/hidden-10k.json`):

| Metric                     | Value                     |
| -------------------------- | ------------------------- |
| rendered nodes             | 200 (of 10,000)           |
| pan frames                 | 247                       |
| pan median / p95 / longest | 16.7 / 16.7 / 16.8 ms     |
| long frames (> 50 ms)      | 0                         |
| cull scan per call         | 3.21 ms over 10,000 nodes |

So the escape hatch works: a 10k graph whose bulk is collapsed pans at the frame
rate, with 200 nodes in the DOM. The number that scales with the model rather than
with the view is the culling scan (3.21 ms), and it is a scan of 10k _hidden_
nodes
paying a set lookup each — which is the cheap half of `visibleNodes`. An expanded
10k graph would pay the rect test and the size lookup for all of them, which §6
says is where the ceiling is.

This is an exploration, not a gate: PLAN §4.5 promises no figure at 10k, so the
number is recorded and nothing asserts a budget on it. M5 publishes it.

## 8. What M4 deliberately does not do

- **Minimap drag-to-pan** (§2.9) and **edge selection by press** (§2.10).
- **`nodeOrigin`**: nodes are top-left anchored. Nothing in M4 needs a centre
  anchor, and a second origin would have to be threaded through positions, rects,
  edge anchors and the resizer's arithmetic. (M6 row 4 researches it; §12 changed
  nothing here.)
- **Resizing a parent does not re-place its children.** Children keep their
  relative positions, so resizing a container from its top-left carries them; the
  upstream behaviour (children compensate to stay visually still) is a
  container-layout feature, not a resize feature.
- **`keepAspectRatio`** on a resize: corners only, no modifier. No proof needs it.
- **Edge labels are not interactive** — no press target, no measurement. A label
  that is a control is a node.
- **Multi-node resize**: one node per gesture, the one whose control was pressed.
- **Per-frame handle re-measurement during a resize**: the `ResizeObserver` reports
  the new box after the paint, so an edge anchored on a moved handle can lag the
  box by a frame. Measured, written down, not fixed: the alternative is
  re-measuring in `view`, which is the one thing the measurement contract forbids.

## 9. Response to the handoff's "known traps"

Each of the sharpened traps was real and each cost something:

- **`pnpm typecheck` before `pnpm build`, build before check**: `ClickedFitView`
  gaining fields broke the example's exhaustive `fold` and the benchmark's
  `Message.match` at typecheck, exactly as `M3-FINDINGS` §8.2 predicted.
- **A DOM assertion cannot see paint**: proofs 42 and 43 are pixel comparisons
  (§4). Both failed on their first version, for want of the right clip.
- **SVG `transform` takes unitless numbers**: not hit this time — the minimap
  conversion uses `getScreenCTM()`, which has no unit ambiguity.
- **`getComputedStyle` reports the CSS value**: used only through
  `DOMMatrix(getComputedStyle(...).transform)`, which reads the _computed matrix_,
  not the authored string.
- **The edges layer must stay below the nodes layer**: the `<defs>` block was added
  as a child of the edges SVG, so no new stacking context was introduced; proofs 36
  and 42 both still pass.
- **A drop within 20 screen px of a handle connects**: the resize handles are the
  violation this rule caught (§2.7).
- **`page.waitForFunction` has no timeout**: every new wait passes `WAIT`
  (15 s) and the sub-flow readiness check uses a 20 s `waitForSelector`.
- **The start-of-pan stall**: re-baselined before the M4 legs; `longFrames` is 0 in
  every leg at this commit.
- **A hung proof is a crash view**: hit once, when the demo page did not mount
  because the build it was served was stale — the failure reported as a 15 s timeout
  rather than a 600 s hang, which is the point of `WAIT`.

## 10. Proposed `docs/PLAN.md` diffs

Not applied at M4, per the working agreement. Items 3 and 4 are now superseded by
M6 (below), which researches them before any of them changes; the others remain
proposals:

1. §3.3: add `hidden`, `parentId` semantics (relative position), `markerStart`,
   `markerEnd` to the type sketches, and `RendererConfig.snapGrid`, `.resize`,
   `.fitView`.
2. §3.4: `fitViewport(model, nodes, options)` and the new pure helpers
   (`positionIndex`, `positionOf`, `hiddenIds`, `shownNodes`, `resizeRect`,
   `viewportCentredOn`, `boundsOfRects`).
3. §7 M4: record that `XYResizer` is not used (§2.6) — the plan's parenthetical
   "(XYResizer)" should read "pure resize geometry, `XYResizer` rejected because
   its `getStoreItems` needs reactive graph data".
4. §7 M4: minimap interaction is click-to-centre only in v1.0.
5. §4.5: name the culling scan's O(measured) size lookup as the known 10k
   bottleneck, with the measured numbers in §6 and §7 here.
6. §6: the demo fixture is 630 nodes from M4 on; the earlier proofs count that.

## 11. `PLAN.md` gained an M6 after this document was written

`docs/PLAN.md` §7 now ends with **M6 — the deliberate gaps, researched first**,
added at the project owner's request after v1.0 shipped. It is the first milestone
whose deliverable is a research document rather than a feature: one section per
row of the out-list in §8 above, primary sources only, two sources per claim, and a
three-way verdict (ship / ship differently / keep out) before any code.

Two consequences for this document, both bookkeeping rather than findings:

- §7's scope line now reads "v1.0 = M0–M4 as shipped" (it said M0–M5, which was
  written before the split). No M4 behaviour changed with that edit.
- §10's proposals stay proposals. Items 3 (`XYResizer` rejected) and 4 (minimap
  click-only) are exactly what M6 rows 1 and 2 re-examine against the primary
  sources; the outcome — including "M4 was right" — belongs in
  `docs/M6-RESEARCH.md`, not here.

No M4 number, decision or proof in this document changes as a result. The gate
figures in §6 and §7 were re-run after the review fixes in §12 and are the ones at
the commit that carries this file.

## 12. Response to `docs/M4-REVIEW.md`

Five findings, all accepted. The first three were one bug wearing three hats: the
collapsing rule was re-implemented at each call site instead of shared, so three of
them disagreed with the renderer. The fourth and fifth were design errors in code I
wrote to be defensive.

### 12.1 HIGH — `fitViewport` fitted descendants of hidden nodes: fixed

Correct. `fitViewport` tested `node.hidden !== true` — the node's own flag — while
the renderer, culling, minimap and description all used `hiddenIds(nodes)`. A child
under a collapsed container therefore contributed to the fit bounds, so a fit could
zoom out to hold a node the canvas never draws.

The filter is now `!hiddenIds(nodes).has(node.id)`, the same rule as everywhere
else, with a caller's `nodes` filter applied on top. Test:
`geometry/fit.test.ts` → "a child of a collapsed container is not fitted either
(M4-REVIEW 1)", which fits a hidden container plus its child and asserts the result
equals fitting the visible node alone.

### 12.2 MEDIUM — `selectAll` selected hidden nodes: fixed

Correct, and the same cause. `selectAll` now selects `shownNodes(nodes)` and
`shownEdges(nodes, edges)`; the edges matter for the same reason (an edge with a
collapsed end is not on the canvas, and `informGraphChanged` would prune both on the
next graph change anyway). Test: `state.test.ts` → "selectAll selects only what is
shown (M4-REVIEW 2)", with a collapsed container, its child, and two edges into the
subtree.

### 12.3 MEDIUM — the description counted edges into a collapsed subtree: fixed

Correct. The renderer passed `shownNodes(input.nodes)` with the unfiltered
`input.edges`, so the connection count and the per-node sentences could mention an
edge that the canvas does not draw.

`shownEdges` is now the one place that rule lives — `visibleEdges`, `selectAll` and
the description all call it, so they cannot drift apart again. Test:
`view/subflow.test.ts` → "the description describes what is shown, not the collapsed
edges (M4-REVIEW 3)".

**What that fix exposed.** `shownNodes` used to allocate a new array per call.
The minimap memoizes on the identity of the array it is handed, so on a page with
`minimap: true` and any hidden node it was rebuilding 1 000 rectangles **every
frame** instead of once per graph change. (The description was not affected: its
memo key is the graph itself, and the filter ran inside the memoized callback, so it
paid one allocation per graph change.) `shownNodes` and `shownEdges` are now
memoized on the graph array — and, for edges, on the identity of the hidden set — so
the identity is stable while the graph is. A test pins it:
`geometry/hidden.test.ts` → "shownEdges keeps the identity of the array while the
graph is unchanged". The 1k chrome gate is unchanged by it (16.7/16.8, 0 long
frames, §6).

### 12.4 MEDIUM — parent-chain behaviour was limited to 12 levels: fixed, not documented

_Superseded by `§13.1`: the fix below kept a `nodes.length`-round walk per node,
which was linear per node and therefore quadratic on a flat graph. The bound is now
a downward breadth-first pass with no per-node walk at all._

Accepted as a defect rather than a limit worth documenting. `maxParentDepth = 12`
was used in three places, and in `positionIndex` it was worse than a cap: because a
node's chain was resolved from whatever depth the node happened to start at, the
result depended on the order of the `nodes` array — an ancestor-first list resolved
a 40-level chain correctly, a children-first list truncated it.

It is gone. The bound is now the graph's own size, which is the real ceiling (a
chain cannot be longer than the graph), and the walk is an explicit, iterative one
that unwinds from the resolved ancestor or the root, so every chain resolves to the
same positions in any order. `ancestorIds` is bounded by `byId.size` and
`withDescendants` by `nodes.length`, so `hidden` propagation and parent dragging
follow the same rule. Cycles still terminate — they are invalid input, and the
walk stops where the chain closes.

Test: `geometry/positions.test.ts` → "a 40-level chain resolves exactly, whatever
order the nodes arrive in", which resolves the deepest node both parents-first and
children-first and asserts exact positions (`490, 440`) and equality. The 200-level
test stays.

### 12.5 LOW — sanitized marker ids could collide: fixed

Correct, and the failure mode is worse than the finding's example: `a/b` and `a-b`
both became `fflow-marker-a-b-…`, so two flows on one page would resolve
`url(#…)` to each other's `<marker>` — the second flow's arrowheads would draw with
the first flow's definition, and a page with one flow would silently swallow the
other's defs.

The encoding is now injective rather than lossy: characters outside `[A-Za-z0-9-]`
escape to `_<code point in hex>_`, and `_` is itself outside that set, so an
underscore always introduces an escape. Tests: `view/markers.test.ts` → "different
pane ids never share a marker id", "safe characters are kept", and an injectivity
check over seven near-collisions.

### 12.6 On the validation note

The `ERR_HTTP_RESPONSE_CODE_FAILURE` on `/large-hidden.html` is the preview-server
collision `M1-FINDINGS` §11 documents: a preview left running owns 4173/4174 and
`reuseExistingServer` then navigates into a server the run did not start. No test
body ran, which is why the run looked partial. `pkill -f vite` before a suite run is
the mitigation, and the full suite at this commit passed in one invocation:
**48 tests in 3.6 min**, including `tests/hidden.spec.ts`.

## 13. Response to `docs/M4-REVIEW-2.md`

Two items, both accepted: one algorithm defect and one stale sentence of my own.
The review also confirms the five findings from §12 are closed and that the suite
is green at 268 tests (270 after this section's tests).

### 13.1 MEDIUM — the position index was quadratic on a flat graph: fixed by replacing the walk

Correct, and worse than "unnecessarily quadratic for flat graphs" suggests. The
`§12.4` fix bounded each node's walk with `Arr.range(0, nodes.length).reduce(...)`,
where the reducer returns its input unchanged once the chain is done. The bound was
correct but the _loop_ was not: for a flat graph every one of the 10,000 nodes still
ran 10,000 no-op reducer calls, so a graph change paid 10⁸ function calls. The same
shape appeared twice more, in `ancestorIds` (which allocated a `byId.size`-long
range per call, and `hiddenIds` called it once per node) and in `withDescendants`
(`nodes.length` rounds × a full `nodes.forEach` per round).

All three are gone. The resolver is now a **downward breadth-first pass**: roots are
placed from their own positions, then each round expands the previous frontier's
children through one precomputed `children` map. One visit per node, and an empty
frontier makes the remaining rounds free. `hiddenIds` is the closure of the flagged
nodes down the same map, and `withDescendants` is the closure from the dragged ids —
so "the subtree of a collapsed node" and "the nodes that move with the one you
dragged" are literally the same function. `ancestorIds` remains a small recursive
walk, used only by a press and by tests, and says so in its docblock.

Measured on a production build of `packages/flow/dist` (Node, median of 7, a fresh
array per run so the memo misses):

| Call                                          | Before (§12.4 code)                                         | After      |
| --------------------------------------------- | ----------------------------------------------------------- | ---------- |
| `positionIndex`, 10,000 flat nodes            | 726 ms (review) / 2,983 ms (re-lifted and re-measured here) | **2.0 ms** |
| `positionIndex`, 10,000 nested nodes          | —                                                           | **2.3 ms** |
| `hiddenIds`, 10,000 nested (9,800 hidden)     | —                                                           | **1.4 ms** |
| `withDescendants`, 10,000 flat, one root      | —                                                           | **0.4 ms** |
| `withDescendants`, 10,000 nested, a container | —                                                           | **0.3 ms** |

The reviewer's 726 ms and my 2,983 ms for the same algorithm are the same finding
measured on different arrays and machines; the ratio is what matters, and the new
implementation is two to three orders of magnitude faster on the shape that hurt.

Instrumentation, as the review asked: two unit tests in
`geometry/positions.test.ts` ("building the index is one visit per node…" and
"collapsing and subtree expansion are linear on the same graph") build a 10,000-node
flat fixture and assert the results _and_ a wall-clock ceiling of 200 ms — a 100×
margin over the fixed cost, and well under the broken one. They are the only
time-based tests in the suite, and their comments say why.

The gate is unchanged by the fix (§6, re-run at this commit): 625 parity, both 1k
legs p95 16.8 with zero long frames. The 10k exploration is unchanged too — 247 pan
frames, 16.7/16.7, 0 long frames, 200 rendered of 10,000 — because the index is
built once per graph change, not per frame; the fix removes a startup pause rather
than a frame cost.

### 13.2 Documentation inconsistency — §2.1 still cited `maxParentDepth`: fixed

Correct, and it was my own text: §12.4 removed the constant but §2.1 still described
it as a live rule. §2.1 now states that there is no depth limit and carries a
"superseded detail" note pointing at §12.4 and §13.1, so the historical claim stays
readable instead of being quietly rewritten. §12.4 gained the same marker, because
its fix is the one this section replaced.

### 13.3 On the blocked browser reruns

Occupied 4173/4174 is the preview-server collision documented in `M1-FINDINGS` §11:
a leftover preview owns the port and `reuseExistingServer` makes the run navigate
into a server it did not start, so nothing is asserted and nothing is measured.
`pkill -f vite` before a run is the documented mitigation, and the full suite at
this commit passed in one invocation: **48 tests in 3.3 min**, `tests/hidden.spec.ts`
included.
