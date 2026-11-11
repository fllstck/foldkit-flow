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
| `pnpm check`                                   | typecheck, Enfect lint, Prettier, **194** Vitest tests green          |
| `packages/flow` unit tests                     | 194 in 20 files (M2 had 123 in 14)                                    |
| `packages/benchmark/tests/chrome.spec.ts`      | 17 passed (M3 proofs 22–37)                                           |
| `packages/benchmark/tests/connection.spec.ts`  | 5 passed (M2 proofs 17–21)                                            |
| `packages/benchmark/tests/interaction.spec.ts` | 9 passed (M1 proofs 8–16)                                             |
| `packages/benchmark/tests/proofs.spec.ts`      | 4 passed (M0 proofs 2, 3, 3b, 4)                                      |
| `packages/benchmark/tests/bench.spec.ts`       | 3 passed (625 comparison, 1k culled gate, 1k culled gate with chrome) |
| whole Playwright suite                         | 38 tests = 35 proof tests + 3 gate tests, 38 passed in 2.7 min        |

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
   wrapper. Enter and Space activate the focused node (`Message.ActivatedNode`),
   so the role's keyboard contract is honoured rather than advertised (§8.2).
9. **Arrow-key nudging** — `Message.NudgedNode({ nodeId, delta })` from the
   keyboard subscription, `OutMessage.MovedNodes` for one node, one per press.
   `nudgeDelta` (pure) maps the four arrows and Shift; the existing
   `isDeleteKeyAllowed` guard covers the new keys; the mapper is now
   `streamFromEventFilterMapPreventDefault`, so arrows do not scroll the page.
