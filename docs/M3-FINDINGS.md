# M3 findings

M3 is our own chrome and the accessibility layer: `Flow.fitViewport` and
`Flow.viewportRect`, `Background`, `Controls`, `MiniMap`, `Panel`, focusable
nodes with arrow-key nudging, and a visually hidden description region. `PLAN.md`
was not edited; where the code differs from it, this file records the diff and
why.

Verification state at the commit that carries this file — the authoritative
numbers; every earlier figure in this document is historical and marked as such.

| Check                                          | Result                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm build`                                   | flow → example → benchmark                                            |
| `pnpm check`                                   | typecheck, Enfect lint, Prettier, **176** Vitest tests green          |
| `packages/flow` unit tests                     | 176 in 19 files (M2 had 123 in 14)                                    |
| `packages/benchmark/tests/chrome.spec.ts`      | 10 passed (M3 proofs 22–30)                                           |
| `packages/benchmark/tests/connection.spec.ts`  | 5 passed (M2 proofs 17–21)                                            |
| `packages/benchmark/tests/interaction.spec.ts` | 9 passed (M1 proofs 8–16)                                             |
| `packages/benchmark/tests/proofs.spec.ts`      | 4 passed (M0 proofs 2, 3, 3b, 4)                                      |
| `packages/benchmark/tests/bench.spec.ts`       | 3 passed (625 comparison, 1k culled gate, 1k culled gate with chrome) |
| whole Playwright suite                         | 31 tests = 28 proof tests + 3 gate tests, 31 passed in 2 m 30 s       |

`pnpm check` still needs a build first when the public surface changed: the
example and the benchmark typecheck against the library's `dist/*.d.ts`. That is
the M2 trap, unchanged.

## 1. What M3 changed, against the handoff's checklist

1. **`Flow.fitViewport(model, nodes, padding?)`** (`geometry/fit.ts`) —
   `getViewportForBounds` over `nodeBounds`, clamped inside the engine call by the
   Model's zoom bounds. An empty graph, an unmeasured pane (`pane.width === 0`), and
   an unmeasured node each have a defined answer (§2.2).
2. **`Flow.viewportRect(model)`** (`geometry/visible.ts`) — the pane's box in flow
   space, no overscan, and `visibleRegion` is now derived from it (`left - width`,
   `width × 3`) so the minimap and culling cannot disagree about where the view is.
3. **Zoom bounds have one source of truth.** `Model.minZoom`/`maxZoom`, seeded by
   `init(viewport, { minZoom?, maxZoom? })`, passed to `MountPane` as args for
   `XYPanZoom`'s `scaleExtent`, and enforced once in `setViewport`.
   `RendererConfig.minZoom`/`maxZoom` were declared and never read; they are
   deleted rather than kept as a third number.
4. **`Background`** — dots and lines, one CSS `background-image` per layer whose
   `background-position` is the viewport translate and whose `background-size` is
   `gap × zoom`. Outside `.fflow__viewport`, so the content transform cannot scale
   the pattern a second time.
5. **`Controls`** — zoom in (`ClickedZoomIn`), zoom out (`ClickedZoomOut`), fit
   (`ClickedFitView`). Each is handled in `update` by calling the helper the parent
   would call (`zoomBy` / `setViewport(fitViewport(...))`), so there is one
   implementation of zoom and one of fit.
6. **`MiniMap`** — every node as a `<rect>` inside one memoized `<g>`, in a
   `viewBox` of the graph's bounds, plus the plain viewport rectangle.
   Display-only in M3 (§4.6), `aria-hidden` because the description says it in
   words.
7. **`Panel`** — `Flow.panel({ position, label? }, children, h)` plus
   `ViewInput.panel`, which the renderer places inside the pane above the viewport.
   The markup is built in the parent's boundary, the same one `renderNode` runs in.
8. **Focusable nodes** — `tabindex="0"`, `role="button"`, `aria-pressed` (the
   selection is a toggle), `aria-label` from a new `RendererConfig.accessibleName`
   hook with the node id as fallback. The focus ring is ours and lives on the
   wrapper.
9. **Arrow-key nudging** — `Message.NudgedNode({ nodeId, delta })` from the
   keyboard subscription, `OutMessage.MovedNodes` for one node, one per press.
   `nudgeDelta` (pure) maps the four arrows and Shift; the existing
   `isDeleteKeyAllowed` guard covers the new keys; the mapper is now
   `streamFromEventFilterMapPreventDefault`, so arrows do not scroll the page.
10. **Description region** — a visually hidden `role="region"` beside the viewport,
    memoized on `nodes`/`edges` (§4.3 of the handoff: "a live region that changes
    60×/s is worse than none"). Not a live region at all; 50 nodes and 6
    connections per node, with counts of what is omitted.
11. **Tests** — 53 new Vitest tests (fit, viewportRect, nudge, domTarget chrome and
    focus guards, chrome rendering, the description text, chrome Messages in
    `state.test.ts`), and 10 new Playwright proofs.

## 2. Where the code differs from `PLAN.md`

### 2.1 §3.3 — `RendererConfig` gained the chrome flags and lost the zoom fields

`background?: BackgroundConfig`, `controls?: boolean`, `minimap?: boolean`,
`accessibleName?: (node) => string`; `minZoom`/`maxZoom` are gone. All three chrome
flags are **off by default**: same precedent as `cull` and `reconnect` (§2.5.4 of
the M2 findings) — a rendering cost is an explicit choice, and the benchmark pages
that the gate measures keep the DOM the previous milestones measured.

### 2.2 §3.4 — `fitViewport` returns the current viewport for the degenerate cases

Three inputs can make "fit" meaningless, and each returns `model.viewport`
unchanged rather than a fabricated one:

- **an empty graph** — there is no box to fit, and fitting nothing would zoom to
  `maxZoom` around the origin and jump the view for no reason;
- **an unmeasured pane** — before `ResizedPane`, `pane.width`/`height` are 0 and
  there is no frame to fit into;
- **nothing for nodes that have not been measured** — `nodeBounds` falls back to
  `node.size` and then to `fallbackSize` (151×40), the same geometry the edge paths
  use before measurement, so an unmeasured graph fits sensibly.

The clamp happens inside `getViewportForBounds`, which is given the Model's bounds,
so there is no second clamp. `Flow.fitViewport` is exported and returns a plain
`Viewport`: a parent that wants to animate passes it to `Flow.setViewport(model,
fitted, Option.some(duration))`. The library's own fit button uses no duration
(deterministic, and what the proof reads).

### 2.3 §3.4 — `setViewport` is a no-op at a zoom bound

`setViewport` clamps `zoom` to `[minZoom, maxZoom]` and returns `{ model }` with no
Command when the result equals the current viewport. That is what makes "zoom
controls stop at the engine's bounds" a property of `update` rather than a race
with d3's own clamp: at the bound nothing is written to the Model, nothing is
dispatched, and the transform on screen does not move. The proof asserts exactly
that (`data-viewport` and the transform string are byte-identical across a press).

### 2.4 §3.2 — three new Messages, all with a producer and a consumer

| Message                            | Producer                           | Consumer                                        |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------- |
| `ClickedZoomIn` / `ClickedZoomOut` | `Controls` buttons                 | `update` → `zoomBy`                             |
| `ClickedFitView`                   | `Controls` button                  | `update` → `setViewport(fitViewport(...))`      |
| `NudgedNode({ nodeId, delta })`    | keyboard subscription (arrow keys) | `update` → `OutMessage.MovedNodes` for one node |

The two `Message.match` sites in the example and the benchmark page are exhaustive,
so adding them surfaced both immediately — the M2 precedent.

### 2.5 §2.5.8 — arrows go through the keyboard subscription, not `OnKeyDownFocus`

`foldkit/html` offers `OnKeyDownFocus`, which focuses a `focusSelector` and
dispatches a Message. It is **not** used, for two reasons:

- it focuses with `document.querySelector` (`foldkit@0.170.0`,
  `dist/html/index.js:487`), which breaks the "no `document` fallback" rule that
  keeps the ShadowRoot host working (§2.5.8, proof 12);
- its handler signature is `(key, modifiers)`, with no event target, so the
  `input`/`.fflow__nokey` guard cannot be evaluated there. The guard is the whole
  point.

The keyboard subscription resolves the pane's root through the host registry, has
the event, and already owns Delete and Escape — so arrow keys join it, and
`nudgedNodeId(event.target)` answers "which node" from the DOM at event time. That
is also why there is no `focusedNodeId` in the Model: nothing renders differently
for focus, so a Model field would be state without a reader.

### 2.6 §7 M3 — Tab is not trapped

Node wrappers are tab stops in render order, and whatever the consumer puts inside
a node is tabbable between them. Tab _leaves_ the pane at either end; there is no
wrap-around. Wrapping would need either a keydown handler that computes the next
index (a Model list of ids the flow does not own) or `OnKeyDownFocus` (above), and
native browser order is the behaviour a keyboard user already expects from a
region of focusable elements. The proof asserts the DOM order claim: from a focused
node, Tab reaches that node's own focusable content and Shift+Tab comes back.

### 2.7 §7 M3 — the minimap is display-only, and the interactive part is M4

Click-to-centre and drag-to-pan on the minimap are a new gesture surface with their
own pointer identity, their own `NoPan` rules, and their own cancel semantics. M3
ships the picture; `docs/PLAN.md` §7 M4 is where the interaction belongs. The
minimap is `aria-hidden` and has no tab stop.

### 2.8 §3.3 — `RendererConfig.accessibleName` rather than a wrapper convention

`node.data` is the parent's, so the flow cannot read a label out of it. The hook is
optional and defaults to `node.id`: a flow that does not opt in still gives every
node a stable, distinguishable name rather than an anonymous `<div>`. The same
function supplies the description region's node names, so the tab order and the
description cannot disagree (`view.ts`'s `accessibleNameOf`).

`role="button"` with `aria-pressed` is the choice for "the selection ring, in the
accessibility tree": pressing a node selects it (a toggle), `aria-pressed` is valid
on `button`, and a screen reader announces "Node 0, button, pressed". `aria-selected`
would need `option`/`gridcell`/`row`/`tab`, and `role="application"` would demand a
complete keyboard contract the flow does not have.

## 3. The M3 CSS introduced a stacking bug, and the proofs found it

The first version of the chrome stylesheet gave the background, the edges layer
and the nodes layer a shared rule:

```css
.fflow__viewport,
.fflow__edges,
.fflow__nodes {
  z-index: 1;
}
```

`z-index` only applies to positioned boxes, and `.fflow__edges` is
`position: absolute`, so this lifted **every edge path above every node**, while
`.fflow__nodes` (not positioned) was unaffected. Nodes still _looked_ right, but an
edge crossing a node's box started intercepting presses meant for the node's
content: proof 28's click on a node's input failed with "`<path class="fflow__edge-path">`
subtree intercepts pointer events", which is how it was found.

The fix is to stack only the viewport (which has to be above the background) and
leave the edges and nodes layers at `z-index: auto`, so the browser's painting
order — edges first, nodes second, both positioned, DOM order between them — decides
between them, as it did in M1 and M2. The rule now carries that reasoning in a
comment, because "add z-index to the layer" reads like an improvement.

## 4. The demo could not hold a 220-unit node in a 220-unit column

`renderNode` gained the three things a real node contains — a scroll region, a
focusable `.fflow__nokey` region, and a text input — because the keyboard guards
need something to be inside. The first attempt made nodes ~211 flow units wide in a
220-unit column: neighbouring handles touched, the reconnect ring sat on the
neighbour's handle, and proofs 18 and 19 failed on real hit-testing (not on
assertions). Three changes, all in the example:

- `.node-label` `min-width` 96 → 64;
- `.fflow__nowheel` is a fixed 30×12 box (it is a wheel target, not text);
- `.node-input` is 46px wide.

That leaves ~178 flow units per node in the 220-unit column, which is wider than
M2's 150 and still leaves the ring its gap. The initial viewport also moved from
`{ x: 20, y: 30 }` to `{ x: 20, y: 200 }`: the panel lives at the pane's top-left
corner, and at the old offset it covered the first row of nodes — including the
handles proofs press. The M0 proofs' hardcoded `translate(20px, 30px) scale(0.9)`
expectation was updated to match (5 sites in `proofs.spec.ts`); the claim those
tests make is server/client agreement, not the number.

Two M1 proofs pressed the pane's corners to mean "empty pane". With a panel in one
corner and a minimap in another, a corner is no longer empty, so both now ask the
DOM: `emptyPanePoint` scans points inside the pane and returns the first one whose
`elementFromPoint` is the pane itself. A proof that presses chrome while claiming
to press empty pane would measure the wrong thing (§6 of the M1 findings, applied to
a new surface).

## 5. The gate, with and without chrome

The gate is §4.5's: p95 < 33 ms at 1k with culling, both legs verified to have
moved something. M3 added a third gate test that measures the **same** fixture with
all of M3's chrome on (`/large-chrome.html`), so the minimap's 1000 rectangles are
a measured cost rather than an assumption.

| Run at this commit                 | drag median / p95 / longest | pan median / p95 / longest | long frames (> 50 ms) |
| ---------------------------------- | --------------------------- | -------------------------- | --------------------- |
| 1k culled, 10 runs                 | 16.7 / 16.7 / 16.8 (498)    | 16.7 / 16.8 / 33.4 (548)   | drag 0, pan 0         |
| 1k culled **with chrome**, 10 runs | 16.7 / 16.7 / 33.4 (504)    | 16.7 / 16.8 / 33.4 (578)   | drag 0, pan 0         |
| 625 comparison, React pan          | drag leg not verifiable     | 16.7 / 16.7 / 33.2 (497)   | 0                     |
| 625 comparison, Svelte drag / pan  | 16.7 / 16.7 / 49.9 (510)    | 16.7 / 16.7 / 16.8 (488)   | 0                     |
| 625 comparison, Foldkit drag / pan | 16.7 / 16.7 / 33.3 (497)    | 16.7 / 16.8 / 33.4 (497)   | 0                     |

Flow metrics from the same runs: `updatePerDispatchMs` 0.0020 (625) / 0.0024 (1k) /
0.0025 (1k + chrome), `cullScanMs` 2.78 (625) / 5.75 (1k) / 5.90 (1k + chrome),
`cullScanSamples` 21 per run. React's drag leg is still unverified by the harness
(M1-FINDINGS §10): `CanDrag` is false for it and the JSON records `drag.count: 0`
with a `dragCoverage` note.

The 1k figures are from `packages/benchmark/results/benchmark-1k.json` and
`benchmark-1k-chrome.json`, which `.gitignore` excludes along with the rest of
`results/` except `benchmark.json` (the 625 comparison, which is committed); both
files are rewritten by `pnpm bench`, so the numbers above are reproducible by
running the gate.

**Chrome costs nothing measurable.** The chrome leg's p95 and longest frame are at
or below the bare leg's, and neither records a long frame. That is the memoization
doing its job: the minimap rebuilds its `<g>` of 1000 rects only when `nodes` or
`nodeSizes` change, and a pan changes neither, so a pan frame writes the
background's two style properties and the minimap's viewport rectangle and nothing
else.

### 5.1 The M2 pan stall: re-baselined before any chrome was added

`docs/M2-FINDINGS.md` §4 left an unexplained start-of-pan stall and asked the next
milestone to re-baseline it _before_ adding chrome. Done first, on the untouched
tree at `2c585ab`, three invocations of the 1k gate:

| Run at `2c585ab` (no M3 code) | drag longest / long frames | pan longest / long frames |
| ----------------------------- | -------------------------- | ------------------------- |
| 1                             | 33.3 / 0 of 495            | 50.1 / 1 of 498           |
| 2                             | 33.4 / 0 of 497            | 66.7 / 2 of 513           |
| 3                             | 33.4 / 0 of 498            | 50.0 / 0 of 504           |

So the baseline is "1–2 long frames at the start of a pan in two invocations of
three", which is the M2 rate (§4: "0–3 long frames in roughly one invocation in
three"). At the commit this document describes, the same leg recorded **0 long
frames in two consecutive runs**, with the same median and p95. Two runs are not
enough to claim the stall is gone — it was always intermittent — but it does mean
no M3 frame is being read as it, and the bound stayed where M2 set it (2% of
recorded frames) rather than being moved to fit a new cost.

## 6. Test coverage map for M3

| Requirement (§7 M3)                                    | Where                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `fitViewport` is pure and tested without a DOM         | `src/geometry/fit.test.ts` (7 cases: centre, padding, empty, unmeasured pane/node, bounds, two nodes)        |
| fit moves the viewport in a browser                    | Playwright proof 24 (transform before/after, every node inside the pane afterwards)                          |
| zoom stops at the engine's bounds, one source of truth | `src/state.test.ts` (`chrome`), Playwright proof 23 (12 presses, then a no-op press)                         |
| background moves with the viewport                     | `src/view/chrome.test.ts`, Playwright proof 22 (position/size at two viewports)                              |
| background is outside the transform                    | `src/view/chrome.test.ts`, Playwright proof 22                                                               |
| no upstream CSS or visual identity                     | `packages/flow/style/flow.css` is the only stylesheet; no import of `@xyflow/*` outside `runtime/adapter.ts` |
| minimap draws the graph and `viewportRect`             | `src/view/chrome.test.ts`, Playwright proof 26 (625 rects, rectangle vs `pane/zoom`)                         |
| minimap does not break the 1k gate                     | `tests/bench.spec.ts` "1000-node culled gate with M3 chrome on"                                              |
| nodes focusable and named                              | `src/view/chrome.test.ts`, Playwright proof 27 (`role`, `aria-pressed`, `aria-label`, tab order)             |
| arrows nudge the focused node into one `MovedNodes`    | `src/runtime/nudge.test.ts`, `src/state.test.ts`, Playwright proof 27 (1px, 10px)                            |
| neither works from an input or `.fflow__nokey`         | `src/runtime/domTarget.test.ts`, Playwright proof 28                                                         |
| description lists nodes and their connections          | `src/view/description.test.ts`, `src/view/chrome.test.ts`, Playwright proof 29                               |
| description updates at commit rate, not per frame      | Playwright proof 29 (`MutationObserver`: 0 records during a 10-step pan), proof 29b                          |
| chrome does not pan or clear the selection             | Playwright proofs 25 (controls) and 30 (panel)                                                               |
| pane/chrome propagation rules                          | `src/runtime/domTarget.test.ts` (`chrome guard`), `src/state.test.ts`                                        |

## 7. What M3 deliberately does not do

- No minimap interaction (click-to-centre, drag-to-pan) — M4 (§2.7).
- No `fitView` options (`minZoom`/`maxZoom`/node filter for the fit itself) and no
  padding control on the button — M4's "fitView options".
- No focus wrapping at the ends of the tab order (§2.6), and no `focusedNodeId` in
  the Model.
- No edge focusability. `model.selectedEdgeIds` is still written but never set from
  the pointer layer (M2-FINDINGS §8); M3's a11y work did not make edges focusable,
  so the question is still open for a milestone that has an edge-selection gesture.
- No live announcements: the description region is not a live region, so a screen
  reader user is not told when a node moves. A polite announcer for
  keyboard-initiated changes is a real feature and a design question (what to
  announce, how often to coalesce), not a line of code.
- No focus ring on handles or edges, and no high-contrast or reduced-motion
  variants of the chrome. `prefers-reduced-motion` is not consulted anywhere yet —
  nothing in M3 animates.
- The `viewMemo` slot is not unit-tested: `createLazy` needs a runtime frame, so it
  cannot be driven outside a render, and `observeLazyResolutions` is `@internal`
  (M1-FINDINGS §6). Its effect is measured where it matters — the chrome gate leg
  above — and the DOM is identical either way, so a DOM assertion would prove
  nothing.
