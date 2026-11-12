# M5 findings

The record of M5 — hardening and publishing — against
[`M5-HANDOFF.md`](M5-HANDOFF.md). The published numbers live in
[`BENCHMARKS.md`](BENCHMARKS.md); this file is what changed, what the change
cost, which proposals were rejected, and where M5 deviates from the plan.

M5 added no public surface. The library gained one internal index; the rest is a
benchmark page, a diagnostic, a gallery, an example page and docs.

## 1. The culling scan: indexed, and the numbers

The handoff named the cost and the fix (item 1): `nodeSizeOf` did a linear `find`
in `model.nodeSizes` per node, twice more per edge, so a scan was O(N × measured)
— 2.8–3.9 ms at 625 and 6.2–6.8 ms at 1k, about a third of a frame.

`geometry/bounds.ts` now keeps the same shape `positionIndex` uses: a
`WeakMap` keyed by the `nodeSizes` array's **reference**, holding a
`Map<nodeId, Size>`. A measurement commits by replacing the array, so identity is
a sound "unchanged"; the first entry for an id wins, as `find`'s did. `nodeSizeOf`
keeps its signature and its fallback chain (measured → `node.size` →
`fallbackSize`), because it is exported and documented.

Three tests, in `geometry/geometry.test.ts`, and the third was watched failing
against the old body:

- "the first measurement for an id wins, as the linear find did";
- "an unmeasured node uses its own size, then the shared fallback";
- "a culling scan does not pay a linear lookup per node" — 20 scans of a
  10,000-node graph under a 400 ms ceiling. Against the old body it took **9 756 ms**;
  with the index it takes ~20 ms. That is the only time-based test M5 added, and
  its comment says what the margin is for.

## 2. Before and after, at the same commit

Two measurements, because they answer different questions.

**The scan itself**, on a production build of `packages/flow/dist` driven from Node
(median of 7 runs of 5 scans each, nodes _and_ edges, so it is the work a pan frame
does rather than the half of it the browser counter samples):

| Fixture | before    | after   |
| ------- | --------- | ------- |
| 625     | 2.75 ms   | 0.12 ms |
| 1k      | 4.01 ms   | 0.15 ms |
| 10k     | 377.29 ms | 1.68 ms |

**The gate's own `cullScanMs`**, in the browser: the "before" column is this
milestone's harness at this commit with only `nodeSizeOf`'s body reverted and the
tree rebuilt; the "after" column is the tracked JSON from the full run at the
commit that carries this file.

| Leg                      | before    | after    |
| ------------------------ | --------- | -------- |
| 625                      | —         | 0.732 ms |
| 1k culled                | 6.024     | 1.164 ms |
| 1k culled + chrome       | 6.012     | 0.938 ms |
| 10k collapsed (`hidden`) | —         | 3.244 ms |
| 10k expanded             | 1 807.858 | 4.736 ms |

Two rows matter and one is deliberately unimpressive: the 10k **collapsed** page
barely moves (3.47 at M4 → 3.24 here) because a hidden node short-circuits before
the size lookup, so the collapsed scan never paid the cost being removed. The
10k output in the before column is not a typo: on the expanded page the old scan
was **1.8 seconds per call**, which is why the before-run's pan p95 was 5 766 ms.

The unit suite went from 276 to 279 tests; nothing else in it moved.

## 3. The gate, at this commit

`pnpm bench`: **55 tests in 4.9 min** (46 proofs + 3 gate legs + 4 explorations +
2 gallery). The gate legs are unchanged from M4 and all green:

| Leg                | drag                     | pan                      | long frames |
| ------------------ | ------------------------ | ------------------------ | ----------- |
| 625, React Flow    | not verified (M1 §10)    | 16.7 / 16.8 / 33.3 (496) | 0           |
| 625, Svelte Flow   | 16.7 / 16.7 / 16.8 (502) | 16.7 / 16.7 / 16.8 (487) | 0           |
| 625, Foldkit       | 16.7 / 16.7 / 16.8 (500) | 16.7 / 16.8 / 33.4 (480) | 0           |
| 1k culled          | 16.7 / 16.7 / 33.2 (499) | 16.7 / 16.7 / 33.4 (486) | 0           |
| 1k culled + chrome | 16.7 / 16.7 / 16.8 (495) | 16.7 / 16.7 / 33.4 (486) | 0           |

