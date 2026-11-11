# M3 handoff

This is the starting point for the next session. M0, M1 and M2 are complete and
committed, v0.1 ships at M2, and the plan was not re-litigated. The repo is on
`main`; the tree is clean at `59af611`, the commit that carries this file. Do not amend `c40ae47` (M0), `a0a3fdc` (the M1 handoff),
`898bb46` (M1 complete) or the M2 commits, and do not rewrite history. Commit M3
work at logical checkpoints.

Commits, newest last: `c40ae47` (M0), `a0a3fdc` (M1 handoff), `c17964e` +
`0faf42b` (M1 library + pages), `4afe982` (M1 findings), `58a1436`–`898bb46`
(M1 review fixes and evidence), `0a1db9a` + `483aa82` (M2 handoff), `7223547`
(M2 library), `6ed8143` (M2 demo + proofs), `638cf45` (M2 perf), `98041f5` +
`6280f8d` + `8100466` (M2 findings and docs), `5b791d4` (M2 review fix).

## Copy-paste prompt for the next session

> Work on M3 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M3-HANDOFF.md` first, then `docs/PLAN.md` §2.4, §2.5, §3.3–§3.5, §4.1,
> §4.5–§4.6, §6 and §7 (M3), plus `docs/foldkit-constraints.md`,
> `docs/M1-FINDINGS.md` §5–§12, `docs/M2-FINDINGS.md` in full and
> `docs/M2-REVIEW.md`. Do not re-plan or re-litigate the locked decisions. Extend
> the existing M1/M2 code; run `pnpm build` before `pnpm check`, the touched
> Playwright files during the loop, and the full `pnpm bench` before claiming
> anything is done. Commit M3 work at logical checkpoints and record deviations in
> `docs/M3-FINDINGS.md`.

## Current state

| Area                 | State                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/flow`      | v0.1 library: interaction core (drag, select, delete, connect, reconnect), measured handle geometry, `isValidConnection`, culling, node cache, `Flow.Remeasure` |
| `packages/example`   | 625-node playground: drag, select, connect, reconnect, delete, toolbar buttons that stand in for chrome, `data-*` instrumentation for proofs                    |
| `packages/benchmark` | 625 parity + 1k culled gate (both legs verified), ShadowRoot and culling pages; 20 Playwright tests                                                             |
| Tests                | 123 Vitest tests in `packages/flow`; 20 Playwright tests = 18 proofs (M0 proofs 2–4, M1 proofs 8–16, M2 proofs 17–21) + 2 gate tests                            |
| Tooling              | `pnpm check` (typecheck + Enfect lint + Prettier + unit), `pnpm build`, `pnpm dev`, `pnpm bench`; the fast loop is documented in `README.md`                    |
| Docs                 | `PLAN.md`, the critiques, M0/M1/M2 findings and reviews, `xyflow-internals.md`, `foldkit-constraints.md`, `README.md` (public contract)                         |

Gate at M2 (`docs/M2-FINDINGS.md` §4): 625 nodes at parity with React Flow on pan,
1k culled at p95 16.8 ms against a 33 ms gate, both legs verified to have moved
something. One open item is carried into M3 — see "What M3 inherits" and §4 of the
M2 findings.

## Read first

1. `docs/M3-HANDOFF.md` (this file).
2. `docs/PLAN.md` §7 **M3** — quoted verbatim under "M3 scope" below.
3. `docs/PLAN.md` §2.4 — **no upstream stylesheet, no upstream visual identity**.
   The background pattern, controls and minimap are our own design; that is a
   design task, not a copy job, and it is the constraint M3 is most likely to
   break by accident.
4. `docs/PLAN.md` §3.3 — the renderer, `RendererConfig`, and the DOM the renderer
   produces, including the `div.foldkit-flow__controls` / `div.foldkit-flow__minimap`
   slots the plan reserves as siblings of the viewport.
5. `docs/PLAN.md` §3.4 — the pure helper surface. `Flow.fitViewport(model, nodes, padding?)`
   is in that list and is **not implemented**; M3's `Controls` fit button needs it.
6. `docs/PLAN.md` §2.5.6 and §4.5 — culling is derived from the Model's viewport,
   and the hot path is `update` + `view` per frame. Chrome that recomputes per
   frame from the graph is the way M3 regresses the gate.
7. `docs/PLAN.md` §4.6 — propagation rules. Chrome inside the pane is a press
   target inside the pane, and the pane's d3 filter sees it first.
8. `docs/PLAN.md` §6 — testing strategy, and the foldkit constraints on Scene
   (no `pointermove`; simulated targets are built from attributes only).
