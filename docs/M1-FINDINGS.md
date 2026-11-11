# M1 findings

M1 implements the interaction core, measurement and handle bounds, culling, the
renderer node cache, and the `PLAN.md` §4.5 performance gate. `PLAN.md` was not
edited; where the code differs from the plan, this file records the diff and why.

Verification at the end of M1 (all read from a real run, not assumed):

| Check                                          | Result                                                      |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `pnpm check`                                   | typecheck, Enfect lint, Prettier, **75** Vitest tests green |
| `pnpm build`                                   | flow → example → benchmark                                  |
| `packages/benchmark/tests/proofs.spec.ts`      | 4 passed (M0 proofs, unchanged)                             |
| `packages/benchmark/tests/interaction.spec.ts` | 8 passed, 5.3 s (M1 proofs 8–15)                            |
| `packages/benchmark/tests/bench.spec.ts`       | 2 passed, ~1 m 35 s (625 comparison + 1k gate at 23 s)      |

## 1. Gate results

625 nodes / 624 edges, 10 runs per library, Brave 156 headless, unchanged
protocol from M0 (`packages/benchmark/results/benchmark.json`):

| Library | drag median | drag p95 | drag >50 ms | pan median | pan p95 | pan >50 ms |
| ------- | ----------- | -------- | ----------- | ---------- | ------- | ---------- |
| React   | 16.7        | 16.8     | 0           | 16.7       | 16.7    | 0          |
| Svelte  | 16.7        | 16.8     | 0           | 16.7       | 16.7    | 0          |
| Foldkit | 16.7        | 16.8     | 0           | 16.7       | 16.8    | 0          |

1k nodes, culling on, zoom 1 (`packages/benchmark/results/benchmark-1k.json`):
drag p95 16.8 ms, pan p95 16.7 ms, no frame over 50 ms. Gate was p95 < 33 ms.

Extra columns §4.5 asks for, both fixtures:

- **Per-dispatch fold cost**: 0.0023 ms (625) / 0.0032 ms (1k) per dispatch. This
  times `Flow.update` only — the parent's closure and config object are a few
  allocations below the timer's resolution. What the column proves is that
  reading the graph per dispatch is not a frame cost.
- **Culling scan**: 4.3 ms per call at 625 nodes, 11.3 ms at 1k (averaged over
  50 repetitions, sampled on the first viewport frame). This is the honest O(N)
  number §4.5 predicted: it is paid per _viewport_ frame, not per drag frame, so
  it does not appear in the p95s above. At 10k it is the first thing to fix.
- **Heap after 1,000-create/1,000-delete churn**: not recorded. It needs CDP heap
  sampling (or `--enable-precise-memory-info`), which the harness does not have.
  The cache is bounded by construction (the per-render sweep) and asserted in
  `src/view/cache.test.ts`; the number itself is deferred to M5.

## 2. Where the code differs from `PLAN.md`

### 2.1 §4.6 — propagation is by target inspection, not by stopping propagation

The plan says "Handle and nested-control propagation come from Foldkit attributes
(`h.OnPointerDown` with `EventPropagation.Stop`)". Foldkit's
`h.OnPointerDown(toMaybeMessage)` takes no options; only `h.OnClick` accepts
`ClickOptions.propagation`. So each handler decides from the event's `target`
whether the press is its own:

| Press target               | Handle handler      | Node handler                      | Pane handler              |
| -------------------------- | ------------------- | --------------------------------- | ------------------------- |
| Handle                     | `StartedConnection` | declines (`isHandleTarget`)       | declines                  |
| Node body                  | —                   | `PressedNode` (select + arm drag) | declines (`isNodeTarget`) |
| Control / `.fflow__nodrag` | —                   | declines (`blocksDrag`)           | declines                  |
| Empty pane                 | —                   | —                                 | `PressedPane` (clears)    |

The observed behaviour is exactly §4.6's table, but the mechanism is
`EventTarget.closest`, which also means it works without `preventDefault` and
survives a consumer stopping propagation itself.

**One bug this found.** The pane handler originally only declined handles and
controls, not nodes. Browsers bubble `pointerdown` from the node to the pane, so
a node press selected the node and then immediately cleared the selection. Scene
masked it (`pointerDown` runs only the nearest handler), the browser proof caught
it. `isNodeTarget` is the fix.

### 2.2 §4.6 — guards match the class _or_ the data attribute

Scene's `pointerDown` synthesises the event target from VNode **attributes**
(`attrs`), and snabbdom keeps `h.Class` output in `data.class`. A simulated
target therefore has `data-handleid`/`data-nodeid` but no class list. The guards
match either (`'.fflow__handle, [data-handleid]'`), so the handle/node/pane
cases are Scene-testable; `.fflow__nodrag` is class-only and is covered in
Playwright instead (`pointerDown('.node-button')` is covered in Scene because
`button` matches by tag).

