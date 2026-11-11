# M5 handoff

This is the starting point for the next session. M0–M4 are complete and committed,
v0.1 shipped at M2, **v1.0 shipped at M4**, and M4's findings, two review passes and
an implicit-state audit are all closed. The plan was not re-litigated; the one edit
it has received is the M6 milestone (`docs/PLAN.md` §7), which is **research-first
and out of scope for M5** (see "Do not pre-empt M6" below). The repo is on `main`;
the tree is clean at `4e2a540`, the commit that carries this file. Do not amend
`c40ae47` (M0), `a0a3fdc` (the M1 handoff), `898bb46` (M1 complete), the M2 commits,
`69a630e` (M3 library) with its follow-ups, or the M4 commits, and do not rewrite
history. Commit M5 work at logical checkpoints.

M4 commits, newest last: `b57ac7d` (positions + `hidden`), `2a3b4b0` (snap +
`fitView` options), `30aaa43` (markers + labels), `0058885` (resizing + minimap
click), `0ea7fa2` (sub-flow and 10k pages, proofs 38–46), `3729df8` (M4 contract and
findings), `a080633` (figures reconciled), `1b186f7` (**M6 added to the plan**),
`c4ac7fe` (first review's five findings), `f4503a7` (tracked evidence),
`71c78f7` (linear position resolution), `ec7fc00` (demo reachability),
`5a98dea` (resize visible in flight), `44e661b` (boxed-node CSS scoped out),
`3b710cc` (**`docs/verification.md`**), `4e2a540` (implicit-state audit fixes).

## Copy-paste prompt for the next session

> Work on M5 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M5-HANDOFF.md` first, then `docs/PLAN.md` §4.5, §6, §7 (M5 quoted in the
> handoff; M6 for what **not** to build), plus `docs/verification.md`,
> `docs/M4-FINDINGS.md` §6–§7 and §13–§15, `docs/M3-FINDINGS.md` §5 and §5.1,
> `docs/M1-FINDINGS.md` §9–§11, `docs/foldkit-constraints.md` and `README.md`. Do
> not re-plan or re-litigate the locked decisions, and do not implement anything
> from the M6 list. Run `pnpm typecheck` before `pnpm build`, `pnpm build` (all
> three packages) before any browser run, the touched Playwright files during the
> loop, and the full `pnpm bench` before claiming anything is done. Commit at
> logical checkpoints and record deviations and numbers in `docs/M5-FINDINGS.md`.

## Current state

| Area                 | State                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/flow`      | v1.0.0-track library: interaction core (drag, select, delete, connect, reconnect, resize), measured handle geometry, `isValidConnection`, viewport culling, node cache, `Flow.Remeasure`, own chrome, a11y, sub-flows, `hidden`, snap, `fitView` options, markers, labels, minimap click-to-centre |
| `packages/example`   | 630-node instrumented playground: the 625-node grid plus a 5-node group, drag/select/connect/reconnect/delete, resize, snap, markers/labels, chrome, keyboard, a consumer panel, `data-*` instrumentation for every proof                 |
| `packages/benchmark` | 625 parity + 1k culled + 1k culled-with-chrome gate legs, `/subflow.html`, `/large-hidden.html` (10k with 98 % collapsed), ShadowRoot and culling pages; 48 Playwright tests (44 proofs + 3 gate + 1 exploration)                        |
| Tests                | **276** Vitest tests in 27 files; 44 proof tests (M0 4, M1 9, M2 5, M3 17, M4 9) + 3 gate tests + 1 exploration                                                                                                                          |
| Tooling              | `pnpm check` (typecheck + Enfect lint + Prettier + unit), `pnpm build`, `pnpm dev`, `pnpm bench`; the fast loop and the build-before-browser rule are in `README.md`                                                                       |
| Docs                 | `PLAN.md` (with M6), M0–M4 findings and reviews, `verification.md` (the boundary rule), `IMPLICIT-STATE-AUDIT.md` (response in `M4-FINDINGS` §15), `xyflow-internals.md`, `foldkit-constraints.md`, `README.md` (the public contract) |

**Gate at this commit** (`packages/benchmark/results/*.json`, all four tracked):
625 at parity with React Flow on pan (both 16.7/16.7–16.8, 0 long frames; React's
drag leg is unverified by the harness, M1 §10); 1k culled drag 16.7/16.8, pan
16.7/16.8 (541 frames), 0 long frames; 1k culled **with chrome** pan 16.7/16.7,
0 long frames; 10k with 98 % collapsed → 200 nodes rendered, pan 16.7/16.8
(251 frames), 0 long frames. `cullScanMs` 2.83 (625) / 6.63 (1k) / 6.13 (1k+chrome)
/ 3.47 (10k hidden); `updatePerDispatchMs` 0.0026 / 0.0021 / 0.0022.

## Read first

1. `docs/PLAN.md` §7 **M5** — quoted verbatim under "M5 scope" below — and §7
   **M6**, which lists the eleven gaps M5 must not close.
2. `docs/PLAN.md` §4.5 — the gate, the benchmark protocol (fixtures, build mode,
   environment, script, metrics, acceptance), and the 10k rule: "no numeric promise
   until measured". M5 is the milestone that publishes the numbers this section
   promised.
3. `docs/verification.md` — the boundary rule and the five-question checklist.
   M5 publishes numbers and screenshots, and this is the document that keeps a
   published figure honest (a green assertion is not a measurement of what the user
   sees).
4. `docs/M4-FINDINGS.md` **§6, §7** — the gate at M4 and the measured 10k
   escape-hatch result, including the named bottleneck: `nodeSizeOf`'s O(measured)
   size lookup inside every culling scan. **§13** is the algorithmic fix that came
   after (position resolution is linear); **§14** is the resize reports and the
   build-skew trap; **§15** is the implicit-state audit response.
5. `docs/M3-FINDINGS.md` §5 and **§5.1** — the gate at M3 and the *unexplained
   start-of-pan stall* (0–3 long frames per run, baseline method included). This is
   the one carried-forward unknown, and "publish the numbers" means settling or
   scoping it.
6. `docs/M1-FINDINGS.md` §9–§11 — the harness's own failure modes: a scripted
   gesture that measured an idle page, a drag leg that never dragged, and the
   "could not start safely" build-skew shield. Every number M5 publishes inherits
   these lessons.
7. `docs/foldkit-constraints.md` — what Foldkit requires (Mount args are captured,
   `viewInputs` functions must be top-level, no VNode traversal). The example page
   in §M5's scope is a public artefact: it has to be an example of the *correct*
   patterns, not just a working one.
8. `README.md` — the current public contract (446 lines): measurement, connections,
   chrome, graph features, accessibility. M5 finishes it into package docs.
9. `packages/benchmark/tests/*.spec.ts` and `results/*.json` — the gate protocol as
   code, and the four JSONs the findings quote.

## What M5 inherits

Working, tested, and designed to be published:

- **The gate and its protocol.** Three legs plus a fourth (chrome), all verified to
  have moved something, one worker, production builds, warm-up discarded, 10 runs.
  The harness fails the run when a gesture did not move its target (M1 §9, §10).
- **A measured 10k story.** `hidden` collapsing: 10,000 nodes, 9,800 collapsed, 200
  rendered, frame rate pan — recorded in `results/hidden-10k.json`, gated by
  nothing.
- **Tracked evidence.** `results/{benchmark,benchmark-1k,benchmark-1k-chrome,hidden-10k}.json`
  are all committed; `.gitignore` negates exactly those four.
- **The public surface, documented feature by feature** in `README.md`, with the
  reasoning and proofs in `M0`–`M4-FINDINGS`.
- **The process rules that came out of the failures**: `verification.md` (assert at
  the layer the user perceives), the build-before-browser rule (the benchmark
  bundle inlines the library CSS), and the review/findings loop that has caught
  something at every milestone.

## M5 scope (from `docs/PLAN.md` §7, quoted)

> **M5 — hardening and docs.** Re-run the benchmark at 1k and 10k and publish the
> numbers, including the ceiling if there is one. Ship the fixture gallery against
> React Flow, package docs, and an example app page in the style of `foldkit.dev`'s
> examples.

Turned into a checklist:

1. **Fix the named bottleneck, first.** `nodeSizeOf` scans `model.nodeSizes` per
   node, so a culling scan is O(N × measured): 2.8–3.9 ms at 625, 6.2–6.8 ms at 1k,
   3.5 ms at 10k-hidden — a third of a 16.7 ms frame at 1k. The fix is the one
   `positionIndex` uses: an index memoized on the `nodeSizes` array reference. Do it
   first, because it changes the hot path and every published number has to come
   from the same commit as the fix. Record before/after at 1k and 10k.
2. **Publish the numbers.** A human-readable report (not just JSON): the 625
   comparison, both 1k legs, the 10k collapsed result, `cullScanMs` and
   `updatePerDispatchMs`, the machine and browser, the protocol, and the
   reproduction command. State the **ceiling**: what 10k *expanded* does, measured
   or explicitly unmeasured, and which structural escape the library offers.
   Decide where it lives (a `docs/BENCHMARKS.md` ages better than a README table;
   link it from both).
3. **Settle or scope the start-of-pan stall.** Open since M2 (`M3-FINDINGS` §5.1):
   0–3 frames over 50 ms in a 1k pan leg, not reproducible on demand. Either find
   it (d3-zoom's first-frame work, the throttle's rAF ordering, a cold JIT, the
   recorder itself) or publish it as a known distribution with the baseline method
   and the 2 % bound. Do not publish "0 long frames" as a settled fact while an
   unexplained stall is in the record.
4. **The fixture gallery against React Flow.** Per-feature fixtures rendered by both
   libraries: edge types (bezier / step / smoothstep), labels and markers, sub-flow,
   hidden, resize, fitView. Compare **geometry** (path `d` strings) and each
   library's **own** painted output with one thing changed — never their pixels
   against ours, which would compare stylesheets (§2.4). Keep it in its own spec
   file so the gate suite's 3.3 min does not grow.
5. **Package docs and publish readiness.** `packages/flow/package.json` still says
   `0.0.0`; there is no `LICENSE` file and no package-level `README.md` (npm shows
   the directory's). Set the version, add the MIT licence text, add the
   `@xyflow/system` MIT notice, add a package README that states the three
   measurement-contract sentences and links the full contract, and verify
   `pnpm pack` produces what `files`/`exports` promise (`dist/index.js`,
   `dist/index.d.ts`, `dist/style.css`). **Do not publish to npm without asking.**
6. **The example app page.** `packages/example` is instrumentation: 630 nodes, a
   toolbar of buttons, `data-*` for proofs. M5 ships a *presentable* page in the
   style of `foldkit.dev`'s examples — a small real workflow (custom nodes, a
   panel, connect, resize, collapse), its source shown beside it, and the same
   library code the docs describe. It must not change the playground's fixture: ten
   proofs read its node counts and positions.
7. **Docs and evidence.** `README.md` finished into package docs (status, install,
   quick start, the API surface, the guarantees, the known absences), a
   `docs/M5-FINDINGS.md` with every number and deviation, and an M6 handoff that
   does not claim any of the eleven gaps shipped.

## Do not pre-empt M6

M6 (`docs/PLAN.md` §7) is research-first: `XYResizer`, minimap drag and `onNodeClick`,
edge selection and its focus order, `nodeOrigin`, parent-resize child compensation,
`keepAspectRatio`/`resizeDirection`/`shouldResize`, interactive edge labels,
multi-node resize, per-frame handle re-measurement during a resize, and the culling
scan as a *design* question. M5 may fix the scan's cost (item 1) because the plan
already names it; it must not decide the M6 verdicts, and it must not add public
surface that an M6 verdict would have to remove. If a gallery fixture needs one of
those features, say "not shipped" in the gallery rather than building it.

## Suggested order

1. Culling-scan index + before/after numbers (changes the hot path).
2. Re-run and publish the numbers from the same commit (report + JSONs).
3. 10k expanded: measure, record the ceiling.
4. The pan stall: explain, fix, or scope it in the report.
5. Package docs and publish readiness.
6. The example app page.
7. The fixture gallery against React Flow.
8. `README`/contract updates, `M5-FINDINGS.md`, M6 handoff.

## Known traps and gotchas

Everything in `docs/M1-HANDOFF.md` … `docs/M4-HANDOFF.md` "known traps" still
applies. Sharpened for M5:

- **A published number must come from a run at the publishing commit.** Label
  historical figures as historical (`M1-FINDINGS` §12 established the rule).
- **`pnpm build` (all three) before any browser run.** The benchmark bundle inlines
  `@fllstck/foldkit-flow/style.css` at its own build time (M4 §14): a stale
  benchmark build serves the previous stylesheet and makes fixed code look broken.
- **`pkill -f vite` before a suite run**, or `reuseExistingServer` navigates into a
  preview the run did not start (`M1-FINDINGS` §11, `M4-FINDINGS` §15.5).
- **A gesture that measured an idle page still reports 16.7 ms.** Every leg must be
  proven to have moved something; the harness throws when it did not (M1 §9, §10).
  Keep that discipline in any new leg.
- **The gate is noisy at the class boundary.** A 50.0 ms frame counts as *not*
  long; report counts and the 2 % bound rather than a single longest frame, and
  re-baseline before calling a change a regression.
- **A DOM assertion is not a paint assertion, and an assertion on the element the
  library owns is not an assertion on what the consumer sees**
  (`verification.md`; M3 §14, M4 §14). Gallery screenshots are a substitute for
  neither.
- **Do not compare our pixels to React Flow's.** Their stylesheet is theirs
  (§2.4); compare `d` strings for geometry and our own page against itself for
  paint.
- **The demo's fixture is instrumentation.** Ten proofs read 630 nodes, 416 edges,
  n0/n3/n4 geometry, and the group's collapse counts. Adding the presentable example
  page must not perturb it; prefer a second entry over a rewrite.
- **The 10k page's pan point is an empty-pane point over a collapsed container**
  (`tests/hidden.spec.ts`); changing the fixture means re-deriving it, and the
  helper throws when the pan does not move.
- **The tree's formatting is Prettier's** for `packages/**`, `*.ts|json`,
  `docs/M0-*.md` … `docs/M4-FINDINGS.md` and `docs/verification.md`. `PLAN.md`, the
  critiques and the handoffs are excluded; a new findings document needs adding to
  both `format` and `format:check` in the root `package.json`.

## Verification and definition of done

```sh
pkill -f vite               # a stale preview owns 4173/4174
pnpm typecheck              # first: vite build does not typecheck
pnpm build                  # all three: the benchmark inlines the library CSS
pnpm check                  # typecheck, Enfect lint, Prettier, unit tests
pnpm bench                  # Playwright: every proof + every gate leg
```

M5 is done when:

- the culling scan is indexed, with a before/after number at 1k and 10k in
  `M5-FINDINGS.md`, and the gate still passes (625 parity, 1k p95 < 33 ms, long
  frames inside the 2 % bound);
- the numbers are **published** in a reader-facing document, at the commit that
  carries it, with the protocol, the machine, and the reproduction command;
- the 10k ceiling is stated: the collapsed result, the expanded result if measured,
  and which escape the library offers if it is not;
- the pan stall is explained, fixed, or explicitly scoped in the published report;
- the gallery renders every M4 feature in both libraries and compares geometry (and
  our own paint) without importing their identity;
- `packages/flow` is publishable: version, licence, dependency notice, package
  README, and `pnpm pack` inspected (published only with an explicit go-ahead);
- the example app page exists, is presentable, and the playground's fixture is
  byte-for-byte what the proofs expect;
- `pnpm typecheck`, `pnpm build`, `pnpm check` and `pnpm bench` are green, the four
  result JSONs are committed from that run, and `docs/M5-FINDINGS.md` records every
  deviation and number.

## Open design questions for M5

- **Where do the published numbers live?** A `docs/BENCHMARKS.md` can carry tables,
  protocol, machine and dates without bloating the README; the README then states
  the contract and links it. Alternatively the package README is the one npm shows.
  Pick one home and link it from the other two.
- **Does the culling-scan index belong next to `positionIndex`** (same memo shape,
  one file) **or in `bounds.ts`** where `nodeSizeOf` lives? Either is defensible;
  what matters is that it is memoized on the `nodeSizes` array reference and that
  `nodeSizeOf` keeps its signature.
- **Does the gallery become a fourth Playwright file, a new page set, or its own
  package?** The constraint is that the gate suite's runtime (~3.3 min) must not
  grow, and the gate pages must keep the DOM they have always measured.
- **Is the presentable example a second route in `packages/example` or a new
  package?** A second entry keeps the fixture honest with less machinery; a new
  package states "this is the example" more clearly and can be published as such.
- **What does v1.0 promise after M5?** The README should say what is stable
  (Model/Message/OutMessage shapes, the measurement contract, the class prefix) and
  what is explicitly absent (edge selection, minimap drag, `nodeOrigin`, multi-node
  resize, interactive labels) so M6's verdicts are additive rather than surprising.
- **Publish now or after M6?** M5 makes the package *publishable*; whether 1.0.0
  goes to npm before the M6 research lands is the owner's call, and the handoff
  should not assume it.

## Working agreements

- Do not edit `docs/PLAN.md` wholesale. Put deviations and proposed diffs in
  `docs/M5-FINDINGS.md`, as M0–M4 did. (M4 recorded the one plan edit it made:
  adding M6, `M4-FINDINGS` §11.)
- Do not import `@xyflow/react` or `@xyflow/svelte` outside `packages/benchmark`.
- Do not copy upstream CSS or add an attribution component.
- Do not amend `c40ae47`, `a0a3fdc`, `898bb46`, the M2 commits, `69a630e` and the M3
  commits, or the M4 commits; commit at logical checkpoints; ask before force-pushing
  or rewriting history. No network install beyond npm without asking, and no npm
  publish without asking.
- Every claim in the findings document must come from a run at the commit that
  carries it, and stale figures must be labelled historical (`M1-FINDINGS` §12).
