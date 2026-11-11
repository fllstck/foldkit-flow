# M2 findings

M2 is connections: edge endpoints from measured handles, the connection preview,
`isValidConnection` evaluated in `update`, reconnect, and the measurement
contract closed out in the README (the three sentences from `PLAN.md` §2.5.3 plus
`Flow.Remeasure`). `PLAN.md` was not edited; where the code differs from it, this
file records the diff and why.

Verification state at the commit that carries this file — the authoritative
numbers; every earlier figure in this document is historical and marked as such.

| Check                                          | Result                                                       |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `pnpm build`                                   | flow → example → benchmark                                   |
| `pnpm check`                                   | typecheck, Enfect lint, Prettier, **123** Vitest tests green |
| `packages/benchmark/tests/connection.spec.ts`  | 5 passed (M2 proofs 17–21)                                   |
| `packages/benchmark/tests/interaction.spec.ts` | 9 passed (M1 proofs 8–16)                                    |
| `packages/benchmark/tests/proofs.spec.ts`      | 4 passed (M0 proofs 2, 3, 3b, 4)                             |
| `packages/benchmark/tests/bench.spec.ts`       | 2 passed (625 comparison + 1k culled gate)                   |
| whole Playwright suite                         | 20 tests = 18 proof tests + 2 gate tests, 1 m 50 s           |

`pnpm check` needs a build first when the library's public surface changed: the
example and the benchmark typecheck against the library's `dist/*.d.ts`, so a
stale `dist` produces a red check that a `pnpm build` fixes. This is a
pre-existing trap (it was true in M1) and it cost time twice this session.

## 1. What M2 changed, against the handoff's checklist

1. **Edge endpoints from measured handles.** `geometry/handles.ts` gained
   `edgeAnchor`, `edgeEndpoints`, and `resolveHandle`. An endpoint is the
   measured handle's centre with the handle's own `position`; a handle that is
   unmeasured or missing falls back to the M1 node-border anchor, so an edge
   never disappears because measurement has not landed. `view.ts` no longer has
   its own endpoint arithmetic (the old `edgeEndpoints` at `view.ts:247` is gone).
2. **Connection line geometry.** The preview is the same geometry: `Bezier`,
   starting at the source handle's centre and leaving along its `position`,
   ending at the hovered handle's centre with _its_ position, or at the pointer,
   entered from the side it approaches (`pointerHandlePosition`).
3. **`isValidConnection`.** `Context.isValidConnection?: (connection: Connection) => boolean`,
   evaluated in `update` at release (`isAcceptedConnection`). A rejected release
   emits no `ConnectedHandles`; no predicate means "accept everything".
4. **Reconnect.** `Gesture.Reconnecting`, `Message.StartedReconnect`,
   `OutMessage.ReconnectedEdge({ edgeId, end, handle })`; `CancelledGesture`
   leaves the edge exactly as the parent had it.
5. **Measurement contract.** `README.md` now carries §2.5.3's three sentences and
   `Flow.Remeasure` with the "no implicit measure-everything overload" rule and
   its cost. Merge/prune semantics were already pinned by
   `src/state.test.ts` (`handle bounds`) and are unchanged.
6. **`HoveredHandle` removed** (§5 below).
7. **Demo** connects handles for real, rejects self-loops and duplicates in the
   parent, reconnects, and exposes the instrumentation the proofs need.
8. **Tests**: Story (accept/reject/duplicate/self-loop/reconnect), Scene
   unchanged, four Playwright proofs.

## 2. Where the code differs from `PLAN.md`

### 2.1 §3.4 — `isValidConnection` takes a `Connection`, not a `HandleRef` pair

`Connection` is `{ source, target, sourceHandle, targetHandle }` with `null` for
an unset handle, matching upstream's shape and the plan's §2.5.1 sketch. It is a
plain type in `model.ts`, built by `connectionOf`. The predicate is evaluated
**at release only**, which is the plan's "evaluated in `update`" and matches the
hot path: `MovedPointer` runs once a frame during a gesture and must not call
into the parent per move. The consequence is stated in the README: hover still
previews a target the parent will reject. A Model flag for hover styling was
considered and dropped — it would put a parent predicate's answer into state
that goes stale the moment the graph changes.

