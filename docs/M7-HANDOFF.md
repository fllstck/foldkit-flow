# M7 handoff

Starting point for the next session. **M0–M6 are complete**, `@fllstck/foldkit-flow`
`0.1.1` is published on npm (`latest`) and tagged `v0.1.0` / `v0.1.1` (both pushed),
and the tree is clean on `main`, **9 commits ahead of `origin/main`** — push only if
asked.

M7 is **not in `PLAN.md` §7**, which ends at M6. This handoff proposes it: the work it
describes is the closable half of M6's keep-outs, identified by
[`M6-RESEARCH-FOLLOW-UP.md`](M6-RESEARCH-FOLLOW-UP.md) and costed in
[`M6-RESEARCH-FOLLOW-UP-REVIEW.md`](M6-RESEARCH-FOLLOW-UP-REVIEW.md). The plan stays
untouched; the proposed §7 addition is at the end of this file, and it goes into
`docs/M7-FINDINGS.md` before it goes anywhere near `PLAN.md`.

Do not amend any commit from M0–M6 or the releases; commit at logical checkpoints and do
not rewrite history. Published versions are immutable — a wrong README is fixed by the
*next* version ([`RELEASING.md`](RELEASING.md)).

## Copy-paste prompt for the next session

> Work on M7 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M7-HANDOFF.md` first — it is the plan for this session. Then read
> `docs/M6-RESEARCH-FOLLOW-UP.md` (§1–§4 are the proposals) with
> `docs/M6-RESEARCH-FOLLOW-UP-REVIEW.md` (the second-revision section says what the
> follow-up still leaves open), `docs/M6-RESEARCH.md` §7 (the `shouldResize` verdict this
> work reverses), `docs/M6-FINDINGS.md` §3–§4 and §7, `docs/CONTRACT.md` (resizing,
> selecting an edge, accessibility), `docs/TEST-STRATEGY.md` (which rung a claim belongs
> on), `docs/verification.md` (the five-question checklist) and
> `docs/foldkit-constraints.md`. The first two items are pure functions and should land
> in one sitting: `canResize` in `Flow.Context`, then `Flow.compensateChildPositions`.
> The third — the edge overlay primitive — is a design before it is code. Run
> `pnpm typecheck` before `pnpm build`, `pnpm build` (all three) before any browser run,
> the touched Playwright files during the loop, and the full `pnpm bench` before claiming
> anything is done. No npm publish and no push without asking.

## Current state

| Area | State |
| ---- | ----- |
| `packages/flow` | **`0.1.1` on npm and tagged.** ESM-only, `publishConfig.access: public`, `prepublishOnly` = typecheck + test + build. M6 added `RendererConfig.edgeSelection`, `Message.PressedEdge` / `ActivatedEdge`, `Message.StartedMiniMapPan` + `Gesture.MiniMapPanning`, and `ResizeOptions.keepAspectRatio` |
| `packages/example` | `/` the 630-node instrumented playground (ten proofs read its fixture), `/example/` a presentable pipeline, `/examples/` an index plus eight example pages from one harness. `/examples/resizing/` carries `edgeSelection` |
| `packages/benchmark` | Gate legs (625 comparison, 1k culled, 1k + chrome), 10k collapsed, 10k expanded, the React Flow gallery, the pan-stall diagnostic, the churn page, and **`/m6.html`** — 61 Playwright tests in 14 files, ~5.0 min |
| Tests | **334** Vitest (311 flow, 23 example); **61** Playwright |
| Gate at `08572a8` | 625 pan 16.7 / 16.7 / 16.8 (React Flow 16.7 / 16.7 / 33.3), 1k p95 16.8, **zero long frames in 3 397 recorded frames**; `cullScanMs` 0.498 / 0.750 / 0.660 (625 / 1k / 1k+chrome), 3.242 (10k collapsed), 5.422 (10k expanded); expanded 10k: 280 of 10,000 rendered, 523 ms to first view, **1 201 ms to settle** |
| Docs | [`PLAN.md`](PLAN.md) (revision 7), [`BENCHMARKS.md`](BENCHMARKS.md), [`CONTRACT.md`](CONTRACT.md), [`TEST-STRATEGY.md`](TEST-STRATEGY.md), [`verification.md`](verification.md), M0–M6 findings, **`M6-RESEARCH.md`** (the eleven verdicts), **`M6-RESEARCH-FOLLOW-UP.md`** + **`…-REVIEW.md`**, [`RELEASING.md`](RELEASING.md), [`DOCS-PROPOSAL.md`](DOCS-PROPOSAL.md), `foldkit-constraints.md`, `xyflow-internals.md`, README + [`CHANGELOG.md`](../packages/flow/CHANGELOG.md) with an `[Unreleased]` M6 entry |

## What M6 left, and what M7 takes

Seven rows were **keep out** (`M6-RESEARCH.md`, `M6-FINDINGS.md` §4). Three of them are
now closable, one partially, and three cannot be solved:

| # | Keep-out | M7 | Shape it takes |
| - | --- | --- | --- |
| 5 | Parent resize re-placing children | **Take** | `Flow.compensateChildPositions` — pure, returns child-relative positions, direct children only |
| 7 | Interactive edge labels | **Take, after a design** | An HTML overlay layer in the pane, `scale(1/zoom)`, consumer-owned markup |
| 9 | Handle geometry during a resize | **Partial** | A consumer *declared-geometry* mode; the general one-frame lag stays |
| 1 | `XYResizer` | **No** | Its useful parts are taken without it (aspect lock shipped, `canResize`, the helper) |
| 4 | `nodeOrigin` | **No** | Boundary conversion stays |
| 8 | Multi-node resize | **No** | A new interaction mode, needs a consumer |
| 10 | The culling scan | **No** | Not needed at the measured cost |

And one keep-out inside a shipped row: **`shouldResize`** (row 6) — taken as
`canResize`, a pure veto in `Flow.Context`. That reverses `M6-RESEARCH.md` §7, which is
the one verdict this milestone has to edit rather than append to.

## Read first

1. [`docs/M6-RESEARCH-FOLLOW-UP.md`](M6-RESEARCH-FOLLOW-UP.md) — §3 (`canResize`), §4
   (the compensation helper), §2 (the overlay), in that order of readiness. §1 (the 10k
   startup) is **not** M7; see "Not in M7".
2. [`docs/M6-RESEARCH-FOLLOW-UP-REVIEW.md`](M6-RESEARCH-FOLLOW-UP-REVIEW.md) — the
   second-revision section names the three things the follow-up still leaves: where the
   estimate comes from, what a veto keeps, and the missing cross-links.
3. [`docs/M6-RESEARCH.md`](M6-RESEARCH.md) §7 — the verdict being reversed, and why it
   was taken. Read the whole section before changing it; the reversal is of
   *upstream's* `shouldResize` (which rolls back the parent box, the start position and
   every child's position, `@xyflow/system@0.0.84` `dist/esm/index.js:3607`–`:3615`),
   not of a pure predicate.
4. [`docs/M6-FINDINGS.md`](M6-FINDINGS.md) §3 (the three M6 ships and their proofs), §4
   (the keep-outs), §5 (the two traps: `[data-edgeid]` counts and `h.Tabindex` on SVG).
5. [`docs/CONTRACT.md`](CONTRACT.md) — resizing, "Selecting an edge", accessibility.
   Whatever ships has to land here in the same commit.
6. [`docs/TEST-STRATEGY.md`](TEST-STRATEGY.md) — rung 1 is where both pure functions
   belong; the overlay is rung 3 for wiring and rung 5 for paint.
7. [`docs/verification.md`](verification.md) — the five-question checklist. The overlay
   is the first feature since M4 that has to answer all five.
8. `packages/flow/src/update.ts` (`MovedPointer`'s resize branch), `geometry/resize.ts`,
   `model.ts` (`Context`, `init`), `view/view.ts` (the edges layer, `ViewInput.panel`),
   `view/selection.scene.test.ts` and `tests/m6.spec.ts` (the M6 proof style).

## The work, in order

### 1. `canResize` — a pure veto in `Flow.Context` (do first)

Why it is first: it is one branch in `update`, it closes a keep-out, and it needs no
rendering change at all.

```ts
// model.ts, beside `isValidConnection`
canResize?: (input: {
  node: FlowNode<NodeData>;
  start: Rect;
  next: Rect;
  modifier: boolean;
}) => boolean;
```

- **Veto only.** It may not return a box. A predicate that returns a `Rect` owns the
  gesture, and the snapshot the rest of the machine reads stops being the gesture's own.
- **Name it `canResize`**, matching `isValidConnection`, and keep it in `Context` (which
  the consumer rebuilds per dispatch, so it costs nothing).
- **A `false` keeps the last accepted box**, not the start box. That is what lets a
  consumer say "this node may grow but not shrink below its current size" without the
  gesture snapping back to where it began. Decide and document it in `update`'s docblock,
  then prove it: press, move to an accepted box, move to a rejected one, release.
- It is consulted per pointer event in `MovedPointer`'s `Resizing` branch, on the
  *proposed* box before it becomes `current`. `StartedResize` is not gated — a gesture
  starts and its first frame decides.
- Tests: rung 1 is not where this lives — the predicate is consumer code. Rung 2
  (`state.test.ts`): reject keeps the last accepted box; accept passes through; an
  absent predicate is "accept everything"; a predicate that throws is not caught (say so
  rather than swallowing it). One rung-3 or rung-5 proof only if the browser adds
  something the state machine cannot see — it does not.
- Docs: `CONTRACT.md`'s resizing section, the `CHANGELOG.md` entry, and **edit
  `M6-RESEARCH.md` §7 and `M6-FINDINGS.md` §4** to point at the reversal. This is the one
  place M7 corrects M6 rather than adding to it.

### 2. `Flow.compensateChildPositions` — the pure helper

```ts
compensateChildPositions({
  parentBefore, parentAfter,            // the pair the consumer persists
  children,                             // { id, position } from the current graph
}): ReadonlyArray<{ nodeId: string; x: number; y: number }>
```

- **Direct children only.** Grandchildren follow when their own parent is compensated;
  the docblock says so rather than leaving it to be discovered.
- **Take the parent's own before/after pair** — never recompute the delta from an
  absolute grandparent position. For a nested container the delta is a *relative*
  number, and the upstream formula (`child.position -= (Δx, Δy)` at origin `[0, 0]`) is
  quoted verbatim in `M6-RESEARCH.md` §6.
- It returns; it does not mutate, emit an `OutMessage`, or assume the consumer applies it.
- Rung 1 (`geometry/`), four cases: a top-left resize moves the box and the children
  compensate; a bottom-right resize leaves them alone (the anchor did not move); a child
  of a child is untouched by its grandparent's helper call; an empty child list returns
  nothing.
- `CONTRACT.md` gets the worked example that currently says "subtract the parent's
  top-left delta" — it becomes a call.

### 3. The edge overlay — a design before it is code

Follow-up §2 and review §2. The deliverable order is: a short design note in
`docs/M7-FINDINGS.md`, then the layer, then the proof.

- **The layer.** A div inside `.fflow__pane`, positioned in flow space, one child per
  anchored item, each with `transform: translate(x, y) scale(1/zoom)` (the arithmetic
  the pinned engine exports as `getEdgeToolbarTransform`). Decide *where* it sits in the
  stack: it must paint **above the edges and below the nodes**.
- **The seam.** `ViewInput.panel` is the consumer's own markup *outside* the transform;
  this is different — flow-anchored, so the library owns the anchor and the consumer owns
  the markup and its messages. A `renderEdgeOverlay`-style hook, or a pane-level
  `overlay(...)` helper in the `panel(...)` idiom. Do not widen `renderEdgeLabel`: its
  contract is the *content* of an SVG `<text>`.
- **The guards.** A new `isOverlayTarget` in `runtime/domTarget.ts`, declined by the pane
  handler exactly as `isEdgeTarget` and `isChromeTarget` are — otherwise every press on a
  control clears the selection and starts a pan.
- **The tab-stop rule.** Our edges are `role="button"` tab stops. A focusable control
  over one is a *second* tab stop at the same visual place. Not an ARIA violation (not
  nested — different layers), but the contract must say it.
- **Proofs, all five checklist questions**: it paints above the edges and below the
  nodes (pixels, two states); a press on it neither pans nor clears the edge selection;
  it stays screen-size-stable while zooming and anchored while panning; keyboard focus
  reaches the consumer's control; and it works on a second consumer page.

### 4. Declared handle geometry — only if a consumer asks

The escape hatch for keep-out 9: a node that declares its handles (the pinned engine's
`userNode.handles` → `parseHandles`) is not measured for them, so there is nothing to lag.
It is exact only when the declaration agrees with the consumer's CSS, and a wrong
declaration moves an endpoint *every* frame instead of one late. This is the last item,
and it should not be built without a consumer.

## Not in M7

- **The 10k startup design** (follow-up §1). It is the largest measured cost (1 201 ms to
  settle) and it is **not** a helper: it needs the 3 × 3 measurement grid (625 / 1k / 10k
  × today / estimate / gate), a redesigned `data-measured` readiness signal in
  `tests/expanded.spec.ts`, and an SSR story (proof 4 asserts the *transform*, so a gated
  graph would pop in after hydration with every proof still green). Its own milestone.
  Note the open question the revision leaves: the estimate cannot come from "the pane
  element's initial box" — the element does not exist until the first `view` has been
  patched — so it is a declared rect on **`Flow.init`** (where `model.pane` is zeroed),
  not a renderer option.
- **Multi-node resize** (follow-up §5), **composite keyboard navigation** (follow-up §6),
  **`nodeOrigin`**, **the culling index**: unchanged keep-outs with a trigger each.
- **`1.0.0`.** The owner's rule is usage, not milestones (`M5-FINDINGS` §13). The M6 and
  M7 surfaces are meant to be `0.2.0`, and publishing is the owner's decision.
- **The two M5 leftovers**: an automatic changelog (needs a `commit-msg` check in the same
  change) and `DOCS-PROPOSAL.md` slices 2–3 (needs two devDependencies, so it needs a
  yes).

## Decisions already made, do not re-open

- **`canResize` is a veto, not a box** — `M6-RESEARCH-FOLLOW-UP-REVIEW.md` §3.
- **The compensation helper returns, the consumer persists** — follow-up §4, and
  `M6-RESEARCH.md` §6 says why (a fact the consumer does not apply snaps back on release;
  a returned value has no such failure mode).
- **The overlay is a layer, not a widened `<text>`** — `M6-RESEARCH.md` §8.
- **`XYResizer`, `nodeOrigin`, multi-node resize and the culling index stay out** —
  `M6-RESEARCH.md` §3, §5, §9, §1.
- **The gate does not move**: 625 parity, 1k p95 < 33 ms, long frames inside 2 %.

## Known traps and gotchas

Everything in the M1–M6 handoffs still applies. Sharpened:

- **`pkill -f vite` before a suite run**, `pnpm typecheck` before `pnpm build`, build all
  three before the browser (the benchmark inlines the library's CSS at its own build
  time).
- **`[data-edgeid]` is the edge count.** `tests/examples.spec.ts` and
  `tests/gallery.spec.ts` count edges with `querySelectorAll("[data-edgeid]")`, so no new
  element may carry it. The interaction path deliberately does not (`view/classes.ts`).
- **`h.Tabindex` / `h.Role` set DOM *properties*.** jsdom has no `tabIndex` on an
  `SVGElement`, so an SVG control needs `h.Attribute("tabindex", "0")`. Found by a rung-3
  test in M6.
- **A DOM assertion is not a paint assertion** — the overlay's first two claims are
  exactly this shape (`docs/verification.md`, `M3-FINDINGS` §14, `M4-FINDINGS` §14).
- **`page.waitForFunction` has no default timeout.** Every new wait passes an explicit
  one; a Foldkit crash view never yields `main.app` and the run hangs instead of failing.
  M6's proof 49 found a real bug (the minimap scale inversion) only because it measured
  the screen.
- **The `write` tool wrote 0 bytes silently all through M6.** If a new file comes back
  empty, do not retry blindly: create it and read it back, and test the thing it holds.
- **Numbers must come from a run at the commit that publishes them** (`M1-FINDINGS` §12).
  If a change touches no runtime code, say so and footnote it instead of re-quoting.

## Verification and definition of done

```sh
pkill -f vite
pnpm typecheck         # first: vite build does not typecheck
pnpm build             # all three: the benchmark inlines the library CSS
pnpm check             # typecheck, Enfect lint, Prettier, 334 unit tests
pnpm bench             # 61 Playwright tests, ~5.0 min
```

M7 is done when, for each item taken:

- the code ships with the test on the rung that can see the claim (rung 1 for both pure
  functions, rung 3 + 5 for the overlay), and every proof is **watched failing** first;
- `docs/CONTRACT.md` and both READMEs say what a consumer can now do, and
  `packages/flow/CHANGELOG.md` gains the entry under `[Unreleased]`;
- the keep-out it closes is **edited** in `M6-RESEARCH.md` and `M6-FINDINGS.md` §4, with
  a link to the follow-up — a verdict changes when the code does;
- the gate is unchanged and re-run at the committing commit, and all four commands are
  green;
- `docs/M7-FINDINGS.md` records the numbers, the deviations and anything a review should
  look at first.

A new findings or research document goes into **both** `format` and `format:check` in the
root `package.json`. Handoffs are excluded, like the M4–M6 ones.

## Proposed `PLAN.md` §7 addition (not applied)

> **M7 — the closable keep-outs.** M6's research left seven rows out of scope and three
> of them are now closable without changing the architecture that rejected the rest:
> `canResize` as a pure veto in `Flow.Context` (which reverses the `shouldResize`
> keep-out), `Flow.compensateChildPositions` as a pure helper (the arithmetic upstream
> applies for you, returned to the consumer who can persist it), and an HTML overlay
> layer for edge controls (a layer with a paint-order proof, not a widened SVG label).
> Each is proved on the rung that can see it and each edits the M6 verdict it closes.
> `nodeOrigin`, multi-node resize, the culling index and `XYResizer` itself stay out.

## Open questions for M7

- **Does `canResize` need a per-node opt-out as well?** A node that declares
  `resizable: false` would be data, not policy — and `FlowNode` has no such field. Decide
  before adding one: the veto can express it for the whole graph, and data can express it
  per node.
- **Does the overlay need a `panel`-style helper, or a render hook?** `panel(...)` returns
  markup the consumer composes; an overlay has to be flow-anchored per item, which is a
  different shape. Pick one and write the reason down.
- **Does the overlay become the home of `renderEdgeLabel`'s interactive case**, or stay a
  parallel API? Two ways to put content on an edge is a documentation cost.
- **Does M7 ship as `0.2.0` with M6**, or does the release wait for the 10k startup work?
  Owner's call; the changelog's `[Unreleased]` section can hold both.
- **Does the gallery grow a fixture** for the overlay? It compares geometry, so probably
  not — M6 decided the same way for its three ships (`M6-FINDINGS.md` §7 item 4).

## Working agreements

- Do not re-litigate the locked decisions (§9 of the plan) and do not edit the plan
  wholesale; deviations and proposed diffs go into `docs/M7-FINDINGS.md`.
- Do not import `@xyflow/react` or `@xyflow/svelte` outside `packages/benchmark`.
- Do not copy upstream CSS or add an attribution component (§2.4).
- Commit at logical checkpoints; no force-push, no history rewrite, no amended commit
  from an earlier milestone.
- No npm publish, no push, and no network install beyond npm, without asking.
- Every claim in the findings document comes from a run at the commit that carries it.