This is the first milestone whose 625 comparison had **no** frame over 50 ms in any
library, and the run above is the cleanest yet: Foldkit's 625 pan is
16.7 / 16.8 / 33.4 against React Flow's 16.7 / 16.8 / 33.4 over a comparable number
of frames, and the only frames above one interval in the whole comparison are single
33.4 ms drops. That is the reason the counts are published beside the longest frame —
a 50.0 ms frame sits exactly on the class boundary and counts as _not_ long (§4.5:
**over** 50 ms).

The whole suite gets slower with M5's new browser files: 3.4 → 4.9 min. The gate
legs themselves are untouched (the fast loop in `README.md` names each file), and
the additions are two explorations, a diagnostic, a comparison and the churn page —
none of them asserts a frame budget.

### 3.1 The two §4.5 columns M5 had not filled

`PLAN.md` §4.5 asks for three extra columns beside the frame distribution: the
culling scan, the `view()`/diff portion, and **JS heap after a 1,000-create/
1,000-delete churn loop** — plus "startup-to-first-paint and full mount time
reported separately". M1 §1 had deferred the heap column to M5 and never came back
for it, and the startup columns existed only on the two 10k pages. Both are filled
now, and neither is a gate:

- **Startup, on every leg** (`src/startup.ts`, `startup` in each result JSON). Ten
  recorded page loads per leg, on the page's own clock: 625 first paint is 25 ms
  median for us against 32 for React Flow and 55 for Svelte Flow, and the
  Foldkit-only column — every node measured — is 78 ms at 625 and 105 / 114 ms on
  the two 1k legs. That column exists for us alone because it _is_ our contract;
  the other two libraries' internal measurement is not observable from outside, and
  the table says so instead of guessing.
- **Heap after churn** (`/churn.html`, `src/foldkit/churn.ts`,
  `tests/churn.spec.ts`, `results/churn.json`). Its own page so that no gate page
  moved: 200 nodes, a node added and removed 1,000 times, twice. The renderer's
  node-cache size is 200 before, 200 after one loop and 200 after two, with a peak
  of 201 — the churn node's own slot, swept on the next pass. Retained heap
  (CDP `Performance.getMetrics` after `HeapProfiler.collectGarbage`) is 6.38 MB →
  7.32 → 7.42, so the second loop adds 0.10 MB on top of the first's 0.94 MB: flat
  in the loop count, not linear. A cache without the sweep would have been 1,200
  slots and then 2,200.

Two things that had to be got right, both of which bit this section first:

1. **The loop has to be a real dispatch**, not a mutation behind the renderer's
   back: each step adds or removes a node and renders, so the sweep is exercised.
   It is a Subscription (`Stream.tick`), the seam for "an external event while a
   Model condition holds".
2. **Waiting for the loop to finish is its own trap.** The first wait keyed on the
   page's `done` attribute and matched a _stale paint_ from the end of the previous
   loop: the second loop was measured at 300 ms and 51 of 2,000 steps. Keying on
   `done` plus the step counter then matched a paint that was already correct for
   the previous loop. The fix is a loop counter that only ever increases while the
   loop it names is running — one attribute, and the wait cannot be satisfied by an
   earlier loop's render. That is the same failure shape as `M1-FINDINGS` §9 (a
   harness reporting a number for work it did not do), which is why it is written
   down here rather than in a commit message.

## 4. The 10k expanded ceiling: measured, and it is startup

`/large-expanded.html` (`src/foldkit/largeExpanded.ts`) is the 10k fixture with
nothing collapsed: `makeGraph(100, 100)`, identical node markup to the 625 and 1k
fixtures, at zoom 1. `tests/expanded.spec.ts` measures it; `BENCHMARKS.md` has the
tables. The result that decides the M6 conversation:

- **Frames are fine**: 260 pan frames at 16.7 / 16.7 / 16.8, zero over 50 ms, 280
  nodes and 300 edges rendered out of 10,000 and 9,900. Culling, not `hidden`, is
  what keeps the DOM small at zoom 1.
