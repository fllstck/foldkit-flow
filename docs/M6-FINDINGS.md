# M6 findings: three ships, eight keep-outs, and the numbers

`docs/M6-RESEARCH.md` is the decision; this is the record of what the decision
produced, what it cost, and what is still open. Written at the commit that carries it,
2026-11-12, against `PLAN.md` §7 M6 and `docs/M6-HANDOFF.md`.

## 1. What M6 changed

Three behaviours, all **opt-in**, all researched first:

| Ship                                       | Public surface                                                                          | Where the verdict is |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------- |
| Edge selection and edge focus, as one unit | `RendererConfig.edgeSelection`, `Message.PressedEdge`, `Message.ActivatedEdge`          | `M6-RESEARCH.md` §2  |
| Drag-to-pan inside the minimap             | `Message.StartedMiniMapPan`, `Gesture.MiniMapPanning`, `geometry/minimap` press mapping | `M6-RESEARCH.md` §4  |
| Aspect-ratio locking on a resize           | `ResizeOptions.keepAspectRatio` (driven by `isAdditiveModifier`)                        | `M6-RESEARCH.md` §7  |

Nothing was removed, nothing defaulted on, and no existing OutMessage changed shape.
`Flow.update`, `Flow.init`, `Flow.createRenderer` and all seven facts a consumer folds
are what they were; the two new Messages are a _renderer_'s output, which a consumer
that never sets `edgeSelection` will never see.

The three keep-outs that mattered most for the code that already exists — `XYResizer`
(§3), `nodeOrigin` (§5), parent-resize compensation (§6) — left the M4 code paths
untouched, which is the point: each of their verdicts says the current design is the
answer, not a shortcut.

## 2. The gate, at this commit

`pnpm bench`, 61 tests, 5.0 min, one worker, machine otherwise idle (`uptime` 2.48
before the run). Frame durations in ms, `median / p95 / longest`, frame
count in parentheses. This run rewrote every JSON in `packages/benchmark/results/` **at
the state this document's commit carries** — an earlier run at the same code state (only
the doc commits differ) agreed on every frame row within one frame, and its startup
numbers moved more than the frame numbers did (§5).

| Leg                       | Drag                     | Pan                      | Long frames (> 50 ms) |
| ------------------------- | ------------------------ | ------------------------ | --------------------- |
| 625, React Flow 12.12.1   | not verified¹            | 16.7 / 16.7 / 33.3 (501) | 0                     |
| 625, Svelte Flow 1.7.1    | 16.7 / 16.8 / 33.4 (501) | 16.7 / 16.7 / 16.8 (490) | 0                     |
| 625, Foldkit Flow         | 16.7 / 16.7 / 33.3 (502) | 16.7 / 16.7 / 16.8 (471) | 0                     |
| 1k culled                 | 16.7 / 16.7 / 33.3 (492) | 16.7 / 16.8 / 16.8 (473) | 0                     |
| 1k culled **with chrome** | 16.7 / 16.8 / 16.8 (496) | 16.7 / 16.8 / 16.8 (473) | 0                     |

¹ unchanged from M1: React Flow's node drag does not engage under this harness, and the
harness reports that rather than recording idle frames.

**The gate holds**: 625 at parity with React Flow on pan — identical median and p95, and
React Flow's single 33.3 ms frame is one Foldkit did not record — 1k inside the 33 ms
p95 bound, zero long frames in 1 907 pan and 1 490 drag frames. The occasional
33.3–33.4 ms frame is the single dropped frame the M2 §4 stall allowance exists for; the
counts are reported beside them and the 2 % bound (10 frames per 1k leg) is never
approached.

Per-scan and per-dispatch cost from the same run:

| Leg           | `cullScanMs` | `updatePerDispatchMs` |
| ------------- | ------------ | --------------------- |
| 625           | 0.498        | 0.0020                |
| 1k culled     | 0.750        | 0.0034                |
| 1k + chrome   | 0.660        | 0.0021                |
| 10k collapsed | 3.242        | —                     |
| 10k expanded  | 5.422        | —                     |

