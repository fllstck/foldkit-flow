# M4 handoff

This is the starting point for the next session. M0, M1, M2 and M3 are complete and
committed, v0.1 shipped at M2, and v1.0 ships at M4. The plan was not re-litigated.
The repo is on `main`; the tree is clean at `3638b10`. Do not amend `c40ae47` (M0),
`a0a3fdc` (the M1 handoff), `898bb46` (M1 complete), the M2 commits, or `69a630e`
(M3 library) with its follow-ups, and do not rewrite history. Commit M4 work at
logical checkpoints.

Commits, newest last: `c40ae47` (M0), `a0a3fdc` (M1 handoff), `c17964e` + `0faf42b`
(M1 library + pages), `4afe982` (M1 findings), `58a1436`–`898bb46` (M1 review fixes
and evidence), `0a1db9a` + `483aa82` (M2 handoff), `7223547` (M2 library), `6ed8143`
(M2 demo + proofs), `638cf45` (M2 perf), `98041f5` + `6280f8d` + `8100466` (M2
findings and docs), `5b791d4` (M2 review fix), `59af611`–`2c585ab` (M3 handoff docs),
`69a630e` (M3 library: chrome and a11y), `b6b8cee` (M3 demo, proofs, third gate leg),
`111fa55` (M3 gate evidence), `d07be60` (lint: accumulating spreads),
`cb7b5f3` (Enter/Space activation, description memo measurement), `59dd1a5`
(M3 review 2), `f6537d2` (demo SSR-stateful stat), `c139895` (connection preview
transform), `295a24d` (text selection, connection radius), `0571642` (demo fixture
and panel feedback), `ef25076` (edges actually painted), `d47d1f1` (edges follow a
dragged node), `3638b10` (M3 review 3).

## Copy-paste prompt for the next session

> Work on M4 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M4-HANDOFF.md` first, then `docs/PLAN.md` §2.5.3, §2.5.9, §3.3–§3.4, §4.2,
> §4.5, §6 and §7 (M4, quoted verbatim in the handoff), plus
> `docs/foldkit-constraints.md`, `docs/M1-FINDINGS.md` §5–§12, `docs/M2-FINDINGS.md`
> §2.5 and §8, and `docs/M3-FINDINGS.md` §3 and §11–§15 in full. Do not re-plan or
> re-litigate the locked decisions. Extend the existing M1–M3 code; run
> `pnpm typecheck` before `pnpm build`, `pnpm build` before `pnpm check`, the
> touched Playwright files during the loop, and the full `pnpm bench` before
> claiming anything is done. Commit M4 work at logical checkpoints and record
> deviations and numbers in `docs/M4-FINDINGS.md`.

## Current state

| Area                 | State                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/flow`      | v1.0-track library: interaction core (drag, select, delete, connect, reconnect), measured handle geometry, `isValidConnection`, viewport culling, node cache, `Flow.Remeasure`, own chrome (`Background`, `Controls`, `MiniMap`, `Panel`), a11y (focus, Enter/Space, arrow nudging, description) |
| `packages/example`   | 625-node playground: drag, select, connect, reconnect, delete, chrome on, keyboard, a consumer panel that reports connection attempts, `data-*` instrumentation for proofs                                        |
| `packages/benchmark` | 625 parity + 1k culled + 1k culled-with-chrome gates (all legs verified), ShadowRoot and culling pages; 38 Playwright tests (35 proofs + 3 gate)                                                              |
| Tests                | **194** Vitest tests in 20 files in `packages/flow`; 35 proof tests (M0 4, M1 9, M2 5, M3 17) + 3 gate tests                                                                                                   |
| Tooling              | `pnpm check` (typecheck + Enfect lint + Prettier + unit), `pnpm build`, `pnpm dev`, `pnpm bench`; the fast loop is documented in `README.md`                                                                    |
| Docs                 | `PLAN.md`, the critiques, M0–M3 findings and reviews, `xyflow-internals.md`, `foldkit-constraints.md`, `README.md` (public contract)                                                                           |