10. **Description region** — a visually hidden `role="region"` beside the viewport,
    memoized on `nodes`/`edges` (§4.3 of the handoff: "a live region that changes
    60×/s is worse than none"). Not a live region at all; 50 nodes and 6
    connections per node, with counts of what is omitted.
11. **Tests** — 61 new Vitest tests (fit, viewportRect, nudge, domTarget chrome and
    focus guards, chrome rendering, the description text, chrome Messages and
    keyboard activation in `state.test.ts`, description memo identity), and 10 new
    Playwright proofs (22–30) plus proof 31 for keyboard activation (§8.2).

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

Two full gate runs at this commit, because the first one is not the whole story
(§5.1):

| Run at this commit (3 runs)        | drag median / p95 / longest | pan median / p95 / longest | long frames (> 50 ms) |
| ---------------------------------- | --------------------------- | -------------------------- | --------------------- |
| 1k culled, run A (pre-review)      | 16.7 / 16.7 / 16.8 (498)    | 16.7 / 16.8 / 33.4 (548)   | drag 0, pan 0         |
| 1k culled, run B (pre-review)      | 16.7 / 16.7 / 16.8 (498)    | 16.7 / 16.8 / 66.7 (551)   | drag 0, **pan 3**     |
| 1k culled, run C (this commit)     | 16.7 / 16.8 / 16.8 (495)    | 16.7 / 16.8 / 66.7 (505)   | drag 0, **pan 3**     |
| 1k culled **with chrome**, run A   | 16.7 / 16.7 / 33.4 (504)    | 16.7 / 16.8 / 33.4 (578)   | drag 0, pan 0         |
| 1k culled **with chrome**, run B   | 16.7 / 16.7 / 16.8 (514)    | 16.7 / 16.8 / 33.4 (602)   | drag 0, pan 0         |
| 1k culled **with chrome**, run C   | 16.7 / 16.7 / 33.4 (501)    | 16.7 / 16.8 / 16.8 (515)   | drag 0, pan 0         |
| 625 comparison, React pan          | drag leg not verifiable     | 16.7 / 16.8 / 33.3 (496)   | 0                     |
| 625 comparison, Svelte drag / pan  | 16.7 / 16.7 / 33.3 (500)    | 16.7 / 16.7 / 16.8 (492)   | 0                     |
| 625 comparison, Foldkit drag / pan | 16.7 / 16.7 / 33.3 (498)    | 16.7 / 16.8 / 33.4 (480)   | 0                     |

Flow metrics from the same runs: `updatePerDispatchMs` 0.0019–0.0027 across the
three legs, `cullScanMs` 2.55 (625) / 5.72–5.81 (1k and 1k + chrome),
`cullScanSamples` 21 per run. The 1k figures are from
`packages/benchmark/results/benchmark-1k.json` and `benchmark-1k-chrome.json`,
which `.gitignore` excludes along with the rest of `results/` except
`benchmark.json` (the 625 comparison, which is committed); both files are rewritten
by `pnpm bench`, so the numbers above are reproducible by running the gate.

**Chrome costs nothing measurable.** Across three runs the chrome leg's p95 equals
the bare leg's, its longest frame is 33.4 ms, and it records **0 long frames** —
while the bare page recorded 0, 3 and 3. That is the memoization doing its job: the
minimap rebuilds its `<g>` of 1000 rects only when `nodes` or `nodeSizes` change, a
pan changes neither, so a pan frame writes the background's two style properties
and the minimap's viewport rectangle and nothing else. It is also not a claim that
chrome makes the library faster — the two legs differ by the same noise the next
section is about.

React's drag leg is still unverified by the harness
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
three").

At the commits this document describes, the bare 1k pan leg recorded **0** long
frames in run A, **3** in run B (longest 66.7 ms) and **3** in run C; the chrome leg
recorded 0 in all three. So the stall is exactly where M2 left it: intermittent, in
the pan leg, at the start of the gesture, and _not_ attributable to M3 — it appears
in runs of identical code that do not agree with each other, and the leg that
carries all of the new rendering work is the one that has not produced it. The bound
stayed where M2 set it (2% of recorded frames, 11 of 505 in run C) rather than being
moved to fit a new cost, and no M3 frame is being read as the old noise. Anyone
picking this up should treat "3 long frames in most invocations" as the current rate
of an unexplained browser-side stall, not as a regression from a number a previous
milestone recorded.

## 6. Test coverage map for M3

| Requirement (§7 M3)                                      | Where                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `fitViewport` is pure and tested without a DOM           | `src/geometry/fit.test.ts` (7 cases: centre, padding, empty, unmeasured pane/node, bounds, two nodes)        |
| fit moves the viewport in a browser                      | Playwright proof 24 (transform before/after, every node inside the pane afterwards)                          |
| zoom stops at the engine's bounds, one source of truth   | `src/state.test.ts` (`chrome`), Playwright proof 23 (12 presses, then a no-op press)                         |
| background moves with the viewport                       | `src/view/chrome.test.ts`, Playwright proof 22 (position/size at two viewports)                              |
| background is outside the transform                      | `src/view/chrome.test.ts`, Playwright proof 22                                                               |
| no upstream CSS or visual identity                       | `packages/flow/style/flow.css` is the only stylesheet; no import of `@xyflow/*` outside `runtime/adapter.ts` |
| minimap draws the graph and `viewportRect`               | `src/view/chrome.test.ts`, Playwright proof 26 (625 rects, rectangle vs `pane/zoom`)                         |
| minimap does not break the 1k gate                       | `tests/bench.spec.ts` "1000-node culled gate with M3 chrome on"                                              |
| nodes focusable and named                                | `src/view/chrome.test.ts`, Playwright proof 27 (`role`, `aria-pressed`, `aria-label`, tab order)             |
| arrows nudge the focused node into one `MovedNodes`      | `src/runtime/nudge.test.ts`, `src/state.test.ts`, Playwright proof 27 (1px, 10px)                            |
| neither works from an input or `.fflow__nokey`           | `src/runtime/domTarget.test.ts`, Playwright proof 28                                                         |
| Enter and Space activate the focused node                | `src/state.test.ts` (`keyboard activation`), Playwright proof 31                                             |
| the description is not rebuilt by a viewport-only render | `src/view/chrome.test.ts` (`description memo identity`)                                                      |
| description lists nodes and their connections            | `src/view/description.test.ts`, `src/view/chrome.test.ts`, Playwright proof 29                               |
| description updates at commit rate, not per frame        | Playwright proof 29 (`MutationObserver`: 0 records during a 10-step pan), proof 29b                          |
| chrome does not pan or clear the selection               | Playwright proofs 25 (controls) and 30 (panel)                                                               |
| pane/chrome propagation rules                            | `src/runtime/domTarget.test.ts` (`chrome guard`), `src/state.test.ts`                                        |

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

## 8. Response to `docs/M3-REVIEW.md`

Two findings, both MEDIUM. One was a false positive with a real question behind it;
the other was correct and is fixed.

### 8.1 The description memo does not invalidate on every render (measured)

The review's premise is that `accessibleNameOf` is declared inside `view()` and is
therefore a new function on every render, changing the memo's input identity. It is
not: `packages/flow/src/view/view.ts:245` declares it in the `createRenderer`
closure, above `view` (line 248), so it is created once per renderer — and the other
three inputs are the parent's `nodes`/`edges` arrays and `config.paneId`.

Rather than argue from the source, I measured it through the public API. With a
two-node graph, `accessibleName` is called twice per render for the node wrappers,
and twice more only when the description is rebuilt. Two renders of the same
renderer, the second with a different viewport, count **4 then 2**: the description
was not rebuilt. A rebuild would have made it 4 then 4. The same property through
the _live_ runtime is invisible to a browser proof (identical text produces no
mutations either way), which is why it is now pinned by
`src/view/chrome.test.ts` (`description memo identity`): a viewport-only render does
not rebuild, a selection change does not either, and a **new `nodes` array does**.

That last case is the honest caveat to attach to the review's finding: the memo is
keyed on references, so a parent that rebuilds `nodes`/`edges` on every render
defeats it. That is the same requirement the node cache already places on a parent
(§3.3: node identity is the cache key) and the demo satisfies it, but it is worth
stating as a test rather than as a claim.

The review's alternative remedy — "use stable configuration references directly in
the memo inputs" — would not have changed anything, because `accessibleNameOf` is
already stable. `createLazy` also mixes the dispatcher and the Mount render owner
into its key, which looked like a second suspect; both are stable per runtime
(`runtime/runtime.js` creates one `htmlBuilder` per runtime and
`runtime/renderer.js` reuses it, and the boundary registry is supplied per runtime),
and the probe above crosses two independent renders, so a frame-driven miss would
have shown up in the counts.

### 8.2 Enter and Space now activate a node — fixed

Correct, and a real gap: `role="button"` with `aria-pressed` promises activation a
keyboard user could not perform. Added:

- `Message.ActivatedNode({ nodeId, isAdditive })`, dispatched by the keyboard
  subscription for `Enter` and `" "` when the focused element is inside a node;
- the selection rules are **shared with `PressedNode`** (`nextNodeSelection` in
  `update.ts`), so the two input paths cannot diverge: a modifier toggles, a bare
  activation replaces the selection, a node that opts out of selection leaves it
  alone, and an id the parent no longer has is ignored;
- activation arms no drag (there is no pointer to own a gesture) and clears
  `selectedEdgeIds` unless the modifier is held, exactly like a press;
- Shift comes from the event, so `Shift+Enter` is the additive toggle that
  `Shift + press` already was. Space is `preventDefault`ed on a focused node — it
  would otherwise scroll — and left alone everywhere else, so `Enter` on a focused
  chrome button still clicks it.

Coverage: `src/state.test.ts` (`keyboard activation`) for the four selection cases
and the no-drag rule, and Playwright proof 31 for the browser: `Shift+Enter` toggles
`aria-pressed` to `false`, Space turns it back on without moving the node, Space
inside the node's text input types a space and activates nothing, and Enter with a
control button focused zooms instead of selecting.

Adding the variant surfaced both exhaustive `Flow.Message.match` sites (the demo's
statistics counter and the benchmark page) as a **runtime crash**, not a type error,
because `vite build` does not typecheck: the proof failed with Foldkit's crash view
and "(intermediate value)(intermediate value)(intermediate value) is not a
function". `pnpm typecheck` named both sites immediately. The fast loop for a
Message change therefore starts with `pnpm typecheck`, not with `pnpm build` — the
`dist` only matters for the example and benchmark typechecks, which are the same
command.

## 9. Response to `docs/M3-REVIEW-2.md`

No findings in the second pass. Both first-pass items are confirmed fixed, and the
review's own validation (`pnpm check` with 184 unit tests, 32/32 Playwright) matches
this document's table.

Two record-keeping notes, since the difference matters if someone reads the reviews
in order:

- **The description memo needed no code change for the first finding.** The review
  describes `accessibleNameOf` as "now created once per renderer rather than once
  per `view()` call"; it was already in the `createRenderer` closure in `69a630e`,
  the commit that added it (`view.ts:245`, above `view` at line 248). What §8.1
  added was the measurement and the regression test, not a fix. The memo was
  behaving as claimed before the first review; the review's premise was wrong, not
  the code.
- **`packages/benchmark/results/benchmark.json` in this commit is the reviewer's
  validation run** of the same code, not a new measurement on my side: the diff is
  the 625 comparison's frame counts and longest frames (foldkit drag
  16.7/16.7/33.3 → 16.7/16.8/16.8, Svelte pan longest 16.8, and the per-dispatch
  and cull-scan figures), all inside the run-to-run noise the §5 table already
  records. The 1k legs are unchanged in kind and remain in the git-ignored
  `benchmark-1k*.json`.