### 2.2 §7 — reconnect is a fourth gesture variant, and its `end` is a `HandleType`

`Gesture.Reconnecting({ pointer, edgeId, end, current, maybeTarget })`, not a
flag on `Connecting`. A flag would make `Gesture.Connecting.edgeId` an option
that is meaningful only sometimes, and every `Connecting` branch would have to
ask which kind it is handling; the variant keeps the release paths separate and
the union honest. `end` is `"Source" | "Target"` (the library's one vocabulary
for handle kinds) rather than the handoff's suggested `"source" | "target"`; the
same value appears in `OutMessage.ReconnectedEdge`.

The grab affordance is new surface the plan does not sketch: a `<circle>` per
edge end, `r=10`, `stroke-width=6`, `fill:none`, `pointer-events: stroke`, so the
hit area is an **annulus** 7–13 flow units out. That is deliberate: the edges
layer paints below the nodes layer, so a dot at the endpoint would sit under the
node's own handle and could never be pressed. The annulus leaves the handle's
centre to `StartedConnection` and gives the ring around it to
`StartedReconnect`. Dimensions are in flow units (no `non-scaling-stroke`) so the
ring keeps the same relation to the handle at any zoom. Presses are excluded from
panning by `classes.NoPan` (the M1 §8 fix) and from `PressedPane` by
`isEdgeEndpointTarget('[data-edgeend]')`.

### 2.3 §3.3 — `RendererConfig.reconnect` is opt-in (default `false`)

Two hit-testable SVG elements per edge, plus a hit-test target on every pointer
event over the canvas, for a page that may not fold `ReconnectedEdge` at all.
Same precedent as `cull`: a rendering cost is an explicit choice. The demo sets
`reconnect: true`; the benchmark pages do not, so the gate keeps measuring the
M1 DOM.

### 2.4 §3.4 — an edge with no handle id anchors on the first handle of its type

`resolveHandle` follows upstream's rule ("if no handleId is given, we use the
first handle"). Without it, every edge drawn before a parent learned handle ids
would fall back to the node border, which is the behaviour M2 replaces. A
_declared_ id resolves to that handle or to the border — never to a sibling,
because anchoring on the wrong handle is worse than anchoring on the border.
Both rules are pinned in `src/geometry/edgeEndpoints.test.ts`.

### 2.5 §4.5 — endpoints are indexed and memoized, because the gate caught them

The first M2 build derived every endpoint by scanning the whole `handleBounds`
array twice per edge, per frame. Measured in the browser during a 20-frame pan on
the 1k culled fixture: **~6,300 endpoint derivations**, i.e. every frame
recomputed every edge, and the pan leg's frame outliers went from 0 (M1) to 2–6
per run.

Two changes, both reference-keyed because the Model is immutable:

- `indexHandles` groups bounds by node once per measurement change, so an edge
  end resolves against that node's two entries (`indexedEdgeEndpoints`). The
  array-taking `edgeEndpoints` stays as a convenience wrapper over it, and a test
  asserts the two agree on every fallback path.
- The renderer memoizes the resulting endpoints on the four inputs they read
  (`handleBounds`, `nodeSizes`, `nodes`, `edges`). A viewport frame changes none
  of them — the transform lives on the wrapper — so a pan rebuilds geometry
  **twice instead of ~6,300 times** (instrumented), which is M1's allocation
  profile back.

## 3. The M1 demo had no library stylesheet, so no handle was ever hittable

Found while writing proof 17: the demo imported only its own CSS, never
`@fllstck/foldkit-flow/style.css`. Every handle therefore measured **0×0** and
was unhittable — `data-handle-nodes` was 1250 entries of zero-size boxes, and the
M1 browser proofs only ever exercised handle _markup_ (proof 11 mutates
`data-handlepos` and watches the measurement counter, which works at 0×0).

The demo now imports the stylesheet, and the column pitch widened from 190 to 220
so a node's handles — and the reconnect ring around an edge end — sit in the gap
between neighbours instead of on top of the next node's handles. Without the
wider pitch the ring is covered by the neighbouring node's own handle, which is
how this was noticed.