9. `docs/M2-FINDINGS.md` — how M2 actually landed, especially §4 (the 1k pan
   outlier), §2.5 (indexing and memoization) and §9 (the orientation fix).
10. `docs/M1-FINDINGS.md` §5–§12 — what M1 deliberately left, and the bugs the
    proofs found (a node press panned the pane; two harness legs measured idle
    frames).
11. `docs/foldkit-constraints.md` — Mount args, subscriptions, `viewInputs`, and
    the keyboard/pointer attribute surface M3's a11y work depends on.

## What M3 inherits

Working today, and reusable for chrome:

- **The viewport is in the Model**, committed per frame through the throttle
  (`MovedViewport` with `isGestureEnd: false`) and once per gesture
  (`isGestureEnd: true`, which also emits `ChangedViewport`). `model.pane` is kept
  current by `ResizedPane`, so chrome that needs the pane box has one.
- **`Flow.setViewport(model, viewport, duration?)` and `Flow.zoomBy(model, factor)`**
  return a `SyncViewport` Command that animates through `host.panZoom.setViewport`
  and resolves with the engine's committed viewport. Controls' zoom and fit
  buttons are these two calls; the demo already does it
  (`packages/example/src/main.ts`, `ClickedZoomIn`).
- **`adapter.getViewportForBounds` is already wrapped and unused** (`runtime/adapter.ts`).
  `Flow.fitViewport` is a small pure helper over it plus `geometry/bounds.ts`'s
  `nodeBounds`.
- **Geometry the chrome needs already exists**: `nodeBounds`, `nodeRect`,
  `nodeSizeOf`, `screenToFlow`/`flowToScreen`, `visibleNodes`/`visibleEdges`.
  Note that `visibleRegion` is the pane plus **one full screen of overscan on
  every side** (3× the pane), so it is _not_ the minimap's viewport rectangle —
  M3 needs a plain `viewportRect(model)` and must not reuse the overscan region
  for drawing.
- **The class/attribute contract has one home** (`view/classes.ts`) and one
  stylesheet (`packages/flow/style/flow.css`). `classes.NoPan` is what exempts a
  press from the pane's d3 filter; `classes.NoWheel`, `NoKey`, `NoDrag` likewise.
- **The renderer owns its caches** (`view/nodeCache.ts`, plus the handle index and
  endpoint memo M2 added). `RendererConfig` already has opt-in flags (`cull`,
  `reconnect`) whose precedent is: a rendering cost is an explicit choice, and the
  default DOM stays minimal for the gate.
- **The proof harness**: `packages/benchmark/tests/*.spec.ts`, `data-*` attributes
  on `main.app` for instrumentation, explicit `WAIT` timeouts, and the rule that a
  scripted gesture must be shown to have moved something.

Provisional or missing, i.e. M3's work:

1. **No chrome at all.** The renderer produces pane → viewport → (edges, nodes),
   plus the connection layer. There is no `Background`, `Controls`, `MiniMap`,
   `Panel`, no focusable node wrapper, no tab order, no description region, and no
   chrome classes in `classes.ts` or rules in `flow.css`.
2. **`RendererConfig.minZoom` / `maxZoom` are declared and never read.**
   `runtime/mountPane.ts` hardcodes `minZoom: 0.1, maxZoom: 2`. Chrome that offers
   zoom in/out must respect the same bounds the pan/zoom engine enforces — wire the
   config through `MountPane` args (captured at mount) or delete the fields. Do not
   leave three sources of truth.
3. **`Flow.fitViewport` does not exist**, so `Controls`' fit button has no target
   to call. Fit also has to decide what "fit" means with culling on and with nodes
   that have not been measured yet (`nodeSizeOf` has the fallback).
4. **Nothing is focusable.** Node wrappers are `<div>`s with a `PointerDown`
   handler and no `tabindex`, `role`, or accessible name; there is no `focusedNodeId`
   in the Model and no Message that carries focus. Arrow-key nudging must produce
   `MovedNodes` for one node, which means the press-time guard (`isDeleteKeyAllowed`,
   §2.5.8) has to cover the new keys too.
5. **`model.selectedEdgeIds` is written but never set from the pointer layer** — M2
   left it that way. If M3's a11y work makes edges focusable, that is the moment to
   decide whether the pointer layer selects them too.
6. **The 1k pan outlier is unexplained** (`M2-FINDINGS` §4): roughly one gate
   invocation in three records 1–2 frames over 50 ms at the start of a pan, in one
   frame that does exactly one render and no measurement work. M3 touches zoom and
   the viewport path; re-baseline this before adding chrome and do not mistake a new
   cost for the old noise.