- **Startup is not**: 544 ms to the first view and **1 280 ms to settle** (1.28–1.61 s
  across five runs). The
  first render happens before the pane has been measured, so `isCulling` is false
  for it: all 10,000 nodes are inserted and all 10,000 Mounts run (an observer
  pair each), and only then does the pane measurement turn culling on and cut the
  DOM back to 280.
- **The scan is now the frame's headroom**: 4.74 ms of a 16.7 ms frame at an
  expanded 10k (28 %), against 4 % at 625.

M5 did **not** fix the first-render behaviour. It is not on the M5 checklist, it
would change the gate pages' first-render DOM (which the 10k collapsed exploration
counts), and the fix is a design decision — cull from a measured pane earlier, or
render a placeholder viewport-derived region until the pane reports — that belongs
with the M6 research. It is named in [`M6-HANDOFF.md`](M6-HANDOFF.md) as a
candidate, and no claim in the README depends on it being solved.

## 5. The fixture gallery: what it proves, and the one divergence

`tests/gallery.spec.ts` (own file, ~12 s) drives two pages,
`gallery-react.html` and `gallery-foldkit.html`, over six fixtures from one
definition (`src/gallery/fixtures.ts`):

| Fixture      | geometry compared                    | paint compared (within each library) |
| ------------ | ------------------------------------ | ------------------------------------ |
| `edge-types` | 3 path `d` strings, node boxes       | all-Bezier vs Step/SmoothStep/Bezier |
| `labels`     | `d`, node boxes                      | labels off vs on                     |
| `markers`    | `d`, node boxes                      | markers off vs on                    |
| `subflow`    | `d` across parents, absolute boxes   | —                                    |
| `resize`     | box geometry                         | — (see below)                        |
| `fitview`    | both fits: viewport and screen boxes | —                                    |

All six agree exactly on geometry after rounding to 1e-3. Two things had to be
made true on both sides to compare geometry rather than styling, and both are
documented at the call sites:

- **The node box.** Our node's box is its content's, unless the flow draws one
  (`resize: true`, or a resize in flight); React Flow's is its inline
  `width`/`height`. The Foldkit gallery page renders its label at the fixture's
  declared size, so both libraries compute their anchors from the same 140×60.
  Without that the `d` strings differ by the _text width_ — a real difference, but
  a difference in typography, not in geometry.
- **The anchor.** Our fallback anchor is the node border's midpoint (source
  bottom, target top); React Flow's is the handle box's outer edge. The React page
  therefore renders **zero-sized** handles on those midpoints (`reactPage.tsx`).
  A normally-sized handle would put the two 2–3 px apart for a reason that is
  purely CSS — exactly what §2.4 says never to compare.

**The one divergence, recorded rather than asserted away**: `hidden`. Ours collapses
— the node, its subtree, their edges, their measurement, their selection — so the
fixture renders 1 node and 0 edges. React Flow's `hidden` is per node: the flagged
container disappears and its two children and their edge stay. Both behaviours are
correct for their libraries, the difference is the point of our semantics
(`M4-FINDINGS` §2.3), and the gallery asserts each side's own fact so that a
change in either library fails a test.

**The index** (`/gallery.html`) is built from `src/gallery/fixtures.ts` rather than
written by hand: one row per fixture, with a link into both libraries and into each
"feature off" state. `tests/gallery.spec.ts` asserts it lists every fixture and that
each of its four links per row points at a page and a query the gallery understands.
That test earned its place immediately — the first version of my expected list had
six fixtures and the page had seven, because `hidden` has pages and a paint pair but
is excluded from the geometry loop, which is exactly the sort of omission a
hand-written index makes silently.

**Not shipped, and said so in the report**: the resize _gesture_ (React Flow's
equivalent is its `NodeResizer` component — a different seam), the minimap,
controls and description (chrome is per project, proved in `chrome.spec.ts`), and
everything on the M6 list.

## 6. The start-of-pan stall: scoped, not explained

