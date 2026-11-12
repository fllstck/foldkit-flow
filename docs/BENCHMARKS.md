# Benchmarks

What `@fllstck/foldkit-flow` costs, measured the way `docs/PLAN.md` §4.5 says to
measure it, at the commit that carries this file. Every figure below comes from
the tracked JSON in `packages/benchmark/results/`; nothing here is a projection,
and where a number is historical or an exploration it says so.

Three claims, and this document is the evidence for them:

1. **Parity with React Flow on pan at 625 nodes**, the fixture both libraries can
   render, with no long frames.
2. **1k nodes with culling inside the 33 ms p95 gate**, bare and with the chrome
   on.
3. **10k nodes**: 200 rendered and 60 fps when the bulk is collapsed (`hidden`),
   280 rendered and 60 fps when nothing is collapsed — but a ~1.3 s settle before
   the first interaction. Both are explorations, not gates.

## The protocol

Unchanged since M0, and re-run at every milestone:

- **Fixtures.** `25×25 = 625` nodes and 624 edges (xyflow's own stress fixture:
  labelled rectangles, no custom chrome); `40×25 = 1000` nodes viewed at zoom 1 so
  most of them are outside the viewport and culling has work to do; the same 1k
  graph with all of M3's chrome on (dots background, controls, a 1000-rect
  minimap); `100 × 99 + 100 = 10,000` nodes as 100 containers of 99 children, 98
  containers collapsed (`hidden`); and the same 10k graph **expanded**, with
  nothing collapsed.
- **Build mode.** Production builds for every library (`vite build` + `vite
preview`). Dev builds are never compared.
- **Environment.** One machine, one browser (Brave's headless Chromium, version
  recorded in every JSON), no CPU throttling, one worker, the machine otherwise
  idle. React Flow, Svelte Flow and Foldkit render on **separate pages** of one
  app: side by side they would share one main thread and one compositor, which
  makes the numbers meaningless.
- **Script.** A scripted gesture per leg, mirroring xyflow's `FrameRecorder`: a
  `requestAnimationFrame` loop records the interval between frames while the
  pointer presses, moves 20 steps, and releases. One warm-up run is discarded,
  then 10 runs are recorded. Every leg **proves it moved something** — the pan
  leg compares the viewport transform before and after and throws if it did not
  (M1-FINDINGS §9: a press that landed on a node recorded 16.7 ms on an idle
  page).
- **Metrics.** Frame durations per leg (median, p95, longest, and the count over
  50 ms); **startup** — time from navigation to the first painted graph, and, where
  the library can report it, to every node measured — so layout cost is not hidden
  inside the frame numbers; the culling scan (`cullScanMs`, averaged over 50
  repetitions per sample); the per-dispatch cost of building the child fold and
  running `Flow.update` (`updatePerDispatchMs`); the retained heap after a
  1,000-create/1,000-delete churn loop; and, for 10k, the same frame metrics plus
  the time to first view and the time to settle.
- **Acceptance** (§4.5). 625: median ≤ React Flow's, p95 within 10 % of it, no
  frame over 50 ms. 1k with culling: p95 < 33 ms. **Long frames are bounded, not
  forbidden**: 2 % of recorded frames, because a single 3–4 frame stall appears at
  the start of a pan in runs of code that do not otherwise differ (M2 §4, M3
  §5.1, and §"The start-of-pan stall" below). 10k is reported as an exploration.

## This machine

|         |                                                                     |
| ------- | ------------------------------------------------------------------- |
| Machine | MacBook Air (Apple M5), 16 GB, macOS 26.6.2                         |
| Browser | Brave 156.1.98.63 (Chromium 156), headless                          |
| Server  | `vite preview`, production builds, one worker                       |
| Date    | 2026-11-12 (M5); the exact commit is the one that carries this file |

Frame medians land on 16.7 ms because that is the 60 Hz interval: this is a
vsync-bound measurement, not a CPU-bound one. What the numbers can distinguish is
the **p95, the longest frame and the counts**, not the median.