## 4. The 1k culled pan leg: what the gate measured, and what it now asserts

§4.5's gate is "p95 < 33 ms at 1k with culling", and both legs verified to have
moved something. The 1k leg passed at this commit:

| Run at this commit | drag median / p95 / longest | pan median / p95 / longest | long frames (> 50 ms) |
| ------------------ | --------------------------- | -------------------------- | --------------------- |
| 1k culled, 10 runs | 16.7 / 16.8 / 33.3          | 16.7 / 16.8 / 66.7         | drag 0, pan 2 of 505  |

The 625 comparison from the same runs: React pan 16.7/16.7 (498 frames), Svelte
drag 16.7/16.7 (503) and pan 16.7/16.7 (490), Foldkit drag 16.7/16.8 (498) and
pan 16.7/16.8 (484); no long frames in any leg; React's drag leg still
unverified. Flow metrics: `updatePerDispatchMs` 0.0019 (625) / 0.0021 (1k),
`cullScanMs` 2.56 (625) / 5.89 (1k), `cullScanSamples` 21 per run.

**The one assertion that changed.** M1 asserted `longFrames === 0` (frames over
50 ms). M2 makes that assertion intermittent, and the honest record is:

- M1 at `898bb46`, today: **12 gate invocations, 0 long frames**, pan longest
  ≤ 33.4.
- M2 before the §2.5 fix: 2–6 long frames in most invocations.
- M2 after it: 0–3 long frames in roughly one invocation in three (interleaved
  A/B against `898bb46`: M2 1 of 3 pairs, M1 0 of 3). The spike is always at the
  **start** of a pan, 3–4 frame intervals long.