Gate at M3 (`docs/M3-FINDINGS.md` §5, §14.4, §15): 625 at parity with React Flow on
pan, 1k culled p95 16.8 ms against a 33 ms gate, 1k culled **with all M3 chrome**
p95 16.8 ms, every leg verified to have moved something. Open item carried forward:
the intermittent start-of-pan stall (`M3-FINDINGS` §5.1).

## Read first

1. `docs/M4-HANDOFF.md` (this file).
2. `docs/PLAN.md` §7 **M4** — quoted verbatim under "M4 scope" below.
3. `docs/PLAN.md` §2.4 — **no upstream stylesheet, no upstream visual identity**.
   Node resizing needs a handle UI, and edge markers need glyphs: both are our own
   design, and this is the constraint an "add the upstream component" reflex breaks.
4. `docs/PLAN.md` §3.3–§3.4 — `RendererConfig`, the DOM the renderer produces, and
   the pure helper surface M4 extends (`fitViewport` already exists; `snap` and the
   parent/child position rule are new).
5. `docs/PLAN.md` §2.5.3 and §2.5.9 — measurement is DOM truth entered through Mount
   or a Command (a resize writes a box, so it is a measurement event), and the
   reconciliation seam a parent uses when it changes the graph out of band
   (`Flow.informGraphChanged`). Sub-flows and hidden subtrees are both "the graph
   changed and the flow must not keep dead ids".
6. `docs/PLAN.md` §4.2 — the per-node Mount (`MountNode`) that owns `ResizeObserver`
   + `MutationObserver` and emits `MeasuredNode`/`MeasuredHandles`. Resizing hangs off
   it, and it is the only place that may read node geometry.
7. `docs/PLAN.md` §4.5 and §6 — the hot path, the gate, and the testing split
   (Story for pure, Scene for view, Playwright for the browser-only layer).
8. `docs/M3-FINDINGS.md` §3 and §11–§15 — the trail of bugs that DOM assertions could
   not see: the stacking regression, the preview drawn in flow space, the
   zero-sized SVG viewport that stopped every edge painting, the drag overlay and
   its edges. M4 adds geometry *and* chrome; that is the same blast radius.
9. `docs/M2-FINDINGS.md` §2.5 (handle indexing and endpoint memoization — the
   precedent for any new per-frame geometry) and §8 (what M2 deliberately left,
   including edge selection from the pointer layer).
10. `docs/M1-FINDINGS.md` §5–§12 — the interaction core's deliberate gaps, and the
    bugs the proofs found.
11. `docs/foldkit-constraints.md` — Mount args are captured at mount, subscriptions
    resolve the pane root, `viewInputs` functions must be top-level, and pointer
    attributes have no propagation option.

## What M4 inherits

Working today and designed to be extended:

- **The viewport is in the Model and its bounds are single-sourced** (`Model.minZoom`
  / `maxZoom`, seeded by `init`, passed to `PaneHost`'s engine and clamped once in
  `setViewport`). `Flow.setViewport`, `Flow.zoomBy`, `Flow.fitViewport` and the
  `Controls` buttons all go through those two calls.
- **`Flow.fitViewport(model, nodes, padding?)`** exists and is tested without a DOM
  (`geometry/fit.ts`), including its three degenerate cases. M4's "fitView options"
  extends this function, not a second one.
- **`Flow.viewportRect` / `visibleRegion`** are separate on purpose: the pane's box
  and culling's overscan. A minimap-style interaction (click-to-centre) needs the
  first; `hidden`-subtree collapsing needs to change the second *and* the render
  filter.
- **The renderer owns its caches** (`view/nodeCache.ts`, the handle index, the
  endpoint memo, `viewMemo` slots for the minimap and description) and follows one
  rule: a rendering cost is an explicit, opt-in `RendererConfig` flag whose default
  DOM stays minimal for the gate (`cull`, `reconnect`, `background`, `controls`,
  `minimap`).