The review's note about a chrome-only run failing on a preview-server/port
collision before the first test is the M1 finding §11 class of problem: a preview
left running owns port 4173 while `webServer.reuseExistingServer` is true, so
`pkill -f vite` before a suite run is still the documented first step.

## 10. The "could not start safely" shield, and an SSR-stateful stat it hid

Reported after M3 was closed: the demo page shows Foldkit's
"This page could not start safely" modal. That modal is the build-skew guard
described in `M1-FINDINGS.md` §11: `Runtime.hydrate` compares the
`data-foldkit-build` stamp on the served root with the build id baked into the
client bundle, and refuses the handoff when they differ. It is not an application
error, and nothing in M3 changed the mechanism.

Diagnosis, in order, at this commit:

1. **On disk the two stamps agree.** `packages/example/dist/client/index.html`
   carries `data-foldkit-build="8583928e-…"` and the id inside
   `dist/client/assets/app-*.js` is the same value, so a preview served from a
   fresh `pnpm build` cannot trip the guard.
2. **A fresh browser context boots both servers cleanly.** A Playwright probe of
   `vite preview` (production build) and `vite` (dev) recorded
   `main.app` present, `data-measured-nodes="625"`, `body[inert]` absent, no
   shield, and no hydration warning — on both.
3. So the skew is in the client, not the checkout: a cached page from an earlier
   build talking to a server that is now serving a newer one. That is exactly what
   a session of `pnpm build` runs with a preview server left alive produces, which
   is the reproduction in M1-FINDINGS §11; the browser keeps the old HTML while the
   assets it references no longer exist.