### 2.3 §3.4 — `hitTestHandle` takes the graph

`Flow.hitTestHandle(model, point, context, options?)`, not `(model, point)`.
`HandleBounds.x/y` are **node-local**, which is what makes a node move not
invalidate its measured handle geometry — the reason §2.5.4's zoom invariance
works at all. Absolute flow-space bounds would go stale on every drag (nothing
re-measures a translate) or force a re-measure per drag frame. The graph is read
through `context` for the node origins, exactly like `update`; the Model stays
the owner of the interaction state.

### 2.4 §3.1 — `Gesture` has no `Selecting`

Pinning box-select would fight panning: `panOnDrag` is `true`, so a pane drag is
XYPanZoom's gesture, and a second `Selecting` gesture over the same drag would
need `selectionOnDrag` in the engine to arbitrate. `PressedPane` therefore clears
the selection unless additive, and starts nothing. Box selection is deferred to
M3 chrome, where it can take `selectionOnDrag` deliberately.

`ScrolledPane` is dropped for the same reason: d3 owns wheel, and `.fflow__nowheel`
is enforced through the engine's `noWheelClassName`.

### 2.5 §4.5 — culling is opt-in, and the cached VNode is narrower than planned

Two changes that pull in opposite directions:

1. **Culling is `RendererConfig.cull`, default `false`.** A node that leaves the
   viewport unmounts, and a remount re-measures. That is acceptable at 1k on a
   zoomed viewport (the gate) and wrong for the 625 parity fixture, which is
   compared against a React Flow page that does not use
   `onlyRenderVisibleElements`. So: 625 unculled, 1k culled, both stated.
2. **The node cache holds the consumer's markup, not the node wrapper.**
   Everything that changes per frame — the `translate(position + delta)` style,
   the selection/drag classes, and the pointer handler (which needs the viewport
   to convert screen → flow) — lives on the wrapper the renderer rebuilds every
   pass. Consequences: a drag frame invalidates **no** slot (not just the
   non-dragged ones), and a pan frame invalidates none either. `zeroDelta` is
   still what the wrapper reads, so the shape §4.5 describes is unchanged.
   `src/view/cache.test.ts` asserts both (two different deltas → no
   re-render), so this is measured, not asserted in prose.

### 2.6 §4.2 — one mutation is deliberately not geometry

`MountNode` observes `{ childList, attributes, subtree }` with no
`attributeFilter`, as specified. The one record it ignores is the node element's
**own** `style` attribute: that is the renderer's drag transform, and a node
translation cannot change node-local handle geometry. Without that rule a drag
would run `querySelectorAll` + `getBoundingClientRect` for every dragged node on
every frame. Handle-side attributes, child lists, and handle styles all still
trigger the frame-coalesced re-measure (proved by Playwright proof 11, which
mutates `data-handlepos` and watches `data-handle-measurements` rise).

**A bug this found.** `getHandleBounds` reads `data-handlepos` as a raw string,
while `adapter.fromUpstreamPosition` maps the engine's lowercase `Position`
values. The result was `position: undefined`, which made the `HandleBounds`
Schema constructor throw — once per node, on the very first measurement, so
every handle bound was silently lost while `MeasuredNode` still worked. The
measurement path now parses the attribute against our own literals
(case-insensitively, since an upstream-compatible consumer may write `left`) and
falls back by handle type. Proof: `data-handle-nodes` went from 0 to 1250.

### 2.7 §2.5.4 — the measurement scale comes from the element

`measureHandleBounds(element, nodeId)` derives the zoom as
`rect.width / offsetWidth` instead of reading `model.viewport.zoom`. A Mount's
args are captured at mount, so the node Mount has no reactive zoom, and reading
the host registry would have made measurement depend on mount ordering. Both
inputs scale with the transform, so the stored value is node-local and
scale-invariant either way — which is what §2.5.4 asks for, and what the "a
viewport change leaves measured bounds untouched" test pins.

### 2.8 §4.2 — `RemovedNodeMeasurement` is best-effort

It is offered from the Mount's release, but Foldkit interrupts the fiber on
unmount and discards later Messages, so the offer usually does not arrive. The
guarantee is elsewhere and already in the plan: `Flow.informGraphChanged` in the
parent's mutate step (§2.5.9) and the `missingNodeIds` prune in the
`MeasureHandles` checkpoint.

### 2.9 §4.5 — `MovedViewport` keeps the M0 split

Non-terminal frames write `model.viewport` and emit nothing; the terminal frame
also emits `ChangedViewport`. This is M0's behaviour (the demo's
`data-viewport-frames` counts the messages) and it is what makes culling follow a
pan.

## 3. Additions to the public surface

Beyond §3.3/§3.4:

