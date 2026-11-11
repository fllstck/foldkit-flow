# M6 handoff

Starting point for M6. M0–M5 are complete and committed, **v1.0 shipped at M4**,
and M5 hardened and published: the culling scan is indexed, the numbers are in
[`BENCHMARKS.md`](BENCHMARKS.md), there is a fixture gallery against React Flow, a
presentable example page, and `packages/flow` is publishable at `1.0.0` — **not
published**. Do not amend `c40ae47`, `a0a3fdc`, `898bb46`, the M2 commits,
`69a630e` with its M3 follow-ups, the M4 commits, or the M5 commits; commit at
logical checkpoints and do not rewrite history.

M6 is **research first**: its first deliverable is `docs/M6-RESEARCH.md`, not a
feature. [`PLAN.md`](PLAN.md) §7 "M6 — the deliberate gaps, researched first" is
binding, and the method (primary sources only, a second implementation per point,
two dated sources per claim, behaviour-never-look, measure what the sources cannot
settle) is not advisory.

## Copy-paste prompt for the next session

> Work on M6 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M6-HANDOFF.md` first, then `docs/PLAN.md` §7 **M6** (the method, the
> eleven-row research table, the order and the definition of done) and §2.4 (no
> upstream stylesheet, no attribution), §4.5 (the gate and the protocol), §6 (the
> Story/Scene/Playwright split); `docs/M6-RESEARCH.md` does not exist yet and is
> the deliverable. Then `docs/BENCHMARKS.md` (the numbers to re-run, the 10k
> ceiling, the scoped pan stall), `docs/M5-FINDINGS.md` (what M5 changed and the
> traps it paid for), `docs/M4-FINDINGS.md` §8 (the eleven gaps as M4 left them)
> and §2.6, §2.9, §2.10 (the decisions that will be revisited), and
> `docs/verification.md`, `docs/foldkit-constraints.md`, `README.md`. Research,
> then decide (**ship** / **ship differently** / **keep out**), then code only
> what the decision says. Run `pnpm typecheck` before `pnpm build`, `pnpm build`
> (all three) before any browser run, the touched Playwright files during the
> loop, and the full `pnpm bench` before claiming anything is done. No npm publish
> without asking, and no network install beyond npm.

## Current state

| Area               | State                                                                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/flow`    | **1.0.0**, publishable and unpublished: `LICENSE`, `THIRD-PARTY-NOTICES.md`, a package `README.md`, `files`/`exports` verified with `pnpm pack --dry-run`. Surface unchanged since M4; M5 added one internal index (`geometry/bounds.ts`) |
| `packages/example` | **Two pages, one build**: `/` is the 630-node instrumented playground (unchanged — ten proofs read its fixture), `/example/` is the presentable release pipeline with its own source beside it                                                                     |
| `packages/benchmark` | Gate legs (625 comparison, 1k culled, 1k + chrome), 10k collapsed, 10k **expanded**, the React Flow **gallery**, and the **pan-stall** diagnostic — 52 Playwright tests in 11 files, 4.6 min |
| Tests              | **279** Vitest tests in 27 files; **52** Playwright tests (45 proofs, 3 gate legs, 3 explorations, 1 gallery)                                                                                    |
| Docs               | `PLAN.md` (revision 7, unchanged by M5), **[`BENCHMARKS.md`](BENCHMARKS.md)** (the published numbers), [`M5-FINDINGS.md`](M5-FINDINGS.md), M0–M4 findings and reviews, `verification.md`, `IMPLICIT-STATE-AUDIT.md`, `xyflow-internals.md`, `foldkit-constraints.md`, `README.md` |
| Evidence           | `packages/benchmark/results/`: `benchmark.json`, `benchmark-1k.json`, `benchmark-1k-chrome.json`, `hidden-10k.json`, `expanded-10k.json`, `gallery.json`, `pan-stall.json` — all tracked |

## The eleven gaps, all still open

None of these shipped in M5. M5 deliberately added **no public surface**, so no
M6 verdict has to remove anything: every gap M4 named is exactly as M4 left it.