## Contract decisions already made (do not re-litigate)

Everything in `docs/M1-HANDOFF.md`'s and `docs/M2-HANDOFF.md`'s lists still holds.
The ones M3 will keep running into:

- **The parent owns the graph**; the flow owns interaction state only. `update`
  receives nodes/edges through `context` and never stores them (§2.5.1).
- **Chrome is ours.** No upstream stylesheet, no copied look, no attribution
  component. Class prefix `fflow__`, one stylesheet, one `classes.ts`.
- **Nothing live in the Model.** `PaneHost` (element, root, panZoom) is the
  boundary; Commands cross it by `paneId` and answer `Failed*` when it is absent.
- **No `document` fallback for subscriptions.** Resolve the pane root through
  `PaneHost`, so ShadowRoot and iframe hosts keep working and two flows never share
  a listener.
- **A press inside the pane belongs to the pane's d3 filter unless something
  opts out.** Nodes carry `classes.NoPan` (M1 §8, a real bug). Chrome that is
  inside the pane element needs the same treatment or a press on a control will
  start a pan.
- **Measurement is DOM truth**, entered through Mount or a Command, never `view`.
  Geometry-affecting CSS needs `Flow.Remeasure` (§2.5.3, documented in `README.md`).
- **Handle identity is one comparison** (`geometry/handles.ts`), and a connection
  is oriented by handle type, not by the direction the pointer travelled
  (`orientConnection`, M2 §9).
- **Every Message has a producer and a consumer.** M2 removed `HoveredHandle`
  rather than leave a handled-but-never-sent variant in the union, and the demo and
  benchmark `Message.match`/`OutMessage.match` calls are exhaustive — adding a
  Message variant surfaces every site that must handle it. That is a feature.
- **Engine calls stay behind `runtime/adapter.ts`**, pinned at `@xyflow/system@0.0.84`.
- **The gate is §4.5's**: p95 < 33 ms at 1k with culling, both legs proven to have
  moved. Opt-in flags rather than default cost.

## M3 scope (from `docs/PLAN.md` §7, quoted)

> **M3 — own chrome and a11y.** `Background` (dot and line patterns, drawn against
> our own CSS, transform-aware), `Controls` (zoom in/out/fit), `MiniMap`, `Panel`,
> focusable nodes with Tab cycling and arrow-key nudging, and a visually hidden
> description region listing the nodes and their connections.

Turned into a checklist:

1. **`Flow.fitViewport(model, nodes, padding?)`** as the §3.4 pure helper over
   `adapter.getViewportForBounds` + `nodeBounds`. Pure, tested without a DOM, and
   the only path a fit button uses (`setViewport(model, fitted)`). Decide what it
   does with an empty graph, an unmeasured graph, and the engine's zoom clamp.
2. **`Background`** — dot and line patterns from our own CSS, transform-aware:
   the pattern has to move with `model.viewport` and must not live inside
   `.fflow__viewport` (it would scale with the content). Decide whether it is a
   renderer config flag or a consumer-composed helper, and keep it out of the
   per-frame diff if it can be (a CSS background driven by the transform, not one
   element per dot).
3. **`Controls`** — zoom in, zoom out, fit. Two of the three already exist as
   helpers; fit does not (item 1). Zoom must respect the engine's bounds, which are
   currently hardcoded in `mountPane.ts` and duplicated in an unread `RendererConfig`.
   Every control button is a press inside the pane: `.fflow__nopan`, and it must not
   clear the selection (`isEdgeEndpointTarget`-style guard or a
   `[data-fflow-control]` target the pane handler declines).
4. **`MiniMap`** — node rectangles plus a viewport rectangle, drawn from
   `nodeBounds` + `viewportRect(model)` (not `visibleRegion`, see above). Decide
   whether it is interactive (click/drag to move the viewport is a real feature and
   a new gesture surface) or display-only in M3. Watch the cost: 1k rectangles per
   frame is exactly the kind of thing the gate exists to catch, so it is opt-in and,
   if it renders, memoized like the edge endpoints.
5. **`Panel`** — a positioned container for consumer chrome (top-left/top-right/…),
   with the same `NoPan`/no-selection rules as `Controls`.
