# M6 handoff

Starting point for M6. **M0–M5 are complete, `@fllstck/foldkit-flow` `0.1.1` is
published and tagged** (npm `latest`, git `v0.1.0` and `v0.1.1`), and the tree is
clean on `main`. M5 hardened and published: the culling scan is indexed, the numbers
are in [`BENCHMARKS.md`](BENCHMARKS.md), there is a fixture gallery against React Flow,
a presentable example page, seven example pages with their own source, and a release
process that has now run twice.

Do not amend `c40ae47`, `a0a3fdc`, `898bb46`, the M2 commits, `69a630e` with its M3
follow-ups, the M4 commits, or the M5 and release commits; commit at logical
checkpoints and do not rewrite history. Published versions are immutable: a wrong
README or a missing field is fixed by the *next* version
([`RELEASING.md`](RELEASING.md)).

M6 is **research first**: its first deliverable is `docs/M6-RESEARCH.md`, not a
feature. [`PLAN.md`](PLAN.md) §7 "M6 — the deliberate gaps, researched first" is
binding, and its method — primary sources only, a second implementation per point, two
dated sources per claim, behaviour-never-look, measure what the sources cannot settle
— is not advisory. Every row of its table ends in **ship**, **ship differently** (with
the difference stated) or **keep out** (with the reason and what would change it).

## Copy-paste prompt for the next session