The one carried-forward unknown. `tests/stall.spec.ts` is the baseline method the
handoff asked for: four arms on twelve fresh page loads of the 1k fixture — idle,
first pan, second pan, and the gate's own drag→pan order — with each frame's
offset from its own arm. 2,050 frames, **0 over 50 ms**, worst frame 33.3 ms — one
dropped frame, in the drag→pan arm. `BENCHMARKS.md` §"The start-of-pan stall" has the table.

What that means, stated as narrowly as it deserves:

- The arms localise. A stall belonging to the pan's own work appears at the start
  of both pans and not in the idle window; one belonging to the page's first
  frames appears in the idle arm too. Neither appeared, in any of 48 arm runs.
- The historical rate (1–3 frames in some invocations) is therefore **not
  currently reproducible**, and M5 has not found the mechanism. What changed since
  M3 is not the gesture: it is the scan (3× cheaper) and the machine's state.
- The gate's 2 % bound stays. It was not moved to fit a new cost, and it is not
  moved now to fit a cleaner result; a run over it still fails.
- `tests/stall.spec.ts` stays in the suite (52 s) as the method to re-run the day
  someone reports it again. That is the difference between "we could not reproduce
  it" and "we cannot tell you how we would know".

The published report says exactly this: zero long frames **at this commit**, with
the historical record and the bound in the same paragraph.

## 7. Package docs and publish readiness

`packages/flow` is publishable; **nothing was published**. No npm command was run
beyond `pnpm pack --dry-run`, which is the inspection the handoff asked for.

- **Version** `1.0.0` (v1.0 shipped at M4; the package had never left `0.0.0`).
- **`LICENSE`** — MIT, at the package root, because npm shows the package's own
  file and the repo had none.
- **`THIRD-PARTY-NOTICES.md`** — the `@xyflow/system` 0.0.84 MIT notice, verbatim,
  with the one sentence that says what it is used for (path geometry, `XYPanZoom`,
  `getHandleBounds`, `getViewportForBounds`) and that no upstream stylesheet or
  component is used.
- **`README.md`** — the package-level one npm shows: install, peers, the CSS
  import that is not optional, a quick start that is the wiring the example page
  actually uses, the three measurement-contract sentences, and links to the full
  contract, `BENCHMARKS.md` and `verification.md`.
- **`files`** now lists `dist`, `LICENSE`, `README.md`, `THIRD-PARTY-NOTICES.md`
  explicitly rather than relying on npm's implicit inclusion.

`pnpm pack --dry-run` output: `dist/index.js`, `dist/index.d.ts`, `dist/style.css`
plus the rest of `dist`, `LICENSE`, `package.json`, `README.md`,
`THIRD-PARTY-NOTICES.md`. The bundle's only import specifiers are `@xyflow/system`
(a dependency) and `effect`/`foldkit`/`foldkit/*` (peers), so `exports` promises
nothing it does not ship.

### 7.1 Not done, and named so it is not lost: an automatic changelog

M5 did not add a `CHANGELOG.md`, and it should not have been hand-written: the
commit log is already the narrative (this file is the milestone record, not a
release note). The point to carry is **derive the changelog from the commits, and
decide the tool before the first publish**, because a `1.0.1` published without one
has nothing to read.

What the point needs, in the order that matters:

1. **A tool choice.** The commits are conventional already — `feat(flow)`,
   `fix(flow)`, `perf(flow)`, `refactor(flow)`, `test(benchmark)`, `docs` — so all
   three obvious candidates work: **changesets** (fits a pnpm workspace and one
   publishable package, keeps the changelog file in the repo), **release-please**
   (fits conventional commits and drives the GitHub release and the version bump),
   or `conventional-changelog-cli` in a `release` script (least machinery, no PR
   flow). Pick by how the version bump should be decided, not by the changelog
   output, which is the same for all three.
2. **Enforcement, or the output is noise.** Nothing checks that a commit message
   is conventional. Without a `commit-msg` hook (or a CI check) the generator
   silently drops the commits it cannot parse, so the changelog would under-report
   rather than fail — the failure mode this project keeps writing rules about.
   Hook or check goes in the same change as the generator.
3. **Where the file lives.** `packages/flow/CHANGELOG.md`, so npm renders it beside
   the package README, with a `files` entry; a root `CHANGELOG.md` only if the repo
   ever publishes more than one package.