- `Renderer.cacheSize()` — slots currently held. Instrumented in the demo stats
  and used by the cache tests; harmless in production and the only way to assert
  the sweep from outside.
- `geometry/bounds.ts` export: `nodeSizeOf`, `nodeRect`, `nodeBounds`,
  `fallbackSize` (151×40 as specified).
- `geometry/visible.ts`: `visibleRegion` exported so the overscan rule is
  testable on its own.
- `runtime/measure.ts`: `measureHandleBounds`, `nodeElementOf` — shared by
  `MountNode` and the `MeasureHandles` Command so both measure identically.
- `runtime/domTarget.ts`: `isEditableTarget`, `isDeleteKeyAllowed`, `blocksDrag`,
  `isHandleTarget`, `isNodeTarget`.
- `Flow.subscriptions`, `Flow.MeasureHandles`, `Flow.Remeasure`,
  `Flow.informGraphChanged`, `Flow.setViewport`, `Flow.zoomBy`,
  `Flow.selectAll`, `Flow.clearSelection`.
- `Pointer`, `HandleBounds`, `HandleRef`, `HandleType`, `Gesture` types; the
  `OutMessage` union in its own module.
- `RendererConfig.cull`.

## 4. Test coverage map

| Requirement (§6)                     | Where                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------- |
| drag math, one `MovedNodes`          | `src/state.test.ts` (`node drag`)                                      |
| foreign `pointerId` ignored          | `src/state.test.ts`, Playwright proof 9                                |
| `CancelledGesture` (3 reasons)       | `src/state.test.ts` (`cancellation`, `test.each`), Playwright proof 10 |
| additive node/pane selection         | `src/state.test.ts` (`selection`)                                      |
| delete + dead-id guard               | `src/state.test.ts` (`delete`)                                         |
| editable-target guard                | `src/runtime/domTarget.test.ts`                                        |
| `MergedHandleBounds` merge + prune   | `src/state.test.ts` (`handle bounds`)                                  |
| zoom leaves bounds alone             | `src/state.test.ts`                                                    |
| `informGraphChanged`                 | `src/state.test.ts` (`graph reconciliation`)                           |
| connection start/hover/complete      | `src/state.test.ts` (`connections`, incl. `Command.expectExact`)       |
| connection anchor follows handle id  | `src/geometry/geometry.test.ts`, `src/view/connection.test.ts`         |
| culling keeps dragged nodes/edges    | `src/view/culling.test.ts`, Playwright proof 15                        |
| additive press from the DOM          | Playwright proof 14, `src/state.test.ts` (modifier state)              |
| viewport commit                      | `src/state.test.ts` (`viewport`), M0 `update.test.ts`                  |
| screen/flow, culling, hit-testing    | `src/geometry/geometry.test.ts`                                        |
| cache hit/miss/sweep/dispose         | `src/view/cache.test.ts` (two passes inside one runtime frame)         |
| propagation (§4.6)                   | `src/view/propagation.test.ts` (Scene, jsdom)                          |
| pointer layer, remeasure, ShadowRoot | `tests/interaction.spec.ts` (Playwright proofs 8–15)                   |
| frame gate                           | `tests/bench.spec.ts`                                                  |

`jsdom` is a dev dependency solely for Scene: its `pointerDown` builds a detached
element tree so `closest` works, which needs `document`.

Note for test authors: handle elements carry `data-nodeid` too (the engine's
geometry contract), so node selectors must be scoped to `.fflow__node`.

## 5. What M1 deliberately does not do

- No connection-line geometry beyond a straight line from the source handle to
  the pointer/hovered target, and no edge endpoints from measured handles — both
  are M2, where `hitTestHandle` already has the bounds it needs.
- No box selection, no reconnect, no `isValidConnection` predicate in `Context`
  (M2). The predicate is a one-line addition to the `Connecting` release path.
- No fit-view control, minimap, background, or focus/keyboard navigation (M3).
- Heap-after-churn is not measured (§1).

## 6. Response to `docs/M1-REVIEW.md`

Three findings, all addressed in code with tests that fail without the fix.

### 6.1 High — connection preview ignored the selected handle id

Correct, and it was two sites, not one. The renderer's preview anchor compared
`nodeId` + `type` only, and `update`'s connection-start anchor compared
`nodeId` + `handleId` while dropping `type` — either way the identity was
incomplete the moment a node declared two handles of the same kind.

