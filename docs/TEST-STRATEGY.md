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
| 5   | **Playwright**   | everything: layout, paint, d3, frame timing | screen geometry, pixels, the engine's viewport, frame distributions, SSR/hydration, cross-library comparison                                                  | which handler caused what; it sees outcomes only                                                                                                                                        | `packages/benchmark/tests/*.spec.ts` (56 tests, ~4.8 min)                                              |

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
- **Not:** deleting proofs to save seconds. 4.8 minutes for 56 tests is the price
  of the layer only a browser can see, and the whole point of the audit is that the
  rung-5 tests are _redundant in logic but not in wiring_.
- **Not:** moving paint or geometry down. jsdom's 0×0 rects make a green test there
  meaningless — the exact trap `verification.md` is about, one layer further in.