## Reproducing it

```sh
pkill -f vite          # a stale preview owns 4173/4174 and the run fails on it
pnpm install
pnpm typecheck         # first: vite build does not typecheck
pnpm build             # all three packages: the benchmark inlines the library CSS
pnpm bench             # every proof and every leg, ~4.9 min
```

One leg at a time, which is what to do while iterating:

```sh
cd packages/benchmark
pnpm exec playwright test --grep "1000-node"        # both 1k gate legs, ~60 s
pnpm exec playwright test tests/hidden.spec.ts      # 10k collapsed, ~10 s
pnpm exec playwright test tests/expanded.spec.ts    # 10k expanded, ~20 s
pnpm exec playwright test tests/gallery.spec.ts     # the React Flow gallery, ~12 s
pnpm exec playwright test tests/stall.spec.ts       # the pan-stall diagnostic, ~55 s
pnpm exec playwright test tests/churn.spec.ts       # heap after 1,000 create/delete cycles, ~25 s
```

Each run rewrites its JSON in `packages/benchmark/results/`; the four gate and
exploration files are tracked, so a published number can be checked against the
run that produced it.

## The gate

`results/benchmark.json`, `results/benchmark-1k.json`,
`results/benchmark-1k-chrome.json`. Ten recorded runs per leg, one warm-up
discarded. Frame durations in ms, `median / p95 / longest`; the frame count is in
parentheses.

| Leg                       | Drag                     | Pan                      | Long frames (> 50 ms) |
| ------------------------- | ------------------------ | ------------------------ | --------------------- |
| 625, React Flow 12.12.1   | not verified¹            | 16.7 / 16.7 / 16.8 (507) | 0                     |
| 625, Svelte Flow 1.7.1    | 16.7 / 16.8 / 33.4 (499) | 16.7 / 16.8 / 16.8 (495) | 0                     |
| 625, Foldkit Flow 0.1.0   | 16.7 / 16.7 / 16.8 (504) | 16.7 / 16.7 / 16.8 (479) | 0                     |
| 1k culled                 | 16.7 / 16.8 / 33.3 (497) | 16.7 / 16.8 / 16.8 (475) | 0                     |
| 1k culled **with chrome** | 16.7 / 16.8 / 16.8 (497) | 16.7 / 16.8 / 16.8 (480) | 0                     |

¹ React Flow's node drag does not engage under this harness: the `pointerdown` is
delivered and the node box does not change. The harness reports that as
unverified rather than recording idle frames (M1-FINDINGS §10).

Parity holds where it can be compared: on the 625 fixture React Flow's pan is
16.7 / 16.7 / 16.8 over 507 frames and Foldkit's is 16.7 / 16.7 / 16.8 over 479 —
identical median, p95 and longest. The 1k legs are inside the 33 ms p95 gate; their
16.8 ms longest frames are single frame intervals and the 2 % bound at 1k is 10
frames. A frame at exactly 50.0 ms would count as _not_ long (§4.5: **over** 50),
which is why the counts are published beside the longest frame; none appeared in
this run.

Per-dispatch and per-scan cost from the same runs:

| Leg                | `updatePerDispatchMs` | `cullScanMs` |
| ------------------ | --------------------- | ------------ |
| 625                | 0.0016                | 0.476        |
| 1k culled          | 0.0021                | 0.876        |
| 1k culled + chrome | 0.0025                | 0.694        |

## Startup

`results/benchmark.json` (625) and the two 1k legs, `startup` in each. Ten recorded
page loads per leg, from navigation start to the page's own signal, so layout cost
is reported beside the frame numbers rather than inside them (§4.5):