- **The drag overlay** renders a dragged node at `position + delta` and applies the
  same delta to the anchors of edges attached to it (`shiftForDrag` in `view.ts`).
  Any new position-derived thing — a minimap node, a description line, a snapped
  position — has to decide explicitly whether it reads committed positions or the
  overlay, the way `M3-FINDINGS` §15 had to.
- **Chrome is a press target inside the pane**: `classes.NoPan` plus
  `data-fflow-chrome`, declined by the pane handler and by d3's filter. A resize
  handle is chrome by that definition, and `.fflow__nodrag`/`blockedDrag` decide
  whether a press also arms a node drag.
- **Measurement contract closed out**: node `ResizeObserver` + `MutationObserver`,
  coalesced to one measurement per frame; `Flow.Remeasure(paneId, nodeIds)` for
  stylesheet-only changes; `handleBounds` merge/prune semantics.
- **The proof harness**: `packages/benchmark/tests/*.spec.ts`, `data-*` attributes on
  `main.app` for instrumentation, explicit `WAIT` timeouts, and the rule that a
  scripted gesture must be shown to have moved something (and, since M3, that a
  *painted* thing needs a pixel assertion — proof 36).
- **A third gate leg** (`/large-chrome.html`) exists for chrome cost; a new feature
  that renders per frame gets its own leg or an opt-in flag, not a default.

## Provisional or missing, i.e. M4's work

1. **Parent/child sub-flows.** `FlowNode.parentId` is **declared and never read**
   (`model.ts:116`) — the same shape of gap `RendererConfig.minZoom` was in M3. There
   is no absolute-position resolution: `nodeRect`, `nodeBounds`, `visibleNodes`,
   `nodeSizeOf`, edge anchors and the drag overlay all treat `node.position` as
   absolute flow space. M4 has to decide where the parent chain is resolved, and
   everything position-derived has to follow one rule.
2. **Node resizing.** Nothing exists. `@xyflow/system@0.0.84` exports `XYResizer`
   (`xyresizer/XYResizer.d.ts`): it takes a DOM node, a `nodeId`, a
   `getStoreItems()` thunk returning `{ nodeLookup, transform, snapGrid, snapToGrid,
   nodeOrigin, paneDomNode }`, and calls `onChange(changes, childChanges)` /
   `onEnd(change)`; `update({ controlPosition, boundaries, keepAspectRatio,
   resizeDirection, onResizeStart, onResize, onResizeEnd, shouldResize })` wires the
   handles. It is not in `runtime/adapter.ts` yet, and the `getStoreItems` shape has
   to be synthesised from the Model (which owns no graph) — that is the design
   question, not the glue.
3. **Snap grid.** Nothing exists. `snapPosition(position, snapGrid)` is exported by
   the pinned engine and not wrapped in the adapter. The decision is *where* snapping
   applies: to the live drag delta (per frame, in `MovedPointer`), to the released
   positions only, or to both — and whether the snap grid belongs in the Model (like
   zoom bounds) or in `RendererConfig` (like `cull`).
4. **`fitView` options.** `Flow.fitViewport(model, nodes, padding?)` takes a padding
   and nothing else. M4's options — a node filter, explicit bounds, a duration, a
   `maxZoom` override for the fit — extend it and the `Controls` fit button. Keep the
   "one clamp" rule: the Model's bounds stay the single source of truth.
5. **Edge types, labels, markers.** `FlowEdge.type` already selects Bezier / Straight
   / Step / SmoothStep through `edgePath`, and `edge.label` renders when
   `renderEdgeLabel` is configured. **Markers (arrowheads) do not exist**, and neither
   do label backgrounds or per-edge styling. Note the trap that cost M3 a day: an SVG
   `transform` attribute takes unitless numbers, `getComputedStyle` reports values
   that do not paint, and a zero-sized SVG viewport silently kills
   `non-scaling-stroke`.