| #  | Gap (§ of `M4-FINDINGS.md`)                    | State at the end of M5 |
| -- | ---------------------------------------------- | ---------------------- |
| 1  | `XYResizer` (§2.6)                             | Not used. Our resize gesture is unchanged; `resize` still draws `node.size` and reports `ResizedNodes` |
| 2  | Minimap interaction (§2.9)                     | Click-to-centre only. No drag, no wheel, no `onNodeClick` |
| 3  | Edge selection (§2.10)                         | Not selectable from the pointer layer. `selectedEdgeIds` exists in the Model but only `removeEdges`/`informGraphChanged` write it |
| 4  | `nodeOrigin` (§8)                              | Not supported: positions are top-left relative |
| 5  | Parent resize re-placing children (§8)         | Children keep their relative positions; a parent resize does not move them |
| 6  | `keepAspectRatio`, `resizeDirection`, `shouldResize` (§8) | None exist. Four corner controls, one delta, no aspect lock |
| 7  | Interactive edge labels (§8)                    | `edge.label` renders as SVG `<text>`; `renderEdgeLabel` replaces its content, not its interactivity |
| 8  | Multi-node resize (§8)                          | Single node per gesture. A selection can be dragged together, not resized together |
| 9  | Handle geometry during a resize (§8)           | Handles are measured on the node's own measurement; a resize writes the box as a measurement, and handle geometry is not re-derived per resize frame |
| 10 | The culling scan (§6, §7)                      | **Partly moved, not closed.** M5 removed the O(measured) factor the plan named (`nodeSizeOf`'s linear lookup, now an index: 6.0 → 1.2 ms at 1k, 1 808 → 5.0 ms at an expanded 10k). A scan is still O(N) per viewport frame, and whether an index or a coarser cadence is right for 10k is still M6's question |
| 11 | Edge focus and the tab order (§2.10, §10 a11y) | Unchanged: nodes are focusable, edges are not, and the description lists edges without a focus target |

Item 10's research question should be read as "given the index, what is left?" —
re-baseline with `tests/expanded.spec.ts` and `tests/stall.spec.ts` first, and
remember that the same page now has a different first-order cost: **startup**
(§"What M5 found" below).

## Read first

1. `docs/PLAN.md` §7 **M6** — the method, the eleven-row research table, the
   order (10 first; then 3 with 11 as one unit; then 1; then 2, 4, 5, 6; then 7
   and 8) and the definition of done.
2. `docs/BENCHMARKS.md` — the protocol, the five gate legs, the 10k ceiling, the
   scoped pan stall, and the reproduction commands. Every M6 claim that costs
   frames has to be measured the same way.
3. `docs/M5-FINDINGS.md` — what M5 changed (§1–§2), the 10k expanded result
   (§4), the gallery and its zero-sized-handle technique (§5), the stall scope
   (§6), and the two traps the example page paid for (§8).
4. `docs/M4-FINDINGS.md` §8 (the gaps as M4 left them), §2.6 (why `XYResizer` was
   rejected — the decision M6 revisits first), §2.9 (minimap), §2.10 (edge
   selection), §13.1 (the linear-algebra-of-trees lesson: one visit per node), §14
   (the resize reports and the boundary rule).
5. `docs/verification.md` — the boundary rule and the five-question checklist.
   Every M6 "ship" verdict needs an answer to all five, and the **example page is
   now the second consumer shape** to answer question 5 on.
6. `docs/foldkit-constraints.md` — Mount args are captured, `viewInputs` functions
   must be top-level, there is no VNode traversal. Every `XYResizer`/`XYMinimap`
   verdict runs into the same seam.
7. `docs/xyflow-internals.md` — the store, `updateNodeInternals`, and what the
   wrappers pass to `@xyflow/system`. Update it, do not re-derive it.
8. `README.md` — the public contract, as it stands after M5.
9. `packages/benchmark/tests/*.spec.ts` and `results/*.json` — the protocol as
   code and the JSONs every figure in `BENCHMARKS.md` comes from.

## What M5 found that M6 needs

- **The 10k cost moved from frames to startup.** `/large-expanded.html` pans at
  16.7 / 16.7 / 33.3 with 280 of 10,000 nodes rendered, but takes **1 598 ms to
  settle**, because the first render happens before the pane is measured: culling
  is off for it, so all 10,000 nodes are inserted and all 10,000 Mounts run before
  the pane's measurement cuts the DOM back. This is not on the M6 list — it is a
  candidate found during M5, and it is written down here rather than built. If M6
  takes it, it is a *design* question (cull from a viewport derived before the
  pane reports, or gate the first render on the pane's measurement) with a
  measured before/after at 10k, and it changes the DOM the 10k collapsed
  exploration counts.
- **The gallery is the place to prove a new feature against React Flow.** Six
  fixtures agree on geometry and are compared for paint within each library
  (`tests/gallery.spec.ts`). When M6 ships edge selection, minimap drag or a
  resizer, the fixture goes in `src/gallery/fixtures.ts` — and read §5 of
  `M5-FINDINGS.md` first: the node box and the anchor had to be made identical on
  both sides, or the `d` strings differ by typography.
- **The example page is the second consumer shape.** `packages/example/src/example/app.ts`
  is a small real workflow with custom nodes, a frame with children, vertical
  handles, a panel, and its source beside it. Its proof (`tests/example.spec.ts`)
  asserts a resize mid-gesture by comparing the consumer's root box to the
  wrapper's — the assertion M4 §14 said was missing.
- **`data-nodeid` is on the handles and the resize controls too**, so a node is
  `.fflow__node[data-nodeid="…"]`. Documented in the README; do not "fix" it
  without checking the proofs that read those elements.
- **The pan stall is scoped, not explained.** `tests/stall.spec.ts` is the
  baseline method (four arms, twelve fresh page loads). If a change makes long
  frames reappear, run it before assuming the change is at fault — and if it
  localises the stall, the report's §"The start-of-pan stall" needs updating.

## Known traps and gotchas

Everything in the M1–M5 handoffs' "known traps" still applies. Sharpened for M6:

- **`pkill -f vite` before a suite run**, or `reuseExistingServer` navigates into a
  preview the run did not start and nothing is measured (M1 §11, M4 §15.5).
- **`pnpm typecheck`, then `pnpm build` (all three), then the browser.** The
  benchmark bundle inlines the library's `style.css` at its own build time, so a
  stale benchmark build serves the previous stylesheet and makes fixed code look
  broken (M4 §14).
- **A gesture that measured an idle page still reports 16.7 ms.** Every leg proves
  it moved something; the harness throws when it did not (M1 §9, §10). Keep that
  discipline in any new leg — and remember the second-pan trap found in M5: after
  a pan, the "known empty" press point is over a node, so a second pan needs a
  fresh hit test (`tests/stall.spec.ts`'s `emptyPointNear`).
- **The gate is noisy at the class boundary.** 50.0 ms counts as not long; report
  counts and the 2 % bound, not one longest frame, and re-baseline before calling
  a change a regression.
- **A DOM assertion is not a paint assertion, and an assertion on the element the
  library owns is not an assertion on what the consumer sees** (`verification.md`;
  M3 §14, M4 §14, and now `tests/example.spec.ts`).
- **Do not compare our pixels to React Flow's.** Their stylesheet is theirs
  (§2.4). The gallery compares `d` strings and each library's own paint.
- **The demo's fixture is instrumentation.** Ten proofs read 630 nodes, 416
  edges, n0/n3/n4 geometry and the group's collapse counts. `/example/` is a
  second route precisely so that fixture does not move.
- **`/example/` needs its trailing slash** under a static host; `/example` falls
  back to the playground's HTML and hydrates the wrong application.
- **A dynamic import in `packages/example` splits `foldkit`** and the second copy
  cannot see the render frame — both entries import both apps statically.
- **The tree's formatting is Prettier's** for `packages/**`, `*.ts|json`,
  `docs/M0-*.md` … `docs/M5-FINDINGS.md`, `docs/BENCHMARKS.md` and
  `docs/verification.md`. `PLAN.md`, the critiques and the handoffs are excluded;
  a new findings or research document needs adding to both `format` and
  `format:check` in the root `package.json`.

## Verification and definition of done

```sh
pkill -f vite               # a stale preview owns 4173/4174
pnpm typecheck              # first: vite build does not typecheck
pnpm build                  # all three: the benchmark inlines the library CSS
pnpm check                  # typecheck, Enfect lint, Prettier, unit tests
pnpm bench                  # Playwright: every proof, every leg, ~4.6 min
```

M6 is done when `PLAN.md` §7's list holds — `docs/M6-RESEARCH.md` with one section
per row, each ending in a verdict with links and dates; every **ship** implemented
with an M4-style proof; every **keep out** in `docs/M6-FINDINGS.md` with the reason
and the evidence it still holds; the gate unchanged and re-run at the committing
commit (625 parity, 1k p95 < 33 ms, long frames inside 2 %); re-baselined at 1k
**and 10k** if the scan changes; `README.md` and `docs/M4-FINDINGS.md` §8 pointing
at the verdicts; and all four commands green.

## Open questions for M6

- **Does item 10 still need its own fix?** The scan is 1.2 ms at 1k and 5.0 ms at
  an expanded 10k. If a spatial index is not warranted, the verdict is "keep out,
  with the numbers" — and the claim that pays for it is that a scan is O(N) per
  viewport frame by design (§4.5).
- **Does the 10k startup cost belong to item 10 or to a new candidate?** It is the
  same page and the same measurement, and it is now the larger number.
- **Does the gallery grow into a per-feature proof requirement for M6 ships?** It
  is the only place the two libraries are compared on one input, and it costs 12 s.
- **Does `1.0.0` go to npm before the M6 research lands?** The package is ready;
  publishing is the owner's call and nothing in the repo assumes it happened.
- **Does M6 add public surface, and if so does the version move?** A shipped
  `nodeOrigin` or an edge-selection API would make this 1.1.0 rather than 1.0.x;
  the reasoning belongs in `M6-FINDINGS.md`, not in a handoff.