Fix: `geometry/handles.ts` owns the one comparison —
`isSameHandle(ref, bounds)` = `nodeId` + `type` + `handleId`, with
`Option.getOrUndefined` on both sides so an unset id matches an unset measured
id. `findHandle` and `handleCenter` are built on it, and both `update`
(`StartedConnection`'s start point) and the renderer (preview anchor) now call
`handleCenter` instead of carrying their own `find`.

Tests:

- `src/geometry/geometry.test.ts` → `handle identity`: two same-type handles,
  identity comparison, unset-id matching, `findHandle`/`handleCenter` on the
  requested handle, missing handle → `None`.
- `src/view/connection.test.ts` → renders a real `Connecting` gesture through
  the renderer and asserts the emitted `d` string: `handleId: "out-b"` anchors at
  `M204,70`, `"out-a"` at `M104,70`. Without the fix both render `M104,70`.

### 6.2 Medium — culling could remove a node during a drag

Accepted as a defect, not a documented gap. The rendered node set is now
`visible ∪ dragged` (and edges are kept when either endpoint is dragged), so a
node cannot disappear from under the pointer that owns the gesture. See §2.5
item 3.

The review's suggested browser test ("drag past the overscan, assert it stays
rendered") cannot fail on the current demo: the demo only applies `MovedNodes` on
release, so the _graph_ position — the only input to culling — never leaves the
region during the gesture. I wrote that proof, watched it pass with the fix
reverted, and moved the invariant to `src/view/culling.test.ts`, where it does
have teeth:

- `renders the viewport plus one screen of overscan` (control)
- `a dragged node stays rendered while its graph position is outside` — fails
  with the union removed
- `an idle node outside the region stays culled` (so the union is not a blanket
  "render everything")
- `an edge carried by a dragged node is rendered with it` — fails with the
  edge half removed

`tests/interaction.spec.ts` proof 15 keeps the end-to-end half: culling is
active (`165` of `625` nodes rendered at 900×600/0.9), the node keeps its element
and its overlay transform through a drag that pushes the pointer 6,000 px past
the pane.

### 6.3 Medium — additive selection was unreachable from the pointer layer

The review offered two resolutions. The first is not possible as stated:
Foldkit's `h.OnPointerDown` callback receives `(pointerType, button, screenX,
screenY, timeStamp, clientX, clientY, pointerId, target)` — `KeyboardModifiers`
is extracted from `KeyboardEvent` only, so a pointer press carries no modifier
state and there is nothing to read.

Resolved the other way, by making it reachable:

- `Message.ChangedModifierState({ isAdditive })` + `model.isAdditiveModifier`.
- A `modifierKeys` subscription on the pane root maps Shift/Meta/Control
  `keydown`/`keyup` to that Message, using the event's own flags (which already
  reflect the state after the key change, so releasing one of two held modifiers
  is correct), plus a `window` `blur` reset so an alt-tab that swallows the
  `keyup` cannot leave every later press additive.
- The renderer stamps `isAdditive: model.isAdditiveModifier` onto `PressedNode`
  and `PressedPane`, so §4.6's additive semantics now work from a real browser
  press with no consumer plumbing.

Tests: `src/state.test.ts` → `the additive modifier is tracked in the Model`
(set and clear); `tests/interaction.spec.ts` proof 14 → click `n0`, hold Shift,
click `n1` (`data-selected-nodes` becomes `n0,n1`), release Shift, click `n2`
(selection becomes `n2`). The demo exposes `data-additive` so the proof waits on
the state instead of racing the key event.

### 6.4 Harness — why the suite felt slow, and the fix

Not rendering: `page.waitForFunction` has **no default timeout** in Playwright (it
inherits the 600 s test budget), so one assertion that never becomes true hangs
for ten minutes instead of failing. Two of my own M1 proofs did exactly that
(`data-handlepos` measurement and the ShadowRoot pane), which is what made runs
feel unbounded.

Every `waitForFunction` in `proofs.spec.ts` and `interaction.spec.ts` now passes
an explicit `WAIT = { timeout: 15_000 }`, and the heavy-page `waitForSelector`
calls use 20 s. The suite's cost is now dominated by what it actually does: 33
cold page loads of the 625-node fixture (11 per library, warm-up discarded) plus
11 of the 1k fixture, which is the §4.5 protocol.

The browser suite is 14 tests in 1 m 41 s: 12 proof tests — 4 M0
(`proofs.spec.ts`: proofs 2, 3, 3b, 4) plus 8 M1 (`interaction.spec.ts`: proofs
8–15) — and 2 gate tests (`bench.spec.ts`: the 625 comparison and the 1k culled
gate). Vitest adds 88 more, including the render-level cases Playwright cannot
reach (`view/connection.test.ts`, `view/culling.test.ts`, `view/cache.test.ts`).

## 7. Response to `docs/M1-REVIEW-2.md`

No functional finding. The one Low item — stale coverage counts in this document
— is fixed: the coverage table names proofs 8–15, the verification table reports
8 interaction tests, and §6.4 now decomposes the 14-test browser suite into its
12 proof tests (4 M0 + 8 M1) and 2 gate tests instead of quoting a bare total, so
the counts cannot drift from the suite again. Every number in this document is
from a run of the code at the commit that carries it.