6. **`hidden`-based subtree collapsing.** `FlowNode` has no `hidden` field and
   `visibleNodes` culls by viewport rectangle only. Collapsing means: a hidden node
   is not rendered, its edges are not rendered, its subtree is not rendered, and its
   measurement is not kept (`informGraphChanged`'s pruning is the precedent). It is
   the documented escape hatch for very large graphs, so its cost has to be measured
   against the gate before it is claimed.
7. **Minimap interaction.** M3 shipped the minimap display-only and named
   click-to-centre and drag-to-pan as M4. It is a new gesture surface with its own
   pointer identity, its own `NoPan` requirements and its own cancel semantics.
8. **Open since M2: edge selection from the pointer layer.** `model.selectedEdgeIds`
   is written but never set by a press (`M2-FINDINGS` §8). Edge labels and markers
   make an edge a first-class editable object, which is the moment to decide whether
   a press on an edge line selects it (today a press on the line reaches the pane and
   clears the selection).
9. **`connectionRadius` is a constant**, not a `RendererConfig` field
   (`geometry/hitTest.ts`). M4's options pass is the natural place to make it
   configurable, along with any snap or fit defaults.

## Contract decisions already made (do not re-litigate)

Everything in `docs/M1-HANDOFF.md`, `docs/M2-HANDOFF.md` and `docs/M3-HANDOFF.md`
still holds. The ones M4 will keep running into:

- **The parent owns the graph**; the flow owns interaction state only. `update`
  receives nodes/edges through `context` and never stores them (§2.5.1).
- **Chrome and visuals are ours.** No upstream stylesheet, no copied look, no
  attribution component. Class prefix `fflow__`, one stylesheet, one `classes.ts`.
- **Nothing live in the Model.** `PaneHost` (element, root, panZoom) is the boundary;
  Commands cross it by `paneId` and answer `Failed*` when it is absent.
- **Measurement is DOM truth**, entered through Mount or a Command, never `view`.
  Geometry-affecting CSS needs `Flow.Remeasure` (§2.5.3, `README.md`).
- **`view` is a pure function of the Model.** A number that changes because of what
  the *previous* render did is not (`M3-FINDINGS` §10: the demo's `cacheSize()` stat
  made the dev server's served markup disagree with the client's first view).
- **Events: a press inside the pane belongs to the pane unless something opts out.**
  Nodes carry `NoPan`; chrome carries `NoPan` + `data-fflow-chrome`; d3's filter and
  the pane's own handler are separate decisions (`M3-FINDINGS` §3's stacking bug came
  from treating layer order as incidental).
- **Z-order is a load-bearing decision:** the edges layer paints *below* nodes, and
  giving a layer an explicit `z-index` reordered them and made edges swallow presses.
- **Every Message has a producer and a consumer.** Adding a variant breaks the
  exhaustive `Message.match`/`OutMessage.match` sites in the demo and the benchmark —
  at **runtime**, because `vite build` does not typecheck. Run `pnpm typecheck` first.
- **Engine calls stay behind `runtime/adapter.ts`**, pinned at `@xyflow/system@0.0.84`
  (`XYResizer`, `snapPosition`, `getNodesBounds` are available; `getRectOfNodes` is
  not).
- **The gate is §4.5's**: p95 < 33 ms at 1k with culling, every leg proven to have
  moved, opt-in flags rather than default cost, and long frames bounded at 2% of
  recorded frames rather than forbidden (the machine produces them; see
  `M3-FINDINGS` §5.1).
- **A DOM assertion is not a paint assertion** (`M3-FINDINGS` §14). Anything visual
  M4 adds needs a pixel-level check, not just a `d` string or an attribute.

## M4 scope (from `docs/PLAN.md` §7, quoted)

> **M4 — graph features.** Parent/child sub-flows, node resizing (`XYResizer`),
> snap grid, `fitView` options, edge types (step/smoothstep/labels/markers), and
> `hidden`-based subtree collapsing as the documented escape hatch for very large
> graphs.
>
> _—— v1.0 ships here ——_