The 10k explorations are unchanged in character: 280 of 10,000 nodes rendered at
expanded 10k with 277 pan frames at 16.7 / 16.8 / 33.4, and 200 of 10,000 at collapsed
10k with 252 frames at 16.7 / 16.7 / 33.3. Startup: 523 ms to first view and
**1 201 ms to settle** on the expanded page — the number §7 keeps as a candidate.

**No M6 ship is on any gate page.** `/m6.html` is its own page and the media queries,
the culling scan and the node cache are unchanged; the gate's DOM is byte-for-byte what
M5 measured. That is why the numbers are re-run rather than re-derived, and why the
"unchanged" claim is a measurement and not a promise.

## 3. What each ship is, and what proves it

### Edge selection and edge focus (§2 of the research)

A press on an edge selects it, and the edge is a tab stop with Enter/Space. Off by
default (`edgeSelection: true`), because it costs one invisible path per edge and a
consumer that never deletes an edge should not pay it.

- **The hit path** is a second `<path>` with the same `d`, `stroke: transparent`,
  `stroke-width: 20` **flow units** and `pointer-events: stroke`, drawn _after_ the
  visible path — so `querySelector("… path")`, which the marker, reconnect and gallery
  proofs use, still finds the painted one. The number 20 is upstream's
  `interactionWidth` default; the unit is flow-space because `view` must not read the
  zoom to size an element (`M6-RESEARCH.md` §2).
- **The layer** loses `aria-hidden` when the feature is on, because a focusable
  descendant of a hidden subtree is an ARIA violation. Off, it keeps it, which
  `view/markers.test.ts` still asserts.
- **The pane declines the press** (`runtime/domTarget.ts` → `isEdgeTarget`), or the pane
  handler would clear the selection the edge press just made. That guard is the reason
  the feature works at all, and it is `view/selection.scene.test.ts`'s second test.