The recipe is unchanged and now stated in the README: stop every server
(`pkill -f vite`), `pnpm build`, serve again, and hard-reload (a reload alone cannot
help if the browser keeps handing back the cached HTML). The console carries the
useful half of the message:
`[foldkit] Runtime.hydrate found application "app" served by deployment "X", but
this client belongs to deployment "Y"`.

**The bug the investigation did find: the demo's `cache` stat made `view`
SSR-stateful.** The toolbar rendered `renderer.cacheSize()`, which reads mutable
renderer state _during_ `view`. In dev the SSR module (and its module-scope
renderer) is reused across requests, so the served markup carried `cache: 625`
from a previous render while the client's first view — a fresh renderer that has
not yet rendered a node — carried `cache: 0`. Foldkit warned on every load:

> `[foldkit] The server DOM did not match the first client view during hydration.
Foldkit reconciled the mismatching subtree.`

Measured before and after removing the stat from the demo's toolbar, with the same
Playwright probe against the dev server: the warning is present before and absent
after, and no other hydration warning takes its place. The stat was diagnostic
only — no proof or unit test reads it, and `renderer.cacheSize()` remains a public
diagnostic on the renderer, asserted in `src/view/cache.test.ts` — so the demo now
says why it is not rendered. `view` must be a pure function of the Model; a number
that changes because of what the _previous_ render did is not.

## 11. Reported after M3: the connection preview drew above the pointer

Reported from a browser session: "when I draw an edge, it doesn't show up at the
position of my cursor, but somewhere above", and "the edges can't be connected to
another node". Both reproduced, and they have different causes.

### 11.1 The preview was drawn in flow coordinates, in an untransformed layer

The connection preview is geometry in **flow space** — the source anchor and the
pointer are both converted with `screenToFlow` — but the `.fflow__connection`
layer is a sibling of `.fflow__viewport`, not a child of it, so nothing applied the
viewport transform to it. The line was drawn at raw flow coordinates: at the demo's
`{ x: 20, y: 200, zoom: 0.9 }` that is ~200 px above the pointer, which is exactly
what was reported. M2 had the same placement, but its viewport was `y: 30`, so the
error was ~27 px and nobody noticed; M3 moved the demo's initial viewport down to
clear the panel and made a latent bug obvious.

Two changes, both needed:

