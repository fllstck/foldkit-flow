# Test strategy: the ladder, and where each claim lives

Written after the M5 reports, because two of them were bugs that a green suite
could not see. It is a map of the rungs this repo tests on, the rule for choosing
one, and an audit of the browser suite against it. It is not a coverage target: the
point is to put a claim on the cheapest rung that can still observe it.

## The ladder

Ordered by how much of the browser is real. Pick the **lowest rung that can see the
thing**; the kind of bug decides the rung, not what is convenient to write.

| #   | Rung             | What is real                                | What it can see                                                                                                                                               | What it cannot                                                                                                                                                                          | Where                                                                                                  |
| --- | ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | **Pure**         | nothing                                     | geometry, indices, memos, path building, `fitViewport`, `resizeRect`, `visibleNodes`, guards on event targets (`domTarget.ts`)                                | Messages, the view, the engine                                                                                                                                                          | `geometry/*.test.ts`, `view/description.test.ts`, `runtime/domTarget.test.ts`, `runtime/nudge.test.ts` |
| 2   | **Story**        | `update` + Model                            | fold semantics, OutMessages, which Commands are emitted, gesture sequences over _seeded_ measurements                                                         | the view, the DOM, Mounts                                                                                                                                                               | `state.test.ts`, `update.test.ts`, `runtime/command.test.ts`                                           |
| 3   | **Scene**        | `update` + the real view in jsdom           | which element dispatches which Message, `Scene.expectIgnored`, aria/roles, chrome's presence and wiring, that a control press reaches the engine as a Command | anything geometric: jsdom has **no layout**, so rects are 0×0 — the fit, culling, hit-testing a measured handle and the minimap's mapping are all invisible. Also: what a Mount _emits_ | `view/propagation.test.ts`, `view/chrome.scene.test.ts`                                                |
| 4   | **Mount stream** | one Mount's own `Stream`, in jsdom          | the messages a Mount really emits and their order                                                                                                             | anything after the first emission needs stubs; nothing geometric                                                                                                                        | `runtime/mountPane.test.ts`                                                                            |
| 5   | **Playwright**   | everything: layout, paint, d3, frame timing | screen geometry, pixels, the engine's viewport, frame distributions, SSR/hydration, cross-library comparison                                                  | which handler caused what; it sees outcomes only                                                                                                                                        | `packages/benchmark/tests/*.spec.ts` (56 tests, ~4.9 min)                                              |

Two traps worth naming, because both cost a bug:

- **Scene fabricates Mount messages.** `Scene.Mount.resolve(Definition, message)`
  proves the _view wires the right Mount_; it can never prove what the Mount
  emits. Rung 4 exists for that, and the pan-jump (`M5-FINDINGS` §8.2) lived
  exactly there.
- **Scene bypasses subscriptions.** `Scene.Subscription.emit` feeds a Message
  straight into `update`, so a _guard inside a subscription_ is not exercised.
  That is why those guards are pure functions in `runtime/domTarget.ts` (rung 1)
  and the subscription only calls them.

## The rule

1. **A claim lives on the lowest rung that can see it.** If it needs no layout, it
   does not belong in Playwright.