6. **Focusable nodes** — `tabindex`, `role`, an accessible name derived from
   `node.data` (the parent owns the data, so the accessible name needs a config
   hook or an attribute the consumer can set through `renderNode`), a visible focus
   ring that is ours, and a Model-visible notion of which node is focused if Tab
   cycling and nudging need one. `foldkit/html` gives `OnKeyDownPreventDefault`
   (arrow keys must not scroll the page) and `OnKeyDownFocus`
   (`{ focusSelector, message }` — it focuses an element by selector; node wrappers
   already carry `data-nodeid`, so it is a candidate for cycling without a Command).
   Native tab order may be enough for Tab; wrapping at the ends needs a decision.
7. **Arrow-key nudging** — a focused node moves by a step (and a larger step with a
   modifier?) and reports one `MovedNodes` per key press or per gesture. Reuse
   `isDeleteKeyAllowed` so a keystroke inside an input or `.fflow__nokey` never
   moves the graph, and decide whether a nudge is one OutMessage or a burst.
8. **A visually hidden description region** listing the nodes and their
   connections. Decide: total or capped, updated per commit (it must not churn on
   every drag frame — a live region that changes 60×/s is worse than none), and
   where it sits (a sibling of the viewport in the pane, not inside the transform).
9. **Docs and evidence** — `README.md` gains the chrome/a11y contract (what the
   consumer must supply for a usable tab order and accessible names), and
   `docs/M3-FINDINGS.md` records deviations. Playwright proofs for background
   movement, controls, the minimap, and keyboard focus/nudge; Story for the pure
   helpers and Messages; Scene where the foldkit model allows it.

## Suggested order

1. `Flow.fitViewport` + `viewportRect` as pure helpers with unit tests — they are
   the only new geometry and everything else consumes them.
2. Wire `minZoom`/`maxZoom` through `MountPane` args (or delete them), and add the
   zoom/fit Messages or helper calls `Controls` will dispatch. Decide Message vs
   helper at the same time (see open questions).
3. `Controls` + `Panel`: smallest chrome, exercises the `NoPan`/no-selection rules
   and the pane layering, and gives the proofs something to drive.
4. `Background`: transform-aware, CSS-driven, no per-dot elements.
5. `MiniMap`: display-only first, then decide about interaction. Measure it against
   the 1k gate before making it default.
6. Focusability and keyboard: node wrapper attributes, focus ring, tab order,
   arrow-key nudge `MovedNodes`, all behind the existing keyboard guard.
7. The description region last: it needs the final node/edge accessibility
   vocabulary to describe anything useful.
8. Playwright proofs, then `docs/M3-FINDINGS.md`.

## Known traps and gotchas

Everything in `docs/M1-HANDOFF.md` and `docs/M2-HANDOFF.md` still applies. New and
sharpened ones from M2:

- **`pnpm check` typechecks the example and the benchmark against the library's
  `dist/*.d.ts`.** After changing the public surface, `pnpm build` first or `pnpm
check` fails on a stale `dist` that a rebuild fixes. This cost M2 time twice.
- **The full browser suite is the frame gate and takes ~1.8 minutes** (3 libraries ×
  11 cold loads of the 625-node fixture + 11 of the 1k fixture, one worker because
  the measurement is a frame distribution). Use the documented fast loop instead:
  the file you touched, or `--grep "1000-node"` for the gate alone.
- **A demo page without the library stylesheet has 0×0 handles.** The example
  imported only its own CSS until M2, so nothing was hittable and every proof
  tested markup only. Chrome that sizes itself from CSS has the same trap: a
  measurement or hit-test derived from chrome geometry needs a real box.
- **The demos' instrumentation is a contract.** `main.app` carries `data-gesture`,
  `data-viewport`, `data-edges`, `data-last-edge`, `data-last-reconnect`,
  `data-connection-target`, `data-measured-nodes`, `data-pane-mounts`; proofs read
  those names. Adding chrome means adding attributes, not scraping class names.
- **A scripted gesture must be shown to have moved something.** Two M1 harness runs
  recorded idle frames and reported them as distributions. Every new proof asserts
  mid-gesture state (`data-gesture`, `data-connection-target`) before the outcome.
- **`page.waitForFunction` has no default timeout.** Pass `WAIT = { timeout: 15_000 }`.
- **`pkill -f vite` before a suite run**: a benchmark preview left running owns
  port 4173 (`reuseExistingServer`).
- **A Chrome stall exists at the start of a pan** (~1–3 frames over 50 ms, one
  invocation in three) that M2 could not attribute to library work; see
  `M2-FINDINGS` §4 before treating a red `longFrames` bound as an M3 regression.
- **The tree's indentation/formatting is Prettier's**, `docs/M*-FINDINGS.md` is
  formatted, and `docs/PLAN.md` is deliberately excluded. Run `pnpm format` before
  committing; `format:check` is part of `pnpm check`.