4. **What it must not become.** A second copy of the findings documents. The
   changelog says what changed for a consumer and links the M-numbered findings
   section for the reasoning; it does not restate the numbers, which live in
   `BENCHMARKS.md` and are re-measured per milestone.
5. **Kept out of the release decision.** Generating a changelog is not publishing,
   and the two stay separate until the owner says otherwise (`M6-HANDOFF` open
   question: publish before or after M6).

**Publishing is the owner's call** and is not assumed anywhere: the handoff's open
question — publish before or after M6 — is left open, and the README says "v1.0
(M0–M4 shipped, M5 hardening)" rather than announcing a registry.

## 8. The example page

`packages/example` now serves two pages from one build: `/` (the 630-node
instrumented playground, byte-for-byte the fixture the proofs read) and
`/example/` (a release pipeline, presentable, with its own source beside it).

Decisions worth recording:

- **A second route, not a rewrite.** The playground's fixture is instrumentation
  for ten proofs; the handoff's constraint was that it must not move, and it did
  not. The two pages are separate Foldkit applications in one Vite build
  (`entry.ts` picks by pathname, `entry.server.ts` prerenders `["/", "/example"]`).
- **Both entries import both modules statically.** The first attempt used
  `import()` and the build failed with _"html element constructors must be called
  inside a runtime-driven render … foldkit was loaded as more than one instance"_:
  a dynamic import split `foldkit` into its own chunk for the lazily-loaded app,
  and the second copy had its own render frame. Written down because it is the
  first thing to suspect if this page ever goes blank again.
- **The route has a trailing slash.** `prerenderPaths` produces
  `dist/client/example/index.html`, so a static host serves it at `/example/`.
  Vite's preview falls back to the _playground's_ `index.html` for `/example` —
  which hydrates the example application into the playground's markup and produces
  a page that looks fine and responds to nothing. `/example/` is the URL.
- **The source shown is the file.** `src/example/source.ts` imports `app.ts?raw`,
  so the code beside the demo cannot drift from the code that runs. It lives in a
  separate module so `app.ts` does not import itself.
- **The opening fit is the documented consumer pattern**, not a renderer option:
  it is folded from `ResizedPane` once, because the pane's box is only known after
  it has been measured.
- **`data-nodeid` is not unique per node.** It is on the handles and the four
  resize controls too — the example proof hit this first, and the selectors in the
  new specs (`.fflow__node[data-nodeid="…"]`) are the ones to copy. Documented in
  the README's accessibility section rather than changed, because those elements
  are per-node instrumentation and a consumer asking "which node is this" wants
  them.

`tests/example.spec.ts` answers the five-question checklist (`verification.md`) on
this _second consumer shape_: 8 nodes and 6 edges render with the consumer's own
markup; a drag writes the parent's data and the panel's fact; collapsing hides the
frame's two checks and all three edges that touch them **while the frame stays,
shrunk to a summary band**; and a resize is asserted **mid-gesture**, comparing the
consumer's root box against the wrapper's (the M4 §14 lesson) and after release.

The collapse went through a correction worth recording, because it was a report
from a person using the page. The first version set `hidden` on the **container**,
which is exactly the library's semantics — a collapsed node takes its subtree with
it — and the QA frame vanished along with its children, leaving a gap and no
affordance where the thing used to be. As a library behaviour that is correct and
proved (`M4-FINDINGS` §2.3, `hidden` on containers is what the 10k page does); as
an _example_ it taught the wrong pattern. The page now collapses the container's
**children** and re-bands the container's own `size`, which is the pattern a graph
editor uses and the one that keeps the thing you clicked on the canvas.

## 8.2 Reported after M5: a pan after the opening fit jumped and shrank

Reported by hand within minutes of trying the example page: _"when I click the
background and drag it to pan, the graph gets smaller and jumps to the left."_
Both halves were real, and the cause was in the **library**, not the page.