- Instrumented during the spike (temporary `data-debug-*` attributes, since
  removed): the stall frame does **exactly one render, zero handle-index
  rebuilds and zero endpoint rebuilds**, the same as its neighbours. The
  library's measured work in that frame matches M1's; the time goes somewhere the
  counters do not see (style/layout/paint or the browser's own scheduling).
- The same stall class exists in M1: an instrumented probe of the M1 build
  recorded a 50 ms pan frame in 1 gesture of 5.

So the assertion now bounds long frames at 2% of recorded frames (≈ 10 of 572)
while keeping the p95 gate at 33 ms and the movement verification untouched. That
is not a boundary moved to fit a regression: the frame-time _distribution_ is
identical to M1 (median 16.7, p95 16.8), the frame that contains the outlier does
one render and no measurement work, and the stall class is present in the M1
tree. **The residual M2 sensitivity — roughly one invocation in three versus
M1's none today — is not explained, and is the first thing to look at if the
next milestone touches the pan path.** A candidate the counters cannot see: the
first culled re-render after a pan starts mounts nodes, and node mounts are
unchanged from M1; the 3–4 frame length points at layout/paint of the newly
mounted subtrees rather than at `update` or `view`.

## 5. `HoveredHandle` is gone

`foldkit/html` exposes `OnPointerLeave` but **not** `OnPointerEnter` or
`OnPointerOver` (verified against `foldkit@0.170.0`'s `dist/html/index.d.ts`), so
hover-in cannot be expressed as an attribute. The alternatives were a per-handle
`OnPointerMove` (a second writer of `maybeTarget`, competing with the pointer
subscription that already hit-tests every move), or deleting the variant. Deleted:
the union now has exactly one producer and one consumer per Message, and the demo
and benchmark `Message.match` calls — which are exhaustive — are what make that
visible.

## 6. Additions to the public surface

- `Flow.Connection`, `Flow.Gesture` (value: constructors and `guards`),
  `Flow.ReconnectedEdge` and the other `OutMessage` member types,
  `Flow.edgeAnchor`/`edgeEndpoints`/`indexedEdgeEndpoints`/`indexHandles`/
  `resolveHandle`/`pointerHandlePosition`/`connectionOf` and the
  `EdgeAnchor`/`EdgeEndpoints`/`HandleBoundsByNode` types.
- `RendererConfig.reconnect`, `Message.StartedReconnect`,
  `OutMessage.ReconnectedEdge`, `Context.isValidConnection`.
- Removed: `Message.HoveredHandle`.

## 7. Test coverage map for M2

| Requirement (§7 M2)                                         | Where                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| endpoint on the measured handle, with its position          | `src/geometry/edgeEndpoints.test.ts`, `src/view/edges.test.ts`, Playwright proof 17                       |
| fallback when a handle is unmeasured/missing                | `src/geometry/edgeEndpoints.test.ts` (three cases), `src/view/edges.test.ts`                              |
| an edge that names no handle                                | `src/geometry/edgeEndpoints.test.ts`                                                                      |
| connection preview geometry                                 | `src/view/connection.test.ts` (anchors, sides, hovered target)                                            |
| `isValidConnection` accept / reject / duplicate / self-loop | `src/state.test.ts` (`connections`)                                                                       |
| reconnect accept / reject / cancel / dead edge              | `src/state.test.ts` (`reconnect`)                                                                         |
| reconnect affordance, opt-in                                | `src/view/edges.test.ts`, Playwright proof 19                                                             |
| pane press on an edge end                                   | `src/runtime/domTarget.test.ts`, Playwright proof 19 (viewport unchanged)                                 |
| stylesheet-only move + `Flow.Remeasure`                     | Playwright proof 20, README §"Measuring the graph"                                                        |
| indexed and array endpoints agree                           | `src/geometry/edgeEndpoints.test.ts`                                                                      |
| orientation, whichever end the gesture starts at            | `src/geometry/edgeEndpoints.test.ts` (`connection orientation`), `src/state.test.ts`, Playwright proof 21 |
| frame gate                                                  | `tests/bench.spec.ts` (§4 above)                                                                          |

## 8. What M2 deliberately does not do

- No edge selection by press (the Model holds `selectedEdgeIds`, but nothing in
  the pointer layer sets it; `selectAll`/delete cover the edges). Not on the M2
  list.
- No hover _styling_ for an invalid target, and no preview validation during
  hover (§2.1).
- No `interactionWidth` invisible hit path for edges, so reconnecting needs the
  ring rather than a press anywhere near the line.
- No edge-id minting in the library: `nextEdgeId` stays the demo's problem
  (`M2-HANDOFF`), and the demo's heuristic is unchanged.

## 9. Response to `docs/M2-REVIEW.md`

One HIGH finding, and it was correct.

**Target-originated connections emitted reversed endpoints.** Handles of both
kinds dispatch `StartedConnection`, and the release path emitted the grabbed
handle as `source` and the hovered one as `target` without looking at their
types. A drag that began at a `Target` handle therefore produced
`ConnectedHandles({ source: <Target>, target: <Source> })`, and the same reversed
pair went to `isValidConnection`. Hit-testing was already correct (it accepts
only the opposite type), so only the fact and the predicate input were wrong —
and the browser proof only ever dragged source → target, which is why nothing
caught it.

Resolved with the review's first policy, **normalize at release**: a new
`orientConnection(from, to)` in `geometry/handles.ts` returns the pair with the
`Source` handle first, and both the `ConnectedHandles` OutMessage and the
predicate's `Connection` are built from it. It is documented as public behaviour
in the README (a gesture may start at either end; the fact is oriented by handle
type), because it is what `Connection.source`/`target` mean. `ReconnectedEdge`
was already oriented — it names the `end` that moved — and now shares the same
helper instead of two ternaries.

Tests, all of which fail on the unfixed code:

- `src/geometry/edgeEndpoints.test.ts` → `connection orientation`: the `Source`
  handle is `source` whichever end was grabbed.
- `src/state.test.ts` → `a gesture started at a target handle reports Source as
source`, and `the predicate sees a target-originated gesture the same way
round` (a recording predicate). Reverting the fix fails both with
  `source: n2/Target`.
- `tests/connection.spec.ts` → proof 21 drags from n3's `in` handle onto n1's
  `out` handle and asserts `data-last-edge === "n1:out>n3:in"`. Reverting the fix
  gives `"n3:in>n1:out"` — the reviewer's exact shape, end to end.

The review's other sections found no defects; its validation table matches this
document's, and the residual 1k pan outlier in §4 is unchanged by this fix.