Turned into a checklist:

1. **Parent/child position resolution**, one rule, everywhere: `nodeRect`,
   `nodeBounds`, `visibleNodes`, `visibleEdges`, `edgeAnchor`, the drag overlay, the
   minimap, the description, and hit-testing. Decide whether children carry
   parent-relative positions (upstream's model) or the parent normalises before
   passing them (a `FlowContext` transform), and write the decision in the findings.
   Dragging a parent has to move its children — decide whether that is one
   `MovedNodes` with every descendant or a rule the parent applies.
2. **Node resizing** as a gesture: our own handles, `XYResizer` behind the adapter,
   `RendererConfig` opt-in, `OutMessage.ResizedNodes` (or equivalent) for the parent
   to persist, and a measurement path that does not fight the `ResizeObserver`
   (a resize is a measurement event, not a `view` mutation).
3. **Snap grid**: `snapPosition` behind the adapter, one decision about live-vs-release
   snapping, and a Model-vs-config decision for where the grid lives.
4. **`fitView` options**: filter, bounds, duration and a fit-specific clamp on top of
   `Flow.fitViewport`, with the Model's zoom bounds still enforced once.
5. **Edge types, labels, markers**: markers need `<defs>`/`<marker>` in the edges SVG
   (which now has a real viewport — do not regress that), labels need a background and
   a measurable layout if they are interactive, and per-edge configuration must stay
   the parent's (it owns the edge).
6. **`hidden` subtree collapsing**: a `hidden` flag, a culling rule that includes
   descendants and their edges, measurement pruning, and a measured cost at 1k and
   10k before it is described as the escape hatch.
7. **Minimap interaction** (click-to-centre, drag-to-pan) or an explicit decision to
   leave it out of v1.0. It is a new gesture surface: pointer identity, `NoPan`,
   cancel, and a `setViewport` command.
8. **Docs and evidence**: `README.md` gains the M4 contract (sub-flow positions,
   resize facts, snap semantics, fit options, markers, `hidden`), and
   `docs/M4-FINDINGS.md` records deviations. Story for pure helpers and Messages,
   Scene where Foldkit allows it, Playwright for the gesture and the paint.
9. **Gate**: re-run at 1k with the new features on, and decide which of them earn a
   dedicated leg (precedent: `/large-chrome.html`). If `hidden` collapsing is the 10k
   escape hatch, measure 10k with it on and record the number even though the gate
   does not cover 10k (PLAN §4.5: "no numeric promise until measured").

## Suggested order

1. **Parent/child position resolution as a pure helper with unit tests.** Everything
   else in M4 consumes positions; getting the rule wrong twice is the expensive path.
2. **`hidden` collapsing + measurement pruning**, also pure first: it is a reductive
   change to culling and it derisks the 10k story early.
3. **Snap grid**: the adapter wrapper, the snap decision, and Story tests for the
   delta/position arithmetic.
4. **`fitView` options** on top of `fitViewport`, plus the `Controls` wiring.
5. **Edge markers and labels**: SVG `<defs>`, one proof that the marker is painted,
   and the label path.
6. **Node resizing last of the geometry work**: it is the only feature that both
   writes a box and creates a gesture, so it needs the Mount/measurement seam.
7. **Minimap interaction** if it is in scope.
8. **Proofs, then `docs/M4-FINDINGS.md`**, then the README contract.

## Known traps and gotchas

Everything in `docs/M1-HANDOFF.md`, `docs/M2-HANDOFF.md` and `docs/M3-HANDOFF.md`
still applies. Sharpened ones from M3 and its follow-ups:

- **`pnpm typecheck` before `pnpm build`, `pnpm build` before `pnpm check`.** The
  example and the benchmark typecheck against the library's `dist/*.d.ts`, so a stale
  dist fails the check; and `vite build` does **not** typecheck, so a new Message
  variant surfaces as a runtime crash in the browser (Foldkit's crash view, "…
  is not a function") rather than a red check. `M3-FINDINGS` §8.2 has the incident.
- **A DOM assertion cannot see paint.** `M3-FINDINGS` §14: every edge path was in the
  DOM with the right `d`, the right stroke and `stroke-width: 1.5px`, and nothing was
  drawn, because `.fflow__viewport` had no size of its own (0×0) and a zero-sized SVG
  viewport degenerates `non-scaling-stroke`. Assert the container's `clientWidth` and
  compare pixels with the layer hidden (proof 36), not just attributes.
- **SVG `transform` attributes take unitless values.** `translate(20px, 200px)` is
  CSS; on an SVG element it is silently ignored and the geometry stays where it was.
  `svgTransformOf` exists for this (`M3-FINDINGS` §11.1).
- **`getComputedStyle` reports the CSS value, not the painted result.** Both the
  stroke bug and the inert transform looked correct from computed style.
- **The edges layer must stay below the nodes layer.** Giving it an explicit
  `z-index` lifted every path above every node and made edges swallow presses
  (`M3-FINDINGS` §3). `pointer-events` on the edges layer is a separate, deliberate
  decision.
- **A drag must not select the page's text** — `.fflow__pane { user-select: none }`
  with an opt-back for inputs (`M3-FINDINGS` §12.1). A new gesture surface inherits
  this or repeats the bug.
- **A connection drops within 20 screen pixels of a handle**, nearest-centre wins
  under overlapping slack, and only the opposite handle type is accepted
  (`M3-FINDINGS` §12.2). A resize or minimap gesture must not become a connection.
- **The demo's fixture is instrumentation.** It links every step except every third
  one so that the natural connect gesture can succeed; proofs depend on `e1`
  (n0→n1), n3→n4, and on n0→n2 being novel. Its panel reports the last connection
  attempt because a rejected release emits no fact at all.
- **The M2/M3 start-of-pan stall is unexplained and real**: baseline at `2c585ab`
  was 1–2 long frames in 2 of 3 invocations; at M3 it was 0, 3 and 3 in three runs
  bare and 0 in all three with chrome. Re-baseline before adding a per-frame cost,
  and do not read a red `longFrames` bound as a regression without that baseline.
- **The full browser suite is the frame gate and takes ~2.8 min** (3 libraries × 11
  cold loads of the 625 fixture, 11 of the 1k fixture, 11 of the 1k fixture with
  chrome, one worker). Use the fast loop in `README.md`.
- **`pkill -f vite` before a suite run.** A preview left running owns 4173/4174 and
  the run navigates into a server it did not start (`ERR_HTTP_RESPONSE_CODE_FAILURE`,
  `M1-FINDINGS` §11). A leftover Playwright process from a killed run does the same
  and can hang the next invocation.
- **A hung browser proof is usually a crash view**: `main.app` never appears, so
  every `locator.getAttribute` waits out the 600 s test budget. Pass
  `--timeout 40000` when iterating so a failure reports instead of hanging.
- **`page.waitForFunction` has no default timeout.** Pass `WAIT = { timeout: 15_000 }`.
- **The tree's formatting is Prettier's**, `docs/M*-FINDINGS.md` is formatted, and
  `docs/PLAN.md` is deliberately excluded. Run `pnpm format` before committing;
  `format:check` is part of `pnpm check`.
- **`h.OnPointerDown`/`OnKeyDown` have no propagation option.** Propagation is decided
  by inspecting `event.target` (`runtime/domTarget.ts`), and Scene builds simulated
  targets from attributes only, so guards match the class **or** the data attribute.

## Verification and definition of done

```sh
pnpm typecheck             # first: v builds do not typecheck
pkill -f vite              # a stale preview owns 4173/4174
pnpm build                 # flow → example → benchmark (before check: dist types)
pnpm check                 # typecheck, Enfect lint, Prettier, unit tests
pnpm bench                 # Playwright: every proof + all three gate legs
```

M4 is done when:

- a parent/child layout renders with children positioned relative to their parent,
  by one rule that every position-derived helper shares, and dragging a parent moves
  its subtree (proved in a browser, with the transform read before and after);
- node resizing works through `XYResizer` behind the adapter, is opt-in, reports a
  fact the parent persists, and its measurement does not fight the node Mount;
- the snap grid applies at one documented point in the gesture and is proved to snap;
- `fitView` options exist on top of `Flow.fitViewport` and the Model's zoom bounds are
  still the only clamp;
- edge markers and labels render and are **proved to paint** (a pixel assertion, not
  an attribute);
- `hidden` collapsing removes a subtree, its edges and its measurement, and the 1k
  gate still passes with it on — with the cost recorded;
- `pnpm typecheck`, `pnpm build`, `pnpm check` and `pnpm bench` are green, the gate
  JSON is committed (`packages/benchmark/results/benchmark.json`), and
  `docs/M4-FINDINGS.md` records every deviation and number from a run at the commit
  that carries it.

## Open design questions for M4

- **Where is the parent chain resolved?** Upstream stores child positions relative to
  the parent and computes absolute positions in its store. The flow has no store: the
  choice is a pure helper applied wherever a position is read (one rule, many call
  sites) or a normalised `Context` the parent builds. The second is cheaper per frame
  and puts the cost on the parent; the first keeps the parent's data honest and the
  flow's hot path doing arithmetic it already does.
- **Does dragging a parent emit one `MovedNodes` for the whole subtree** or one per
  node? The parent has to persist every descendant's absolute position either way;
  the question is whether the flow knows the subtree or the parent does.
- **Where do `snapGrid` and `nodeOrigin` live** — Model (like zoom bounds, so
  `update` can clamp and snap) or `RendererConfig` (like `cull`)? Snapping happens in
  `update` during a drag, which argues for the Model; the grid is a presentation
  choice, which argues for config. Pick one and say why.
- **Does a resize gesture live in `Gesture`?** It is a pointer gesture with an owner
  pointer, a cancel path and an OutMessage — the union's shape. The alternative, a
  Mount-owned resizer that reports only facts, keeps the Model smaller but puts
  gesture state in the DOM, which the delete/drag/connect paths deliberately avoid.
- **Are edge markers per-edge or a renderer default?** The parent owns the edge, so
  per-edge data (`edge.markerEnd?: "Arrow"`) is the honest place; a renderer default
  is fewer bytes per edge.
- **Does `hidden` mean "not rendered" or "collapsed"?** Upstream's `hidden` removes a
  node from the store's visible set; collapsing usually hides a whole subtree behind
  an explicit parent flag. M4 must name which semantics it ships, because the 10k
  story depends on it.
- **Is the minimap interactive in M4 at all?** It was deferred from M3. If v1.0's
  scope is tight, saying "display-only" again is defensible — but then the handoff for
  M5 should not claim it shipped.
- **Does M4 take edge selection from the pointer layer?** Labels and markers make an
  edge a first-class object; if M4 ships edge labels and markers without edge
  selection, say so explicitly (M2 said so about `selectedEdgeIds`).
- **What is the 10k number, and does it need a plan?** PLAN §4.5 promises no figure
  until measured; `hidden` collapsing is the escape hatch that makes 10k possible.
  Measure once at M4, record the number, and let M5 publish it.

## Working agreements

- Do not edit `docs/PLAN.md` wholesale. Put deviations and proposed diffs in
  `docs/M4-FINDINGS.md`, as M0–M3 did.
- Do not import `@xyflow/react` or `@xyflow/svelte` outside `packages/benchmark`.
- Do not copy upstream CSS or add an attribution component.
- Do not amend `c40ae47`, `a0a3fdc`, `898bb46`, the M2 commits, or `69a630e` and the
  M3 commits; commit at logical checkpoints; ask before force-pushing or rewriting
  history. No network install beyond npm without asking.
- Every claim in the findings document must come from a run at the commit that
  carries it, and stale figures must be labelled historical (`M1-FINDINGS` §12).