| Leg              | first painted graph, median / p95 | every node measured, median / p95 |
| ---------------- | --------------------------------- | --------------------------------- |
| 625, React Flow  | 23 / 51 ms                        | not observable from outside       |
| 625, Svelte Flow | 67 / 69 ms                        | not observable from outside       |
| 625, Foldkit     | **35 / 44 ms**                    | **89 / 97 ms**                    |
| 1k culled        | 35 / 40 ms                        | 115 / 117 ms                      |
| 1k + chrome      | 32 / 40 ms                        | 119 / 124 ms                      |

Two things to read out of it, and one caveat:

- **The first paint is not where this library's cost is, but it is not the whole
  story either.** At 625 the medians are 35 ms for us, 23 for React Flow and 67 for
  Svelte Flow; React Flow's first paint is cheaper, and it is the _measurement_ pass
  that this library pays for instead (89 ms to every node measured). The
  mechanism is not measured here — only the difference — and the obvious candidate
  is that a Foldkit `view` builds the DOM it renders, with no framework
  reconciliation pass between the two.
- **The measurement pass is the Foldkit-only column**, and it is 50–60 ms more at
  625: every node runs a Mount with a `ResizeObserver` and a `MutationObserver`, and
  that is the price of the measurement contract. It is reported because a consumer
  that wants to trust hit-testing waits for it; React Flow's and Svelte Flow's
  internal measurement is not observable from outside, so those cells say so rather
  than guessing at a comparable number.
- **It is a fresh-cache number.** Each leg navigates to a new page, so the first
  paint includes compile and layout of a cold bundle; that is what a user sees, and
  it is also why it dwarfs the 10k page's 544 ms first view (10,000 nodes, one
  render) only by an order of magnitude rather than by more.

## Heap after 1,000 create/delete cycles

`results/churn.json`, from `tests/churn.spec.ts` on `/churn.html`
(`src/foldkit/churn.ts`) — its own page, so no gate page moved. The graph is 200
nodes; the loop adds a node, renders, removes it, renders, 1,000 times; then does
it again. Retained heap is read through CDP after `HeapProfiler.collectGarbage`, so
it is memory held rather than memory allocated.

| Metric                    | before  | after 1 loop | after 2 loops |
| ------------------------- | ------- | ------------ | ------------- |
| renderer node-cache slots | 200     | **200**      | **200**       |
| nodes in the DOM          | 200     | 200          | 200           |
| retained JS heap          | 6.36 MB | 7.29 MB      | 7.39 MB       |
| steps (adds + removes)    | —       | 2 000        | 4 000         |
| loop wall time            | —       | 11.5 s       | 11.5 s        |

The **peak** cache size during a loop is 201: the churn node gets a slot of its own
on the pass that renders it, and the slot is swept on the next pass. That is the
bound `PLAN.md` §4.5 describes — one slot per node _in the render pass_, not per id
ever seen — and a cache without the sweep would have climbed to 1,200 slots and then
2,200.

The heap column is the weaker of the two numbers and is presented as such: the first
loop adds ~0.94 MB, the second adds ~0.09 MB on top, so the curve is flat in the
loop count rather than linear in it. A single-machine heap figure is not a promise —
what it rules out is a leak of the whole loop (2,000 VNodes and their props), and
the spec's ceiling (12 MB) is set there rather than tight.

## The culling scan, before and after M5

`nodeSizeOf` used to look a node's measured size up with a linear `find` in
`model.nodeSizes`, once per node (and twice per edge), so a scan was
O(N × measured). M5 replaced the lookup with an index memoized on the
`nodeSizes` array's reference — the same shape as `positionIndex` — and left
`nodeSizeOf`'s signature alone (`docs/M5-FINDINGS.md` §1).

**The scan function**, on a production build of `packages/flow/dist` driven from
Node — median of 7 runs of 5 scans each, over nodes _and_ edges, so it is the work
a pan frame does rather than the half of it the browser's counter samples. Same
build settings; only `nodeSizeOf`'s body reverted for the "before" column:

| Fixture      | before    | after       |
| ------------ | --------- | ----------- |
| 625          | 2.75 ms   | **0.12 ms** |
| 1k           | 4.01 ms   | **0.15 ms** |
| 10k expanded | 377.29 ms | **1.68 ms** |

**The browser's own counter** (`cullScanMs`, `visibleNodes` only), same harness and
same commit, again with only that lookup reverted for the "before" column — the
full pair of runs is in `docs/M5-FINDINGS.md` §2:

| Leg                | before      | after       |
| ------------------ | ----------- | ----------- |
| 625                | —           | **0.48 ms** |
| 1k culled          | 6.02 ms     | **0.79 ms** |
| 1k culled + chrome | 6.01 ms     | **0.65 ms** |
| 10k collapsed      | —           | **3.15 ms** |
| 10k expanded       | 1 807.86 ms | **5.32 ms** |

M4 recorded 2.83 / 6.63 / 6.13 for the three gate legs. Those figures are
historical, from another commit, and superseded by the rows above.

Two rows resist the improvement, and both are the honest half of the story. The
10k **collapsed** page barely moves (3.47 at M4 → 3.20) because a hidden node
short-circuits before the size lookup, so that scan never paid the cost being
removed. And the 10k expanded "before" figure is not a typo: the old scan took
**1.8 seconds per call** on that page, which is why its before-run p95 was 5 766 ms.

The scan is now ~3 % of a 16.7 ms frame at 625, ~5 % at 1k, and ~32 % at an
expanded 10k. It remains O(N) per viewport frame by design (§4.5); a spatial index
would make it O(log N) for a graph that needs one, and nothing measured yet does.

## 10k: the escape hatch, and the ceiling

Two pages, both explorations — §4.5 promises no figure at 10k until it is
measured, so nothing asserts a budget on either.

**Collapsed** (`/large-hidden.html`, `results/hidden-10k.json`): 10,000 nodes in
100 containers of 99 children, 98 containers collapsed.

| Metric                     | Value                 |
| -------------------------- | --------------------- |
| rendered nodes             | 200 of 10,000         |
| pan frames                 | 254                   |
| pan median / p95 / longest | 16.7 / 16.8 / 16.8 ms |
| long frames (> 50 ms)      | 0                     |
| cull scan per call         | 3.29 ms               |

**Expanded** (`/large-expanded.html`, `results/expanded-10k.json`): the same
10,000 nodes with nothing collapsed, at zoom 1 — 280 nodes and 300 edges are
inside the culling region, 9,720 nodes and 9,600 edges are not.

| Metric                     | Value                 |
| -------------------------- | --------------------- |
| rendered nodes             | 280 of 10,000         |
| rendered edges             | 300 of 9,900          |
| pan frames                 | 287                   |
| pan median / p95 / longest | 16.7 / 16.8 / 33.4 ms |
| long frames (> 50 ms)      | 0                     |
| cull scan per call         | 5.51 ms               |
| time to first view         | 515 ms                |
| time to settle             | **1 190 ms**          |

So the frame rate is **not** where 10k breaks. Two things are, and both are
stated rather than smoothed over:

- **The settle cost is linear in the graph, not in the view.** The first render
  happens before the pane has been measured, so culling is off for it: all 10,000
  nodes are inserted and all 10,000 run their Mount (a `ResizeObserver` and a
  `MutationObserver` each), and only then does the pane's measurement turn culling
  on and cut the DOM back to 280. That is the 1.2 s (1.18–1.61 s over seven runs at
  this code state, which is machine variance rather than a trend). It is a startup
  cost, not a frame cost, and it is the first thing a 10k consumer feels.
- **The culling scan is O(N) per viewport frame** — 5.3 ms of a 16.7 ms frame at
  an expanded 10k. It still fits, with the whole frame at 16.7 / 16.8 / 33.4, but
  the headroom is now the scan rather than the renderer.