- **`h.OnPointerDown`/`OnKeyDown` have no propagation option.** Propagation is
  decided by inspecting `event.target` (`runtime/domTarget.ts`), and Scene builds
  simulated targets from attributes only, so guards match the class **or** the data
  attribute.

## Verification and definition of done

```sh
pkill -f vite              # a stale preview owns 4173
pnpm build                 # flow → example → benchmark (before check: dist types)
pnpm check                 # typecheck, Enfect lint, Prettier, unit tests
pnpm bench                 # Playwright: every proof + both gate tests
```

M3 is done when:

- `Flow.fitViewport` exists as a pure, tested helper and `Controls`' fit button
  moves the viewport to it (proved in a browser, with the viewport transform read
  before and after);
- zoom controls stop at the engine's bounds, and `minZoom`/`maxZoom` have exactly
  one source of truth;
- a `Background` pattern moves with the viewport (proved by reading the rendered
  style/transform at two viewports), and there is no upstream CSS or visual
  identity in `packages/flow/style`;
- `MiniMap` renders the graph and the viewport rectangle from the Model, is opt-in
  if it costs frames, and does not break the 1k gate;
- nodes are focusable and reachable by Tab, arrow keys nudge the focused node into
  one `MovedNodes`, and neither works from an input/`.fflow__nokey` target;
- the description region exists, lists nodes and their connections, and updates at
  commit rate rather than per frame;
- `pnpm check`, `pnpm build` and `pnpm bench` are green, the gate JSON is committed
  (`packages/benchmark/results/benchmark.json`), and `docs/M3-FINDINGS.md` records
  every deviation and number from a run at the commit that carries it.

## Open design questions for M3

- **Chrome as `RendererConfig` flags or as consumer-composed helpers?** The plan's DOM
  sketch puts `.fflow__controls` and `.fflow__minimap` inside the renderer's output,
  which implies flags (`controls?: boolean`, `minimap?`) and library-owned Messages.
  The alternative is attribute bundles like `DragAndDrop`'s, which keeps the parent
  in charge of the markup but puts the pane's `NoPan` rules on the consumer. §3.3's
  sketch is the tie-breaker unless a session finds a reason it cannot work.
- **Messages or helpers for zoom/fit?** `Flow.zoomBy`/`setViewport` exist as helpers
  the parent folds from its own update. A library-rendered control needs a Message
  (`ClickedZoomIn`, `ClickedFitView`) handled in `update`. Adding those variants
  makes the demo and benchmark `match` sites handle them, which is the §M2 pattern.
- **Does `Background` need the Model at all?** A CSS background positioned by
  `viewport.x/y` and sized by `zoom` needs no graph access; drawing it as elements
  would put it in every frame's diff. Prefer the CSS route and prove it moves.
- **Is `MiniMap` interactive in M3?** Click-to-center and drag-to-pan are a new
  gesture surface with its own pointer identity and `NoPan` requirements. Display-only
  is a defensible M3 scope if the interaction is named as M4.
- **What does the minimap draw at 1k culled nodes?** Every node rectangle, or only
  the visible ones? The minimap's purpose (orientation) argues for all of them, and
  the gate argues for memoization keyed on `nodes`/`nodeSizes`.
- **Where does focus live?** DOM focus plus `OnKeyDownFocus` needs no Model state;
  a nudged node needs to know what is focused, which the DOM answers at event time.
  A `focusedNodeId` in the Model only earns its place if something has to render
  differently.
- **What is a node's accessible name?** `node.data` is the parent's, and the flow
  cannot read into it. A `RendererConfig` hook (`accessibleName?: (node) => string`)
  or a convention on the wrapper are the two options; pick one and document it, or
  the tab order will read as "div" to a screen reader.
- **How much of `visibleRegion` does the minimap want?** It needs the plain pane
  rectangle; introducing `viewportRect` should not duplicate the overscan rule.

## Working agreements

- Do not edit `docs/PLAN.md` wholesale. Put deviations and proposed diffs in
  `docs/M3-FINDINGS.md`, as M0, M1 and M2 did.
- Do not import `@xyflow/react` or `@xyflow/svelte` outside `packages/benchmark`.
- Do not copy upstream CSS or add an attribution component.
- Do not amend `c40ae47`, `a0a3fdc`, `898bb46` or the M2 commits; commit at logical
  checkpoints; ask before force-pushing or rewriting history. No network install
  beyond npm without asking.
- Every claim in the findings document must come from a run at the commit that
  carries it, and stale figures must be labelled historical (`M1-FINDINGS` §12).