- **The name** comes from the consumer's `accessibleName` hook: `Edge from <source> to
<target>`, plus `: <label>` when the edge has one. The tab order and the description
  region therefore call the same nodes the same words.
- **Tab order is DOM order**, and the edges layer renders before the nodes layer, so the
  sequence is all edges then all nodes — the same consequence React Flow has, documented
  rather than "fixed" (`M6-RESEARCH.md` §2, and candidate 2 in §7 here).

Proofs: rung 1/2 arithmetic and transitions (`state.test.ts`, 6 tests; rung 3 wiring and
aria in `view/selection.scene.test.ts`, 4 tests); rung 5 `tests/m6.spec.ts` proof 47
(press selects, and two screenshots differing only in the selection differ — a
`computedStyle` read would not have been a paint assertion) and proof 48 (Tab lands on an
edge, its `role` and name are right, Enter selects, Escape clears). **Watched failing**:
with `edgeSelection: false` on the page, 47 and 48 fail.

### Minimap drag (§4)

A press centres the view _and_ arms a drag; each pointer move is one `setViewport`.
Upstream's `pannable` is d3-zoom on the minimap; ours is a Flow gesture, because there is
no pan/zoom handle for a minimap to drive here and because the mapping
(`getScreenCTM()`) belongs to the element that owns it.

- The press reads the matrix **once** and carries `{ point, screen, scale }`, so no
  frame of the drag touches the DOM and `MovedPointer` stays a pure function of the
  gesture (`state.test.ts`, 7 tests).
- The pan is absolute from the anchor, not accumulated, so a rounded drag cannot drift.
- `scale` is **flow units per screen pixel** — the inverse of the matrix's x scale. The
  first implementation used the matrix scale itself, and proof 49 caught it: the
  viewport rectangle moved 0.6 px instead of ~24. That is the whole reason the proof is
  a screen measurement.

Proof: `tests/m6.spec.ts` proof 49 — grab the viewport rectangle in the minimap, drag it
24 × 12 screen px, and assert the rectangle moved on screen, the Model and the engine
agree about the resulting viewport (`DOMMatrix` off the computed style, 1e-2), and the
gesture is `Idle`. **Watched failing**: the scale inversion above.

### Aspect locking on a resize (§7)

Hold the additive modifier (Shift, ⌘ or Ctrl) during a resize and the box holds its
**start** aspect ratio; the axis the pointer moved further, proportionally, decides and
the other is derived. It is a modifier rather than a renderer prop because our config has
one `resize` boolean for the pane and upstream's per-control `keepAspectRatio` has no
place here; it is read per pointer event from `model.isAdditiveModifier`, so pressing or
releasing it mid-gesture changes the next frame — the live behaviour tldraw has, with no
new Message field and no new DOM read.

Proofs: `geometry/resize.test.ts` (4 cases: the rule, the anchored corner, the minimum,
a degenerate box) and `state.test.ts` ("the additive modifier holds the box's ratio,
live" — free box, held, released, all mid-gesture); rung 5 `tests/m6.spec.ts` proof 51
holds Shift down and drags a corner mostly downwards, then asserts the mid-gesture ratio
and that the four corner controls are still 10 × 10. **Watched failing**: with
`keepAspectRatio` hard-wired to `false`, 51 fails.

### The example page is a second consumer

`/examples/resizing/` turns `edgeSelection` on in its own spec, so the feature ships on
two pages. Writing that up found a **consumer bug the library change exposed**: the
harness's `SelectedElements` fold read only `nodeIds`, so a page whose entire job is to
show what the flow reported said "Nothing selected" with an edge selected. Fixed in
`packages/example/src/examples/harness.ts` (`selectionSummary`), with a rung-2 test.
`tests/m6.spec.ts` proof 50 walks the page and reads the folded fact.

## 4. What M6 deliberately did not ship

Each is argued in `docs/M6-RESEARCH.md`; this is the list, with the evidence that the
reason still holds. **Three of these were taken in M7** — marked below, because a
verdict changes when the code does, and this list is the record rather than the last
word (`docs/M7-FINDINGS.md`).

- **`XYResizer`** (§3, gap 1). Its `getStoreItems()` is read on every drag event and its
  whole node lookup is walked at drag start; Mount args are captured, `view` may not
  write. Our gesture is the snapshot design tldraw also uses.
- **`nodeOrigin`** (§5, gap 4). Every position here is a property of the graph alone, so
  SSR and the first frame need no measurement. An origin would make each position a
  function of the graph _and_ a measurement.
- **`resizeDirection`** (§7). The four corner controls already answer it: the edge
  midpoints belong to the port handles (M4 §2.7).
- ~~**`shouldResize`** (§7)~~ — **taken in M7 as `Flow.Context.canResize`.** The
  keep-out was right about upstream's callback, which returns a replacement box and
  rolls back the parent's box, the start position and every child's position
  (`@xyflow/system@0.0.84` `dist/esm/index.js:3607`–`:3615`). It was too broad about a
  _predicate_: `{ node, start, next, modifier } → boolean` is consumer code outside the
  gesture loop, in the same seam as `isValidConnection`, and a rejected frame keeps the
  last accepted box (`docs/M6-RESEARCH-FOLLOW-UP.md` §3,
  `docs/M6-RESEARCH-FOLLOW-UP-REVIEW.md` §3, `docs/M7-FINDINGS.md`).
- ~~**Parent-resize child compensation**~~ (§6, gap 5) — **taken in M7 as
  `Flow.compensateChildPositions`.** The reasoning still holds and is why the helper
  _returns_: a consumer that did not persist the positions would watch children snap
  back on release (the M4 §14 bug). The arithmetic is now a pure function returning
  direct children's relative positions from the parent's own before/after pair, and
  `docs/CONTRACT.md`'s worked example is a call rather than prose
  (`docs/M6-RESEARCH-FOLLOW-UP.md` §4).
- ~~**Interactive edge labels**~~ (§8, gap 7) — **taken in M7 as
  `RendererConfig.edgeOverlay`**, the shape this list already named: HTML anchored on
  the edge's label point, `scale(1/zoom)`, consumer-owned markup. What stays out is an
  interactive `renderEdgeLabel`; the SVG text hook keeps its content-only contract
  (`docs/M6-RESEARCH-FOLLOW-UP.md` §2).
- **Multi-node resize** (§9, gap 8). Upstream has no precedent; tldraw's answer is a
  second resize _mode_. One box per gesture stays, documented.
- **Handle geometry during a resize** (§10, gap 9). Upstream re-measures from its own
  `ResizeObserver` too, so the one-frame lag is the same lag; MDN locates it in our
  coalescer rather than in paint, and a pure re-derivation cannot be exact for consumer
  CSS.
- **The culling scan** (§1, gap 10). 0.50 / 0.75 / 0.66 ms at 625/1k/1k-chrome and
  5.42 ms at an expanded 10k, inside a 16.8 ms p95 frame with zero long frames. tldraw's
  R-tree is the counter-example _and_ the warning: its index needed two later releases
  (#8882 → #9093) to stop being O(page) per update, which in our geometry is exactly the
  case that matters.
- **Minimap wheel-zoom and per-node targets** (§4). `zoomable` is off by default upstream
  too, and a minimap press already centres on the pressed node.

## 5. Deviations, and the two traps that bit

- **PLAN.md is untouched**; this document is the deviation record, per the working
  agreement. There is one substantive difference from §7 M6's wording: the plan asks for
  "a Story test for pure logic, a Playwright proof for the gesture and the paint". The
  edge-selection _transitions_ went to rung 2 (`state.test.ts`) and the _wiring_ to rung
  3 (`view/selection.scene.test.ts`) because Story cannot see the view and Playwright can
  only see outcomes — `docs/TEST-STRATEGY.md`'s rule, applied.
- **`[data-edgeid]` is the edge count.** `tests/examples.spec.ts` and
  `tests/gallery.spec.ts` count edges with `querySelectorAll("[data-edgeid]")`, so the
  new interaction path carries **no** `data-edgeid`; a second element with that attribute
  would have silently doubled every count. The comment lives on
  `view/classes.ts`'s `EdgeInteraction` so the next person does not "fix" it.
- **`h.Tabindex` sets a property, not an attribute.** The house helpers
  (`h.Tabindex`, `h.Role`) write to the DOM _property_, and jsdom has no `tabIndex` on an
  `SVGElement`, so the edge group uses explicit `h.Attribute("tabindex", "0")` — the only
  spelling true in both places. Found by the Scene test, which is a rung-3 success.
- **`getScreenCTM()` maps user → screen.** The scale inversion in §3 is the clearest
  example this milestone produced of a proof earning its keep: the arithmetic was
  plausible, the code read correctly, and only a screen measurement showed the drag
  moving 0.6 px instead of 24.
- **The `write` tool wrote 0 bytes all session** (reported success, empty file, twice
  through a retry). New files — this one, `M6-RESEARCH.md`, the scene test, the benchmark
  page and spec — were created through `python3` heredocs instead, and every one was
  read back and tested. Worth knowing for the next session: the tool's failure mode is
  silent, so a file's existence is not evidence of its contents.

## 6. The eleven gaps, as M6 leaves them

| #   | Gap                                                  | Verdict                                                             | Where |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------- | ----- |
| 1   | `XYResizer`                                          | keep out                                                            | §3    |
| 2   | Minimap interaction                                  | **ship differently** — click + drag, no wheel, no node targets      | §4    |
| 3   | Edge selection                                       | **ship** — `edgeSelection: true`                                    | §2    |
| 4   | `nodeOrigin`                                         | keep out, with the boundary conversion written down                 | §5    |
| 5   | Parent resize re-placing children                    | keep out, as the parent's job (the formula is in the research)      | §6    |
| 6   | `keepAspectRatio`, `resizeDirection`, `shouldResize` | **ship differently** — aspect lock as a modifier; the other two out | §7    |
| 7   | Interactive edge labels                              | keep out, with the overlay shape named                              | §8    |
| 8   | Multi-node resize                                    | keep out, single-box rule documented                                | §9    |
| 9   | Handle geometry during a resize                      | keep out, one-frame lag accepted and located                        | §10   |
| 10  | The culling scan                                     | keep out, with the numbers                                          | §1    |
| 11  | Edge focus and the tab order                         | **ship** — edges are tab stops, named, Enter/Space                  | §2    |

## 7. Candidates, with numbers where they exist

Written down, not built (`PLAN.md` §7 M6: "no new product scope").

1. **The 10k startup cost: 1 207 ms to settle** (522 ms to first view), because the first
   render happens before the pane is measured, so culling is off for it and all 10,000
   nodes mount before the measurement trims the DOM to 280. The largest cost in the
   library, a _design_ question, and it changes the DOM the 10k explorations count.
2. **A composite-widget tab stop** for the graph (one tab stop, arrow keys inside), which
   is what the ARIA APG actually prescribes for a widget with many focusable parts. Both
   xyflow and this library put every node — and now every edge — in the sequence. A
   keyboard-model change, not a gap.
3. **An HTML overlay layer for edge controls**, with the `scale(1/zoom)` arithmetic the
   pinned engine exports (`getEdgeToolbarTransform`). The prerequisite for interactive
   labels.
4. **`edgeSelection` in the gallery.** No fixture was added: the gallery compares
   _geometry_ between two libraries on one input, and none of M6's ships changes a path
   `d` string or a node box on a shared input. The paint proof is ours (proof 47).
5. **The two `M5-FINDINGS` §7.1 leftovers** stand: an automatic changelog (changesets /
   release-please / `conventional-changelog-cli` plus a `commit-msg` check) and
   `DOCS-PROPOSAL.md` slices 2–3 (a generated reference, needs two devDependencies — so
   it needs a yes).
6. **The version bump.** M6 adds two opt-in behaviours and one modifier, so the release
   is `0.2.0` by the owner's rule (`M5-FINDINGS` §13: `1.0.0` follows usage). Publishing
   is the owner's decision and has not been made; `packages/flow/CHANGELOG.md` carries the
   entry under `[Unreleased]` until it is.

## 8. Verification at this commit

```sh
pkill -f vite
pnpm typecheck          # 3 packages
pnpm build              # 3 packages
pnpm check              # typecheck, Enfect lint, Prettier, 334 unit tests
pnpm bench              # 61 Playwright tests, 4.9 min
```

- **Vitest: 334** (311 in `packages/flow`, up from 289; 23 in `packages/example`, up
  from 22). The 22 new flow tests are §3's rung 1/2/3 cases; the example's is the
  harness fold.
- **Playwright: 61** in 14 files (was 56 in 13), 5.0 min. Five new proofs, one new file,
  one new page (`/m6.html`).
- Each M6 proof was **watched failing** before it was trusted (§3).
- The gate is unchanged and re-run: §2.

## 9. What a review should look at first

- **The `isEdgeTarget` guard.** If an edge press also reaches the pane handler, every
  click on an edge clears the selection it just made. Rung 3 covers it; a regression
  there would look like "edges flicker".
- **The interaction path's position in the DOM.** Drawn before the visible path, it
  would break three existing proofs that read `… [data-edgeid="x"] path`. Drawn after,
  it is a transparent overlay that changes nothing else. `tests/m6.spec.ts` 47 and the
  untouched `chrome.spec.ts` 36 both pin it.
- **`aria-hidden` moving with the feature.** With `edgeSelection` off it must stay; with
  it on it must go. Two tests, one on each side.
- **The aspect rule.** "The axis the pointer moved further, proportionally, wins" is a
  choice, and it is the one thing about the modifier a user could find surprising. The
  research says upstream does not bind a modifier at all and tldraw binds Shift with its
  own rule; if this rule reads wrong in use, it is a three-line change in
  `geometry/resize.ts` with four rung-1 tests to update.