1. The preview's path is wrapped in a `<g>` carrying the viewport transform, so
   flow space lands on screen. `non-scaling-stroke` on `.fflow__edge-path` keeps
   the stroke 1.5 px through the scale, as the committed edges do.
2. A **unitless** transform (`svgTransformOf`, `translate(20, 200) scale(0.9)`).
   The first attempt reused `transformOf`, whose CSS-form `translate(20px, 200px)`
   is silently ignored on an SVG `transform` attribute: the attribute was present
   in the DOM and inert, and `getScreenCTM()` still reported the identity scale.
   That is why the proof measures a **screen-space** point rather than reading the
   attribute — the attribute looked right.

Playwright proof 32 pins it: it takes the preview path's end through
`getScreenCTM()` and asserts it is within 3 px of the pointer, and that it is more
than 20 px away from where the untransformed flow coordinate would land.
`connection.test.ts` also asserts the `<g>` transform, since the shape of the
preview markup is now part of what makes it correct.

### 11.2 Connecting works; the demo rejected duplicates silently

The second report was not a defect in the connection path. Measured in the browser:
dragging `n0.out` onto `n2.in` produced `data-connection-target="n2:in"`,
`data-last-edge="n0:out>n2:in"` and one new edge — hit-testing, the release and the
parent's fold all work.

What was happening is the demo's own fixture: `buildGraph` gives **every
consecutive pair** an edge, so the natural gesture — connect a node to the one next
to it — is a duplicate, which the demo's `isValidConnection` rejects by design
(M2-FINDINGS §2.1). The library emits nothing on a rejection (that is the
documented contract), so the UI showed nothing at all, and a rejected connection is
indistinguishable from a broken one.

The demo now surfaces the attempt. It reads the hovered candidate from the gesture
(`n0:out > n1:in`) into `lastAttempt`, shows it in the toolbar's stats and in
`data-last-attempt`, and clears it when a connection or reconnect fact arrives —
the fold is the only thing that knows the attempt succeeded. Proof 33 covers both
halves: a duplicate leaves `data-last-attempt="n0:out > n1:in"` with the edge count
unchanged and no `data-last-edge`, and a novel pair adds the edge and clears the
indicator.

The library-side rule is unchanged and still the documented one: the predicate is
asked at release only, so a hover still previews a target the parent will reject.
An "invalid target" style during hover would need the predicate to be asked per
pointer move, which M2 rejected on the hot path (§2.1) — the indicator is the cheap
half of that feedback and it lives where the policy lives, in the consumer.

## 12. Reported after M3: node text "flickering while selected", and edges that "do not connect"

Two reports from the same session, both reproduced and fixed. Neither was a
regression from M3, but both were real.

### 12.1 Dragging selected the page's text

Dragging from a handle across a node's label left the browser's own text selection
behind: measured `window.getSelection().toString()` → `"\nNode "`, and the
selection grows and shrinks under the pointer for the length of the gesture, which
is what "the text of some nodes flickers because it's selected" describes. Our
stylesheet set `touch-action: none` on the pane but never `user-select: none`, so
every label was a text-selection target for a pointer drag. `XYPanZoom`'s
`userSelectionActive: false` does not help either: that flag suppresses _d3's_
selection handling, not the browser's.

`.fflow__pane` now sets `user-select: none` (with the `-webkit-` prefix), and
inputs, textareas and `contenteditable` inside a node set `user-select: text` again,
so a node's note field stays usable. Proof 34 drags a connection straight across
another node's label, asserts `getSelection()` is empty, and asserts the input's
computed `user-select` is `text`.

### 12.2 A handle had to be hit exactly

The other report is what "the edges don't connect to nodes" turned out to mean: a
release had to land inside the handle's 8×8 _flow-space_ box — about 7 px on screen
at 0.9 zoom — so dropping anywhere on the node, which is what people do, connected
nothing. `hitTestHandle` already accepted a `tolerance`, but `update` never passed
one.

`connectionRadius = 20` (screen pixels) is now applied at both hit-test sites and
divided by the zoom, so the target feels the same at every scale. Two rules keep it
predictable:

- an exact box hit still wins and still resolves by DOM order ("the visually
  topmost handle"), which is what the existing tests pin;
- with slack the boxes overlap, so the **nearest centre** wins instead of the last
  match — otherwise a generous radius could snap to the far side of a node.

`src/geometry/hitTest.test.ts` covers the radius, the nearest-wins rule under
overlap, the zoom conversion, and that `accept` still filters first. Proof 35
releases 14 px inside the target node, clear of the handle box, and gets
`data-connection-target="n3:in"` and `n0:out>n3:in`.

One scope note: the radius is a constant, not a `RendererConfig` option. Upstream
exposes `connectionRadius` as a prop; if a consumer needs to tune it, the honest
place is this constant behind a config field, and that is a one-line change when
someone asks (M4's options pass).

## 13. Reported after M3: the preview snaps to a target, then the release does nothing

The follow-up to §11.2, and this time the report is precise: "the edge preview is
now snapping to the connector box when I drag it anywhere over a target node, but
it simply disappears when I stop dragging."

The snapping is the new `connectionRadius` (§12.2) working. The disappearing is the
demo again, in two layers:

1. **The fixture made the natural gesture a duplicate.** `buildGraph` linked every
   consecutive pair, so dropping on the neighbouring node — the first thing anyone
   tries — was always rejected by the demo's own `isValidConnection`. The graph now
   links every step _except every third one_ (416 of 624), which leaves plenty of
   pairs that can be connected while still demonstrating the duplicate rule. The
   pairs the proofs depend on are untouched: `e1` (n0→n1) and n3→n4 still exist,
   n0→n2 is still novel, and `e1` is still the edge proof 19 reconnects.
2. **The rejection notice was in the wrong place.** §11.2 put it in the toolbar's
   stats row, which is not where anyone looks mid-gesture. It now also lives in the
   consumer panel next to the graph — "Not connected: n0:out > n1:in" after a
   rejected release, and a one-line hint when there is nothing to report. Same
   state (`lastAttempt`), so the two cannot disagree.

Measured end to end, at the demo's initial viewport:

| Gesture                                       | Result                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `n2.out` → drop on n3's body (a fixture gap)  | edges 416 → 417, `data-last-edge="n2:out>n3:in"`, panel back to the hint |
| `n0.out` → drop on n1's body (a fixture link) | edges unchanged, panel "Not connected: n0:out > n1:in"                   |

Proof 33 now asserts both halves of the panel text as well as the
`data-last-attempt` attribute. The description proof's connection count moved with
the fixture (416), and `docs/M3-FINDINGS.md` §12's numbers are otherwise unchanged.

The library is unchanged by this section: the predicate is the consumer's, and a
rejected release still emits nothing. What changed is that the playground no longer
makes every connection attempt fail, and that a failure is stated where the user is
looking.

## 14. Reported after M3: "the connection works but the edge is invisible"

The root cause of the whole thread, and it is older than M3: **no edge was ever
painted**. The paths were in the DOM with the right `d`, the right stroke colour,
and a computed `stroke-width: 1.5px`, and not one pixel was drawn.

### 14.1 Why nothing painted

`.fflow__viewport`'s children are absolutely positioned, so the viewport element
itself shrinks to **0×0** — and `.fflow__edges`, sized `width="100%"
height="100%"`, inherits that. A zero-sized SVG viewport makes
`vector-effect: non-scaling-stroke` degenerate: the property resolves the stroke
against the viewport it is scaled into, so the stroke width collapses and the path
paints nothing. `getComputedStyle().strokeWidth` still reports `1.5px`, because
that is the CSS value; the _rendered_ width is what degenerates. `overflow:
visible` kept the geometry inside the drawing area, which is why nothing looked
wrong from the DOM side.

Measured on the demo, before the fix: `.fflow__edges` `clientWidth: 0`,
`clientHeight: 0`, viewport 0×0, while the pane is 900×600.

The fix is one rule: `.fflow__viewport` gets `width: 100%; height: 100%`, so the
edges SVG has a real viewport (810×540 after the 0.9 transform, 900×600 in user
units) and the stroke resolves to a constant 1.5 screen pixels again. Nothing else
changed — no geometry, no markup, no API.

### 14.2 Why the proofs did not catch it

Every M1/M2 assertion about edges was a **DOM or geometry** assertion: `d` strings
against `edgePath`, endpoints against handle centres, `data-edgeid` presence. All
of them are satisfied by a path that draws nothing. The connection _preview_ was
the only edge-like thing that painted, because `.fflow__connection` is a direct
child of the pane and therefore has a real 900×600 viewport — which is why
clicking an edge's end (starting a reconnect) made a line appear: that line was the
preview, drawn above the nodes.

Playwright proof 36 closes the class of bug rather than the instance:

- it asserts `.fflow__edges` has a non-zero `clientWidth`/`clientHeight`, naming the
  invariant that broke;
- it screenshots the gap an edge crosses, hides the edges layer, screenshots the
  same crop again, and requires the two to differ. A path that paints nothing
  produces identical pixels, whatever the DOM says.

### 14.3 The reports this explains

With edges invisible, every symptom in §11–§13 was being read through the wrong
model:

| Report                                | What was actually happening                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| "edges don't connect to nodes"        | connections worked; nothing was _drawn_, and the only visible line was the reconnect preview  |
| "the preview is above the cursor"     | real bug (§11.1) — the preview layer is outside the transform                                 |
| "invisible until I click a connector" | the grab ring and its hover stroke exist without a visible edge; clicking draws the _preview_ |
| "the text flickers when I drag"       | real, separate bug (§12.1)                                                                    |

The other fixes in §11–§13 stand on their own — the preview transform, the
connection radius, the sparse fixture and the panel feedback are all real
improvements — but the report that started them was this one.

### 14.4 The gate with edges painting

Edge strokes are paint work the previous milestones never measured, so the 1k gate
was re-run with them visible: drag 16.7/16.8/33.3 and pan 16.7/16.8/33.4 with
**0 long frames**, and the chrome leg 16.7/16.8/33.4 with 0 — the same
distribution as before, inside the noise §5 already documents.

## 15. Reported after M3: edges only update when a dragged node is dropped

Correct, and not intended. The drag overlay renders the node at `position + delta`
while the parent's positions are untouched until release (§4.5), but the edge
endpoints were computed from the **committed** positions only — so an edge hung at
the node's old place for the whole gesture and snapped into position on release.

The renderer now applies the same delta to the anchors of edges whose end is on a
dragged node (`shiftForDrag` in `view.ts`), and only to those ends: an edge between
two untouched nodes is the memoized geometry unchanged. The cost is nil — the
`d` strings were already rebuilt per render, and the memoized endpoints are still
reused as-is, because the shift happens on the way into `edgePath`, not in the memo.

Tests: `src/view/edges.test.ts` (`edge geometry during a node drag`) covers an
edge following its dragged target, only the attached end moving, and an unrelated
edge not changing. Playwright proof 37 does it in the browser: the `d` changes
mid-gesture, and after release the committed path starts within 0.01 of where the
overlay had it — compared numerically, because the two values come from different
arithmetic (handle centre plus a delta, then committed position plus handle centre)
and differ in the last float digits.

The gate is unaffected: the 1k legs are 16.7/16.8 with **0 long frames** in both
the bare and the chrome page, which is the same distribution as before the change.

## 16. Response to `docs/M3-REVIEW-3.md`

No findings in the third pass, and nothing in the review to act on. Its validation
matches the run this document describes: `pnpm check` with **194** Vitest tests in
20 files, 35 proof tests, 3 gate tests.

Two notes for the record, since the review summarises a thread of fixes whose _causes_
matter more than the list:

- The review's list is accurate as a description of what changed, with one wording
  worth tightening: the example advertises the _supported_ connectability — the panel
  names the edge that was created, or the attempt that was rejected, and the fixture
  leaves every third link open so a connection can succeed. The limitation it refers
  to is in the hit test, not the example: a connection resolves only to the **opposite**
  handle type (`accept` in `update`'s two `handleNear` call sites), so a target handle
  must be dropped on a source handle and the pair is oriented at release (§M2-FINDINGS
  §9). Dropping a target handle on a node body therefore snaps to that node's _source_
  handle, or to nothing.
- The one infrastructure failure the review hit — `ERR_HTTP_RESPONSE_CODE_FAILURE` on
  port 4174 — is the preview-server collision in `M1-FINDINGS` §11 and the README's
  fast-loop note: a preview left running plus `reuseExistingServer` means the next run
  navigates into a server it did not start. `pkill -f vite` before a suite run is the
  documented mitigation, and no test body ran in the failing case.

Nothing in `docs/PLAN.md` changes as a result of this pass, and the "Remaining notes"
section is right that the earlier review files are history: `M2-REVIEW.md`'s HIGH
finding (target-originated connections emitting reversed endpoints) is fixed and
covered by `src/geometry/edgeEndpoints.test.ts` (`connection orientation`),
`src/state.test.ts` and proof 21, and the M3 accessibility gaps are covered by proofs
27–31.