> Work on M6 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M6-HANDOFF.md` first, then `docs/PLAN.md` §7 **M6** (the method, the
> eleven-row research table, the order, the definition of done), §2.4 (no upstream
> stylesheet, no attribution), §4.5 (the gate and its protocol) and §6 (the test
> split); `docs/M6-RESEARCH.md` does not exist yet and *is* the deliverable. Then
> `docs/BENCHMARKS.md` (the numbers to re-run, the 10k ceiling, the scoped pan
> stall), `docs/TEST-STRATEGY.md` (which rung a claim belongs on, and the audit of
> every browser proof), `docs/M5-FINDINGS.md` (what M5 changed: §3.1 the two extra
> metrics, §8.2 the pan-jump, §13–§16 the release), `docs/M4-FINDINGS.md` §8 (the
> eleven gaps as M4 left them) with §2.6, §2.9, §2.10 (the decisions M6 revisits),
> `docs/CONTRACT.md` (the public surface as it ships), `docs/verification.md`,
> `docs/foldkit-constraints.md`, `docs/xyflow-internals.md`. Research, then decide,
> then code only what the decision says. Run `pnpm typecheck` before `pnpm build`,
> `pnpm build` (all three) before any browser run, the touched Playwright files
> during the loop, and the full `pnpm bench` before claiming anything is done. No
> npm publish and no push without asking.

## Current state

| Area | State |
| ---- | ----- |
| `packages/flow` | **`0.1.1` on npm and tagged.** ESM-only, `publishConfig.access: public`, `prepublishOnly` = typecheck + test + build. Surface unchanged since M4; M5 added one internal index (`geometry/bounds.ts`) and no public API |
| `packages/example` | **Three kinds of page, one build**: `/` the 630-node instrumented playground (ten proofs read its fixture), `/example/` a presentable pipeline with its source beside it, `/examples/` an index plus seven example pages — each example is a spec (data + policy) run by one shared harness, with its own source shown via `?raw` |
| `packages/benchmark` | Gate legs (625 comparison, 1k culled, 1k + chrome), 10k collapsed, 10k **expanded**, the React Flow **gallery**, the **pan-stall** diagnostic, the **churn** page — 56 Playwright tests in 13 files, ~4.9 min |
| Tests | **311** Vitest tests in 33 files (289 flow, 22 example); 56 Playwright tests (45 proofs, 3 gate legs, 4 explorations, 2 gallery, 2 example) |
| Docs | [`PLAN.md`](PLAN.md) (revision 7, untouched by M5), **[`BENCHMARKS.md`](BENCHMARKS.md)** (the published numbers), **[`CONTRACT.md`](CONTRACT.md)** (the public contract), [`TEST-STRATEGY.md`](TEST-STRATEGY.md), [`verification.md`](verification.md), M0–M5 findings, [`RELEASING.md`](RELEASING.md), [`DOCS-PROPOSAL.md`](DOCS-PROPOSAL.md), `IMPLICIT-STATE-AUDIT.md`, `foldkit-constraints.md`, `xyflow-internals.md`, `README.md` + [`CHANGELOG.md`](../packages/flow/CHANGELOG.md) |
| Evidence | `packages/benchmark/results/`: `benchmark.json`, `benchmark-1k.json`, `benchmark-1k-chrome.json`, `hidden-10k.json`, `expanded-10k.json`, `gallery.json`, `pan-stall.json`, `churn.json` — all tracked |

## The eleven gaps, all still open

M5 added **no public surface**, so no M6 verdict has to remove anything: every gap M4
named is exactly as M4 left it.

| # | Gap (§ of `M4-FINDINGS.md`) | State at `0.1.1` |
| - | --------------------------- | ---------------- |
| 1 | `XYResizer` (§2.6) | Not used. Our resize gesture is unchanged; `resize` draws `node.size` and reports `ResizedNodes` |
| 2 | Minimap interaction (§2.9) | Click-to-centre only. No drag, no wheel, no `onNodeClick` |
| 3 | Edge selection (§2.10) | Not selectable from the pointer layer. `selectedEdgeIds` exists in the Model but only `removeEdges`/`informGraphChanged` write it |
| 4 | `nodeOrigin` (§8) | Not supported: positions are top-left relative |
| 5 | Parent resize re-placing children (§8) | Children keep their relative positions; a parent resize does not move them |
| 6 | `keepAspectRatio`, `resizeDirection`, `shouldResize` (§8) | None exist. Four corner controls, one delta, no aspect lock |
| 7 | Interactive edge labels (§8) | `edge.label` renders as SVG `<text>`; `renderEdgeLabel` replaces its content, not its interactivity |
| 8 | Multi-node resize (§8) | Single node per gesture. A selection can be dragged together, not resized together |
| 9 | Handle geometry during a resize (§8) | Handles are measured on the node's own measurement; a resize writes the box as a measurement, and handle geometry is not re-derived per resize frame |
| 10 | The culling scan (§6, §7) | **Partly moved, not closed.** M5 removed the O(measured) factor the plan named (`nodeSizeOf`'s linear lookup, now an index: 6.0 → 0.9 ms at 1k, 1 808 → 5.5 ms at an expanded 10k). A scan is still O(N) per viewport frame, and whether an index or a coarser cadence is right for 10k is still the question |
| 11 | Edge focus and the tab order (§2.10, §10 a11y) | Unchanged: nodes are focusable, edges are not, and the description lists edges without a focus target |

## Read first

1. `docs/PLAN.md` §7 **M6** — the method, the eleven-row table, the order (10 first;
   then 3 with 11 as one unit; then 1; then 2, 4, 5, 6; then 7 and 8) and the
   definition of done.
2. `docs/BENCHMARKS.md` — the gate, the 10k ceiling and the scoped stall, with the
   reproduction commands. Any M6 claim that costs frames is measured this way.
3. `docs/TEST-STRATEGY.md` — the five rungs and the per-proof audit. It changes *where*
   an M6 proof goes: gesture math is rung 2, view wiring rung 3, a Mount's own
   emissions rung 4, geometry/paint/the engine rung 5.
4. `docs/M5-FINDINGS.md` — §3.1 (the startup and heap columns, and the loop-counter
   trap), §5 (the gallery, and the two things that had to be made identical),
   §8.2 (the pan-jump: `MountedPane` precedes the first `ResizedPane`), §13–§16 (the
   release, and what a published version cannot fix).
5. `docs/M4-FINDINGS.md` §8 (the gaps as M4 left them), §2.6 (`XYResizer` rejected),
   §2.9 (minimap), §2.10 (edge selection), §13.1 (one visit per node), §14 (resize,
   and the boundary rule).
6. `docs/CONTRACT.md` — what ships today, feature by feature. An M6 feature that ships
   has to land here.
7. `docs/verification.md` — the boundary rule and the five-question checklist.
8. `docs/foldkit-constraints.md` — every `XYResizer`/`XYMinimap` verdict runs into the
   same seam: Mount args are captured, `viewInputs` functions must be top-level, there
   is no VNode traversal.
9. `docs/xyflow-internals.md` — the store, `updateNodeInternals`, what the wrappers pass
   to `@xyflow/system`. Update it; do not re-derive it.
10. `packages/benchmark/tests/*.spec.ts` and `results/*.json` — the protocol as code,
    and the JSONs every published figure comes from.

## What M5 found that M6 needs

- **The 10k cost moved from frames to startup.** `/large-expanded.html` pans at
  16.7 / 16.8 / 16.8 with 280 of 10,000 nodes rendered, but takes **~1.2 s to settle**:
  the first render happens before the pane is measured, so culling is off for it, all
  10,000 nodes are inserted and all 10,000 Mounts run before the measurement cuts the
  DOM back. Not on M6's list — a candidate, written down rather than built. If M6 takes
  it, it is a *design* question with a measured before/after at 10k, and it changes the
  DOM the 10k collapsed exploration counts.
- **The gallery is where a new feature gets proved against React Flow.** Six fixtures
  agree on geometry (`d` strings and node boxes) and are compared for paint within each
  library. When M6 ships edge selection, minimap drag or a resizer, the fixture goes in
  `src/gallery/fixtures.ts` — after reading `M5-FINDINGS` §5: the node box and the
  anchor had to be made identical on both sides, or the `d` strings differ by
  typography rather than by geometry.
- **The examples are data + policy over one harness.** `packages/example/src/examples/`
  is a `harness.ts` (the app: Model, Messages, `foldOutMessage`, panel, source pane)
  and seven specs (graph, renderer options, `isValidConnection`, optional `renderNode`).
  A new M6 feature that needs a gesture gets a spec flag and a spec file, not a second
  application — and `tests/examples.spec.ts` walks the index, so a new one is proved by
  existing.
- **`foldOutMessage` is the consumer shape M6 must not break.** The harness folds all
  seven facts; `M5-FINDINGS` §15.1 is why the README no longer pretends a snippet does.
- **`data-nodeid` is on the handles and resize controls too**, so a node is
  `.fflow__node[data-nodeid="…"]`. Documented in the contract; do not "fix" it without
  checking the proofs that read those elements.
- **The pan stall is scoped, not explained.** `tests/stall.spec.ts` is the baseline
  method (four arms, twelve fresh page loads). If long frames reappear, run it before
  blaming the change; if it localises the stall, `BENCHMARKS.md`'s section needs
  updating.

## Testing

`docs/TEST-STRATEGY.md` is the map: rungs 1–5, the rule that a claim lives on the
lowest rung that can see it, and the audit of all 56 browser proofs against the rungs
below. Two gaps it closed during M5 are the ones M6 will need most: **Scene**
(`view/chrome.scene.test.ts`, view wiring and `expectIgnored`) and **Mount stream**
(`runtime/mountPane.test.ts`, what a Mount really emits). Two limits to remember:

- **A `Command.mapMessages`-wrapped Command cannot be resolved in Story** — Story
  validates against the Definition's schemas. The positive claim has to live one rung
  up.
- **jsdom has no layout**: `getBoundingClientRect` is 0×0, so anything derived from
  measurement (the fit, culling, hit-testing a measured handle, the minimap mapping) is
  rung 5 only — and a green test there proves nothing about what a user sees.

## Known traps and gotchas

Everything in the M1–M5 handoffs still applies. Sharpened for M6:

- **`pkill -f vite` before a suite run.** A leftover preview owns 4173/4174,
  `reuseExistingServer` navigates into it, and nothing is measured.
- **`pnpm typecheck`, then `pnpm build` (all three), then the browser.** The benchmark
  bundle inlines the library's CSS at its own build time; a stale build makes fixed code
  look broken.
- **A gate test that hits its 600 s timeout is usually the machine.** A stray CPU-bound
  process and two overlapping suites produced 12-minute legs once; the same tree passed
  in 4.9 min when idle. Check `uptime` and for leftover browsers first.
- **A gesture that measured an idle page still reports 16.7 ms.** Every leg proves it
  moved something. Mind the second-pan trap: after a pan, the "empty" press point is
  over a node, so a second pan needs a fresh hit test (`tests/stall.spec.ts`'s
  `emptyPointNear`).
- **The gate is noisy at the class boundary.** 50.0 ms is not long; report counts and the
  2 % bound, and re-baseline before calling a change a regression.
- **Numbers must come from a run at the commit that publishes them.** If a release
  changes no runtime code, say so and footnote it rather than re-quoting a stale run
  (`packages/flow/CHANGELOG.md`'s 0.1.1 entry is the pattern).
- **A DOM assertion is not a paint assertion, and an assertion on the element the library
  owns is not an assertion on what the consumer sees.** `tests/example.spec.ts` (resize
  mid-gesture) is the model; `verification.md` is the rule.
- **Do not compare our pixels to React Flow's.** Geometry (`d` strings) and each
  library's own paint; never their stylesheet.
- **The demo's fixture is instrumentation.** Ten proofs read 630 nodes, 416 edges,
  n0/n3/n4 geometry and the group's collapse counts. `/example/` and `/examples/` are
  separate routes for that reason.
- **`/example/` and `/examples/<name>/` need their trailing slash** on a static host;
  the unslashed path serves the playground's document and hydrates the wrong app.
- **Publishing needs the owner.** `0.1.0` and `0.1.1` both needed a human at the
  registry: an expired token, then a 2FA one-time password. After a publish, npm's
  cached packument can make `npm install <pkg>@<new>` fail with `notarget` for a few
  minutes (`--prefer-online`). A plain `git push` leaves tags behind — check
  `git ls-remote --tags`.
- **Formatting**: Prettier owns `packages/**`, `*.ts|json`, the M0–M5 findings,
  `docs/CONTRACT.md`, `docs/TEST-STRATEGY.md`, `docs/BENCHMARKS.md`, `docs/RELEASING.md`
  and the committed reviews. `PLAN.md`, the critiques and the handoffs are excluded; a
  new findings, research or review document needs adding to **both** `format` and
  `format:check`.

## Verification and definition of done

```sh
pkill -f vite          # a stale preview owns 4173/4174
pnpm typecheck         # first: vite build does not typecheck
pnpm build             # all three: the benchmark inlines the library CSS
pnpm check             # typecheck, Enfect lint, Prettier, 311 unit tests
pnpm bench             # every proof, every leg: 56 tests, ~4.9 min
```

M6 is done when `PLAN.md` §7's list holds: `docs/M6-RESEARCH.md` exists with one
section per row, each ending in a verdict with links and dates; every **ship** is
implemented with an M4-style proof on the right rung; every **keep out** is in
`docs/M6-FINDINGS.md` with the reason and the evidence it still holds; the gate is
unchanged and re-run at the committing commit (625 parity, 1k p95 < 33 ms, long frames
inside the 2 % bound), re-baselined at 1k **and** 10k if the scan changes;
`docs/CONTRACT.md` and `README.md` document whatever shipped; `packages/flow`'s
`CHANGELOG.md` gains the entry; and all four commands are green.

If a verdict adds public surface, the release is **not** an automatic `1.0.0`: the
owner's rule is that `1.0.0` follows real usage, not a milestone. A shipped feature is
`0.2.0` unless the owner says otherwise, and publishing stays theirs to authorise.

## Open questions for M6

- **Does item 10 still need its own fix?** The scan is ~0.9 ms at 1k and ~5.5 ms at an
  expanded 10k, against a 16.7 ms frame. If a spatial index is not warranted, the
  verdict is "keep out, with the numbers", and the claim that pays for it is that a
  scan is O(N) per viewport frame by design (§4.5).
- **Does the 10k startup cost belong to item 10 or to a new candidate?** Same page,
  same measurement, and now the larger number.
- **Does the gallery become a per-feature proof requirement for M6 ships?** It is the
  only place the two libraries are compared on one input, and it costs ~12 s.
- **Does `0.1.x` become `1.0.0` during M6, or after it?** The owner's rule is usage.
- **Do the docs get slices 2–3?** `docs/DOCS-PROPOSAL.md`: a generated reference from
  the JSDoc (needs two devDependencies, so it needs a yes) and a regrouped Learn path.
  Slice 1 — the examples — shipped in M5.
- **Does the changelog get generated?** `M5-FINDINGS` §7.1: pick changesets,
  release-please or `conventional-changelog-cli` by how the version bump is decided,
  enforce conventional messages with a `commit-msg` check in the same change, and let it
  maintain `packages/flow/CHANGELOG.md`, which now has two real entries to compare
  against.

## Working agreements

- Do not re-litigate the locked decisions (§9 of the plan) and do not edit the plan
  wholesale; deviations and proposed diffs go into `docs/M6-FINDINGS.md`.
- Do not import `@xyflow/react` or `@xyflow/svelte` outside `packages/benchmark`.
- Do not copy upstream CSS or add an attribution component (§2.4).
- Commit at logical checkpoints; no force-push, no history rewrite, no amended commit
  from an earlier milestone.
- No npm publish, no push, and no network install beyond npm, without asking.
- Every claim in the findings document must come from a run at the commit that carries
  it; stale figures are labelled historical (`M1-FINDINGS` §12).