The example fits the pipeline once, folded from the pane's first `ResizedPane` —
the pattern this document recommends and the gallery uses. `Flow.setViewport`
commits the target to the Model and returns a `SyncViewport` Command, and that
Command is built from `model.paneId`. `MountPane` emitted `MountedPane` (which
folds that id) **after** the first `ResizedPane`, so at fit time `paneId` was
`Option.none()`: the fit committed to the Model, emitted _zero_ commands, and the
engine kept the viewport it had been constructed with. Nothing failed, nothing
warned. The next pan then applied its delta to the engine's stale transform — from
`translate(40, 40) scale(0.6)` instead of `translate(163.2, 45) scale(0.5977)`,
which reads exactly as "smaller, and jumping left".

Why every existing assertion missed it, in `verification.md`'s language:

- The **Model → DOM** layer was right: the view renders the transform from
  `model.viewport`, so the DOM showed the fitted viewport and every DOM assertion
  passed (`proof 41`, the fit button, asserts exactly that string).
- The wrong layer was **DOM/Model → engine**: d3's internal transform is the value
  the next gesture starts from, and nothing asserted it. A DOM assertion cannot
  see it, because the DOM is written by the view as well.
- The gesture is what revealed it, which is why the proofs for this class have to
  pan **after** the programmatic change (the new proof does).

**The fix** is the message order in `runtime/mountPane.ts`: `MountedPane` is
offered before the observer's first `emitPaneRect()`. The order is now stated as a
contract in `message.ts` ("`MountedPane` always precedes the pane's first
`ResizedPane`") and in the README's `fitViewport` paragraph, because a consumer's
fit depends on it.

**The proof**, `tests/example.spec.ts` → "a pan continues from the fitted viewport,
instead of snapping back": it records the transform after the opening fit, drags
empty pane by a known delta, and asserts the zoom is unchanged to 1e-3 and the
translation advanced by the drag. **Watched failing**: the first run of that proof
went against a preview built before the library fix and failed with
`Expected 0.76327, Received 0.6` — the two numbers in the report, in a test. That
was the build-skew trap (`verification.md` rule 4) catching me rather than the
proof being wrong, and it is the cheapest possible confirmation that the assertion
measures the reported thing.

Regression scope: `proofs.spec.ts` (the demo's pan, sync-viewport and fit proofs),
`m4.spec.ts` (fit button, minimap click) and `tests/gallery.spec.ts` (both fits)
all pass with the reorder, and the demo's own `syncs` counter is untouched because
the fix emits no extra Message.

## 9. Where the numbers live

`docs/BENCHMARKS.md` is the reader-facing home (the handoff's first open
question): the protocol, the machine, the tables, the ceiling, the stall and the
reproduction commands. The README states the contract and links to it; the package
README links to both. The raw JSONs stay in `packages/benchmark/results/` and are
tracked, so a figure can be checked against the run that produced it.

`results/gallery.json` and `results/pan-stall.json` are new and tracked as well
(`.gitignore` negates them by name, like the four that were already there).

## 10. Deviations from `PLAN.md` §7 M5

None in scope; four in execution, all recorded here:

1. **The gallery is six fixtures, not the seven the checklist lists.** Resize is
   compared as a _box_ — the gesture has no cross-library equivalent, which the
   plan anticipated by saying "say not shipped rather than building it". The
   report's `notShipped` list names it.
2. **The 10k expanded number is an exploration with no gate**, like the collapsed
   one, so `expanded.spec.ts` asserts that the numbers exist and that the pan
   moved — not that they are good. §4.5 promises no figure; the _ceiling_ is now
   published as a measured fact, which is what the milestone asked for.
3. **The stall is scoped, not solved**, which the handoff allowed explicitly.
4. **`PLAN.md` is unchanged.** No edit was needed and none was made; the M6
   candidates found during M5 (the 10k first render) are in the M6 handoff, not in
   the plan.

## 11. Verification at this commit

```
pkill -f vite
pnpm typecheck   # flow, benchmark, example — clean
pnpm build       # all three
pnpm check       # typecheck, lint, prettier, 279 Vitest tests in 27 files
pnpm bench       # 52 Playwright tests in 4.6 min
```

`pnpm pack --dry-run` inspected (§7). The four gate/exploration JSONs plus
`expanded-10k.json`, `gallery.json` and `pan-stall.json` are from this run. No npm
publish, no history rewrite, no amended M0–M4 commit.