2. **One rung per claim, chosen deliberately.** A claim duplicated at Story and
   Playwright adds two places to update, not coverage. When two rungs are needed,
   they are two _claims_ and the test names say which ("the view emits
   `SyncViewport` for a fit" vs "a pan after the fit keeps the zoom").
3. **Never assert what the test injected.** `Mount.resolve(MeasuredNode, …)` and
   then asserting the box is the fabricator talking.
4. **Sequences over snapshots.** Both M5 reports lived _between_ two interactions
   (fit → pan, collapse → look). Every rung should hold at least one two-step
   test.
5. **Name the layer in the test**, as `docs/verification.md` asks for visual
   features: "the pane Mount emits `MountedPane` first" (rung 4) and "a pan after
   the fit keeps the zoom" (rung 5) are different claims.

## Response to `docs/TEST-STRATEGY-REVIEW.md`

The review's conclusion — that the visual tests should stay where they are and the
gaps are _below_ the browser — matched what this document set out to do, and its
four findings were real. What changed:

### Fixed: the connection policy answered about a graph that no longer existed

Accepted. `isValidConnection` closed over the spec's **declared** edges, so after
`c → d` was accepted, `d → c` was accepted too and built a two-cycle. Confirmed on
the served page before touching anything (three edges, `c → d` → four, `d → c` →
**five**), then fixed at the seam the review named: the policy now receives the
**current** parent graph — `isValidConnection(connection, edges)` in `spec.ts`, and
the harness passes `model.graph.edges` on every release. `canReach` takes the edge
list as a parameter instead of closing over it.

The review's four cases are now rung-1 tests
(`src/examples/specs/connection-policy.test.ts`, 5 tests): rejection through a path
(`c → a`), acceptance of a legal edge (`c → d`), **rejection of the cycle a previous
acceptance created** (`d → c` after `c → d` — the case that was broken), and
self-loops, plus termination on an already-cyclic graph. The browser proof keeps
the real handle drags, and gained the `c → d` acceptance so the refusals cannot pass
for a predicate that refuses everything.

### Done: the example package has a test runner

`packages/example` had no tests at all — four minutes of browser time was the only
way to ask what its code did. It now has `vitest` (a workspace devDependency, no new
download), `src/routes.test.ts` (rung 1: the index with and without a slash, a slug
with and without a slash, an unknown slug, `pipeline` vs `demo`, and
`prerenderPathsFor` including "no duplicates") and
`src/examples/registry.test.ts` (rung 1: unique slugs, non-empty titles and
descriptions, every entry carrying its own source, the categories grouping the whole
set, lookup total for known slugs). The browser proof keeps the claim only it can
make: every generated route serves, hydrates and renders.

### Done: the harness's own transitions are Story tests

`src/examples/harness.test.ts`, 7 tests, ~5 ms: `MovedNodes` moves that node and no
other; `ConnectedHandles` appends the edge; `ResizedNodes` persists the box;
`DeletedElements` removes the node and keeps the edge whose other end survived (the
parent's rule, matching `shownEdges`); collapse toggles `hidden` both ways; nothing
fits before the pane is measured; a later `ResizedPane` emits nothing and does not
yank the view back.

Two harness limits came out of writing them, both now recorded at the call sites:

- **A `Command.mapMessages`-wrapped Command cannot be resolved in Story.** Story
  validates a resolved result against the _Definition's_ message schemas, so there
  is no message that is both this app's `Message` and `SyncViewport`'s — the
  positive "the first `ResizedPane` fits and the fit reaches the engine" claim
  therefore stays where it already was, one rung up (`chrome.scene.test.ts`) and one
  rung up again (`example.spec.ts`). What Story _can_ pin, and now does, is the two
  negatives around it.
- **A Story fixture without a `paneId` reproduces the pan-jump trap.** The first
  version of the fit test seeded no pane id and the harness emitted no
  `SyncViewport` — which is exactly the M5 report, in a test. Worth knowing before
  someone "simplifies" that fixture.

### Moved: the 10k timing assertion left the unit suite

Accepted, and replaced rather than deleted. The wall clock became a **read count**:
the measurements array is wrapped in a `Proxy` that counts indexed reads, so a scan
that reads each measurement once is bounded (`> 9 000` and `< 20 000` reads for a
10 000-node fixture) while a linear lookup per node is not — against the pre-M5 code
the same test reports **50 005 000** reads. A second test asserts a _viewport_
change costs **zero** reads, i.e. the memo is keyed on the array's reference. No
clock, no flakiness, same claim.

The performance side of it moved to the rung where the machine and the protocol are
explicit: both 1k gate legs now assert `cullScanMs < 3` — ~4x the 0.6–0.7 ms measured
there and half the 6.0 ms the linear lookup cost.

### Accepted, not done (with reasons)

- **MountNode stream tests** (review finding 4, medium): the rung-4 machinery exists
  (`runtime/mountPane.test.ts`), but `MountNode` needs a `ResizeObserver`, a
  `MutationObserver` _and_ a rAF coalescer in jsdom; worth doing, and worth doing
  with the same "does the guard hold" framing rather than as a second spike.
- **Pane-host lifecycle** (5): `host.ts` is a registry of four functions with
  identity semantics; a rung-1 test would be cheap, but nothing has ever asked the
  registry a question it got wrong, so it is queued behind the above.
- **Renderer disposal and memo lifecycle** (6): partly covered already —
  `view/cache.test.ts` has "a disposed renderer is back to its initial state, then
  repopulates" and "drops the chrome memos as well as the node slots" (M4 §15).
- **Property-style graph tests** (7): the deterministic cases in
  `positions.test.ts`, `hidden.test.ts` and `fit.test.ts` cover ordering, cycles,
  missing parents and closure already; a generator would add cases, not a class.
- **An axe pass** (8): valuable, and it needs a dependency install; noted for M6
  rather than smuggled into a test-only change.
- **A package-consumption smoke test** (9): **done with the first release.**
  `0.1.0` was fetched back from the registry, its tarball checked for every entry
  `files`/`exports` promises, installed into an empty project with its two peers,
  imported (79 exports), and `fitViewport` called through the published bundle
  (`M5-FINDINGS` §13). It lives in the release checklist rather than in the suite,
  because it needs the registry.

### Second pass

`docs/TEST-STRATEGY-REVIEW-2.md` re-checked the work and found no correctness
findings: the policy fix, the rung-1 route and registry tests, the harness Story
tests, the read-count replacement and the moved culling threshold all landed as
described, and it confirms that the remaining items are _deferred_ rather than
claimed. Nothing changed in response — the deferred list below stands as written.

### What the review got right about scope

"We should not broadly move the browser tests downward" is the conclusion this
document reached too, and the review's per-test assessment matches the audit table:
the rung-5 tests are redundant in _logic_ and not in _wiring_. Worth stating plainly,
because the temptation after a report like this is to delete proofs and save
minutes.

## Where M5's own bugs sat

| Report                                                | Lowest rung that can see it                                | Where it was asserted                                                  | Outcome                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A pan after the opening fit jumped and shrank         | 4 (Mount order) **and** 3 (a fit must emit `SyncViewport`) | 5, as a DOM matrix — green, because the DOM is rendered from the Model | rung 3 (`chrome.scene.test.ts`) + rung 4 (`mountPane.test.ts`) + the existing rung-5 proof |
| The `connection-policy` example waved a cycle through | 2 (the policy is a pure function)                          | 5, mounting only                                                       | rung 5 gesture assertions, both directions                                                 |
| Collapsing a container lost the container             | nothing below 5 — it is a judgement about a UI             | 5, and the assertion encoded the wrong assumption                      | the page changed; the affordance half is now covered                                       |
| The churn spec measured a quarter of the loop         | no rung helps; it was a harness wait                       | —                                                                      | loop counter, recorded in `M5-FINDINGS` §3.1                                               |
| An edge painted nothing (M3)                          | 5                                                          | 5, after the report                                                    | `verification.md`                                                                          |

## Audit: what the 56 browser tests add over the rungs below

Read file by file. **No proof should be deleted** — each has a wiring half that
only a browser proves (a real pointer stream, a real focus ring, a real
`ResizeObserver`, a real d3 gesture). What the audit found is the opposite of
duplication: the _logic_ halves were already covered below, so the rung-5 cost was
being paid for the wiring alone, and the rungs in between were empty.

| Proof(s)                              | Claim                                                                                                | Also covered below                                                                                                     | Rung 5's own contribution                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 9, 10, 14                             | foreign pointerId, pointercancel, additive presses                                                   | rung 2: `state.test.ts` same-named cases                                                                               | the document-level subscription delivers a real second pointer / cancel / modifier |
| 23                                    | zoom controls move the viewport, and stop at the bound                                               | rung 2: "zoom in stops at the Model's maxZoom, with no Command to run"; **new** rung 3: the press emits `SyncViewport` | the engine's transform is the one that moved                                       |
| 27, 28                                | arrow keys nudge; an input or `fflow__nokey` does not                                                | rung 1: `domTarget.test.ts` guards, `nudge.test.ts` steps; rung 2: nudge facts                                         | focus and the document key subscription                                            |
| 31                                    | Enter/Space activate the focused node                                                                | rung 2: activation semantics                                                                                           | focusability and the key subscription                                              |
| 33, 18                                | a rejected connection leaves the graph alone; a novel one lands                                      | rung 2: "an invalid connection is rejected"                                                                            | the demo's own feedback rendering                                                  |
| 39                                    | collapsing removes the subtree and its measurement                                                   | rung 1: `hidden.test.ts`; rung 2: `informGraphChanged` prunes                                                          | the renderer's filtering of a live page                                            |
| 40, 45                                | a snapped drag / resize lands on a multiple                                                          | rung 1: `resize.test.ts`; rung 2: snap cases                                                                           | snapping under a real pointer stream                                               |
| 46                                    | a minimap press centres the view on the point under it                                               | rung 2: centring math                                                                                                  | the screen → flow mapping, which needs real layout                                 |
| 25                                    | a control press neither pans nor clears the selection                                                | **new** rung 3: `pointerDown` on a control is declined by the pane handler                                             | d3's filter, i.e. that it did not pan                                              |
| 41                                    | the fit button uses the configured padding and clamp                                                 | rung 2: fit + clamp                                                                                                    | the layout the clamp is computed against                                           |
| 22, 26, 29, 29b, 30, 32, 34–37, 42–44 | paint, z-order, overlays, the description's DOM, markers, labels, text selection                     | — (rung 1 covers the text content of the description)                                                                  | everything visual: these are the proofs `verification.md` exists for               |
| 2, 3, 3b, 4, 11, 12, 13, 15, 16, 38   | Mounts surviving re-renders, the engine's state, SSR/hydration, ShadowRoot, culling, nested controls | rung 2/3 for the Message halves                                                                                        | the engine, hydration and the real DOM                                             |

The four additions this audit produced are the empty rungs, not more rung 5:

- `view/chrome.scene.test.ts` (rung 3): a zoom press and a fit press each emit
  `SyncViewport` — so the engine is told, not just the Model; a press on a control
  is declined by the pane handler; the controls carry their accessible names.
- `runtime/mountPane.test.ts` (rung 4): `MountedPane` arrives before the first
  `ResizedPane`, and the pane rect carries the element's box. **Watched failing**:
  with the two `Queue.offerUnsafe` calls reversed, both tests fail with
  `expected 'ResizedPane' to be 'MountedPane'`.
- `state.test.ts` (rung 2), three sequences: a second drag emits its own fact and
  not the first one again; a cancelled drag leaves nothing behind; a drag straight
  after a connection is a drag and emits no connection.

## What to do next, and what not to

- **Next:** the same audit for the M4 graph features — `proof 38` (a child drawn in
  its parent) has a large pure half in `positionIndex` and a small rung-5 half, and
  the 10k explorations should stay rung 5 because they are about frames.
- **Not:** deleting proofs to save seconds. 4.9 minutes for 56 tests is the price
  of the layer only a browser can see, and the whole point of the audit is that the
  rung-5 tests are _redundant in logic but not in wiring_.
- **Not:** moving paint or geometry down. jsdom's 0×0 rects make a green test there
  meaningless — the exact trap `verification.md` is about, one layer further in.
