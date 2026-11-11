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
| 625                      | —         | 0.626 ms |
| 1k culled                | 6.024     | 1.156 ms |
| 1k culled + chrome       | 6.012     | 0.922 ms |
| 10k collapsed (`hidden`) | —         | 3.172 ms |
| 10k expanded             | 1 807.858 | 4.998 ms |

Two rows matter and one is deliberately unimpressive: the 10k **collapsed** page
barely moves (3.47 at M4 → 3.17 here) because a hidden node short-circuits before
the size lookup, so the collapsed scan never paid the cost being removed. The
10k output in the before column is not a typo: on the expanded page the old scan
was **1.8 seconds per call**, which is why the before-run's pan p95 was 5 766 ms.

The unit suite went from 276 to 279 tests; nothing else in it moved.

## 3. The gate, at this commit

`pnpm bench`: **52 tests in 4.6 min** (44 proofs + the example proof + 3 gate legs

- 3 explorations + the gallery). The gate legs are unchanged from M4 and all
  green:

| Leg                | drag                     | pan                      | long frames |
| ------------------ | ------------------------ | ------------------------ | ----------- |
| 625, React Flow    | not verified (M1 §10)    | 16.7 / 16.7 / 16.8 (499) | 0           |
| 625, Svelte Flow   | 16.7 / 16.8 / 33.4 (499) | 16.7 / 16.7 / 16.8 (488) | 0           |
| 625, Foldkit       | 16.7 / 16.7 / 16.8 (499) | 16.7 / 16.7 / 33.4 (477) | 0           |
| 1k culled          | 16.7 / 16.7 / 33.3 (492) | 16.7 / 16.8 / 33.4 (485) | 0           |
| 1k culled + chrome | 16.7 / 16.7 / 33.3 (494) | 16.7 / 16.7 / 16.8 (483) | 0           |

This is the first milestone whose 625 comparison had **no** frame over 50 ms in
any library: the worst frame in the whole 625 comparison is a single 33.4 ms
interval, one dropped frame, and it appears in a different leg of each run. That is
the reason the counts are published beside the longest frame — a 50.0 ms frame sits
exactly on the class boundary and counts as _not_ long (§4.5: **over** 50 ms).

The whole suite gets slower with M5's three new browser files: 3.4 → 4.6 min.
The gate legs themselves are untouched (the fast loop in `README.md` still names
each file), and the three additions are an exploration, a diagnostic and a
comparison — none of them asserts a frame budget.

## 4. The 10k expanded ceiling: measured, and it is startup

`/large-expanded.html` (`src/foldkit/largeExpanded.ts`) is the 10k fixture with
nothing collapsed: `makeGraph(100, 100)`, identical node markup to the 625 and 1k
fixtures, at zoom 1. `tests/expanded.spec.ts` measures it; `BENCHMARKS.md` has the
tables. The result that decides the M6 conversation:

- **Frames are fine**: 257 pan frames at 16.7 / 16.7 / 33.3, zero over 50 ms, 280
  nodes and 300 edges rendered out of 10,000 and 9,900. Culling, not `hidden`, is
  what keeps the DOM small at zoom 1.
- **Startup is not**: 587 ms to the first view and **1 598 ms to settle**. The
  first render happens before the pane has been measured, so `isCulling` is false
  for it: all 10,000 nodes are inserted and all 10,000 Mounts run (an observer
  pair each), and only then does the pane measurement turn culling on and cut the
  DOM back to 280.
- **The scan is now the frame's headroom**: 5.00 ms of a 16.7 ms frame at an
  expanded 10k (30 %), against 3.7 % at 625.

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

**Not shipped, and said so in the report**: the resize _gesture_ (React Flow's
equivalent is its `NodeResizer` component — a different seam), the minimap,
controls and description (chrome is per project, proved in `chrome.spec.ts`), and
everything on the M6 list.

## 6. The start-of-pan stall: scoped, not explained

The one carried-forward unknown. `tests/stall.spec.ts` is the baseline method the
handoff asked for: four arms on twelve fresh page loads of the 1k fixture — idle,
first pan, second pan, and the gate's own drag→pan order — with each frame's
offset from its own arm. 2,015 frames, **0 over 50 ms**, worst frame 33.4 ms in the
idle arm. `BENCHMARKS.md` §"The start-of-pan stall" has the table.

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