The structural escape the library offers is `hidden`: collapse a subtree and it is
not drawn, not measured, not selected, not described, and not scanned past a set
lookup. That is what turns the collapsed page's 9,720 off-screen nodes into 3.1 ms
of scan instead of 4.7 ms and — more importantly — into 200 DOM nodes instead of
10,000 at startup.

Nothing in M5 changed either startup behaviour. Both are named in the M6 handoff
as candidates; neither is a shipped claim.

## The start-of-pan stall

Carried forward from M2 (`M3-FINDINGS` §5.1): some invocations recorded 1–3 frames
over 50 ms at the start of a pan leg, in runs of identical code that did not agree
with each other, and no cause was found.

M5 measured it instead of re-asserting it. `tests/stall.spec.ts` records four arms
on **twelve fresh page loads** of the 1k fixture — 400 ms of the page doing
nothing, the page's first pan, a second pan on the same page, and a replay of the
gate's own order (drag, then pan) — with each frame's offset from its own arm's
start (`results/pan-stall.json`):

| Arm        | frames | median / p95 / longest | long frames |
| ---------- | ------ | ---------------------- | ----------- |
| idle       | 290    | 16.7 / 16.7 / 16.8 ms  | 0           |
| first pan  | 580    | 16.7 / 16.8 / 16.8 ms  | 0           |
| second pan | 572    | 16.7 / 16.7 / 16.8 ms  | 0           |
| drag→pan   | 585    | 16.7 / 16.8 / 16.8 ms  | 0           |

**2,027 frames, zero over 50 ms, and not one frame above 16.8 ms** — a whole run of
twelve fresh page loads and four gestures with no dropped frame at all. The point of the four arms is
that a stall belonging to the pan's own work would appear at the start of _both_
pans and not in the idle window; a stall belonging to the page's first frames
would appear in the idle arm too. Neither appeared.

What that does and does not settle:

- **Settled**: the failure is not reproduced at this commit by the arms that would
  localise it, and the gate's own two 1k legs recorded 0 long frames in 955 pan
  frames at this commit.
- **Not settled**: the cause. Twelve invocations is enough to show the rate is far
  below the historical one, not enough to declare a mechanism. The 2 % bound stays
  where M2 put it, the gate still fails a leg that exceeds it, and
  `tests/stall.spec.ts` stays in the suite as the baseline method for the next
  person who sees it.
- **Not attributable to M5.** The stall predates the culling-scan change by three
  milestones, and the arm that carries the scan (the pan) is the one that came
  back clean.

## The fixture gallery

`results/gallery.json`, from `tests/gallery.spec.ts`; the pages are linked from
`/gallery.html` (an index generated from the fixture definitions). Six fixtures —
edge types,
labels, markers, sub-flow, a persisted resize box, `fitView` — rendered by React
Flow and by this library from one definition, compared two ways:

- **geometry**: the path `d` strings and the node boxes agree, fixture by fixture,
  after rounding numbers to 1e-3;
- **paint**: within each library, two screenshots differing only in the feature
  (labels off/on, markers off/on, edge types off/on, collapsed/expanded) are
  different, so the feature reached the screen in both.

Pixels are never compared across the two libraries: their stylesheet is theirs
(`PLAN.md` §2.4). One divergence is recorded rather than asserted away — `hidden`
means "collapsed" here and "not drawn" in React Flow, so the same fixture gives 1
node and 0 edges on our side and 3 nodes and 1 edge on theirs (`M5-FINDINGS` §5).

## What would change these numbers

- A different browser or a throttled CPU. The medians are vsync; the p95 and the
  counts move first.
- A ten-times-larger viewport or a lower zoom, which changes how much of a 1k/10k
  graph is inside the culling region.
- A graph with custom node markup: every node in these fixtures is a bare label,
  which is what makes 625 nodes comparable with the wrappers' own stress fixture.
- The gate's 2 % long-frame bound. It is a deliberate allowance for a stall this
  project has measured but not explained; a run that reports a `longFrames` count
  inside it is passing the gate as specified, not passing a zero-tolerance test.
