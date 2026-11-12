# @fllstck/foldkit-flow

A flow / node-graph canvas for [Foldkit](https://foldkit.dev), in the spirit of
React Flow and Svelte Flow — but Foldkit-native: one Model, pure `update`, every
effect at a named seam.

**Status: M5 complete — v1.0, hardened and publishable; M6 next.** M5 is the
hardening milestone (`docs/PLAN.md` §7): the culling scan is indexed, the numbers are
measured and published, the fixture gallery compares our geometry to React Flow's on
one input, `packages/flow` is publishable at `1.0.0` (**not published** — that is the
owner's call), and `packages/example` serves a presentable example page beside the
instrumented playground. **The published numbers are in
[docs/BENCHMARKS.md](docs/BENCHMARKS.md)**: 625 nodes at parity with React Flow on
pan (16.7/16.8 both, zero long frames), 1k culled inside the 33 ms p95 gate bare and
with the chrome on, a 10k graph with 98 % collapsed panning at the frame rate with
200 nodes in the DOM, and 10k **expanded** panning at the frame rate too — with a
~1.3 s settle before the first interaction, which is the ceiling `BENCHMARKS.md`
states. The eleven gaps M4 left — `XYResizer`, minimap drag, edge selection,
`nodeOrigin` and the rest — are untouched and remain **M6, research first**
(`docs/PLAN.md` §7, `docs/M6-HANDOFF.md`).

Evidence: **[docs/M5-FINDINGS.md](docs/M5-FINDINGS.md)** (what M5 changed, with
before/after), **[docs/BENCHMARKS.md](docs/BENCHMARKS.md)** (the numbers, the
protocol, the machine, the reproduction command), and the milestone records
**[docs/M0-FINDINGS.md](docs/M0-FINDINGS.md)**,
**[docs/M1-FINDINGS.md](docs/M1-FINDINGS.md)**,
**[docs/M2-FINDINGS.md](docs/M2-FINDINGS.md)**,
**[docs/M3-FINDINGS.md](docs/M3-FINDINGS.md)**,
**[docs/M4-FINDINGS.md](docs/M4-FINDINGS.md)**. Start with:

- **[docs/BENCHMARKS.md](docs/BENCHMARKS.md)** — what this costs: the gate, the
  culling scan before and after, the 10k escape hatch and ceiling, the scoped
  start-of-pan stall, and how to reproduce every figure.
- **[docs/PLAN.md](docs/PLAN.md)** — the design: ownership split, public API, runtime
  wiring, performance budget, milestones, decisions.
- **[docs/M5-FINDINGS.md](docs/M5-FINDINGS.md)** — what M5 changed: the scan index
  with its before/after, the 10k expanded ceiling, the gallery and its one
  documented divergence, the publish-readiness checklist, and the two traps the
  example page paid for.
- **[docs/M6-HANDOFF.md](docs/M6-HANDOFF.md)** — what M6 inherits: the eleven gaps
  as M5 left them, the research method the plan makes binding, and the new
  candidates M5 found (the 10k first render).
- **[docs/xyflow-internals.md](docs/xyflow-internals.md)** — how React Flow and
  Svelte Flow are actually built (`@xyflow/system`, the store, controlled state,
  the handle DOM contract), with sources.
- **[docs/foldkit-constraints.md](docs/foldkit-constraints.md)** — what Foldkit
  requires of a third-party integration, read from `foldkit@0.170.0` and its
  examples.
- **[docs/verification.md](docs/verification.md)** — the boundary rule: assert at
  the layer the user perceives. Six boundaries between the Model and the eye, each
  with the bug it produced here and the assertion that crosses it, plus a five
  question checklist for a visual feature.
- **[docs/IMPLICIT-STATE-AUDIT.md](docs/IMPLICIT-STATE-AUDIT.md)** — an audit of the
  mutable state outside `Flow.Model.gesture` (renderer caches, memos, Mounts,
  observers, the host registry), with the response in
  `docs/M4-FINDINGS.md` §15. It and `verification.md` are complementary: one looks
  at lifetime, the other at the layer.
- **[docs/M0-FINDINGS.md](docs/M0-FINDINGS.md)** — what M0 proved, the benchmark
  numbers, what needed workarounds, and proposed `docs/PLAN.md` diffs.
- **[docs/M0-REVIEW.md](docs/M0-REVIEW.md)** — the independent M0 review.
- **[docs/M1-HANDOFF.md](docs/M1-HANDOFF.md)** — the starting state and task list
  for M1.
- **[docs/M1-FINDINGS.md](docs/M1-FINDINGS.md)** — what M1 shipped, the gate
  numbers, the diffs from the plan, and the bugs the proofs found.
- **[docs/M2-HANDOFF.md](docs/M2-HANDOFF.md)** — what M2 inherited, its scope, and
  the gotchas the next session should not re-learn.
- **[docs/M2-FINDINGS.md](docs/M2-FINDINGS.md)** — what M2 shipped, the decisions
  it took, and the proofs that back them.
- **[docs/M3-HANDOFF.md](docs/M3-HANDOFF.md)** — what M3 inherited, the chrome and
  a11y scope, and the three gaps it had to close first.
- **[docs/M3-FINDINGS.md](docs/M3-FINDINGS.md)** — what M3 shipped, the stacking
  bug its own CSS introduced, the a11y contract, and the gate numbers with chrome
  on.
- **[docs/M4-HANDOFF.md](docs/M4-HANDOFF.md)** — what M4 inherited, the graph-feature
  scope (sub-flows, resizing, snap, fitView options, edge types, `hidden`
  collapsing), and the traps M3's follow-ups cost.
- **[docs/M5-HANDOFF.md](docs/M5-HANDOFF.md)** — what M5 inherited: the hardening and
  publishing scope (index the culling scan, publish the 1k/10k numbers, settle the
  pan stall, the fixture gallery, package docs, the example page), and the M6 list
  it must not pre-empt. Its outcome is `docs/M5-FINDINGS.md`.

Decisions locked: package `@fllstck/foldkit-flow`; MIT; our own CSS and visual
identity (no upstream stylesheet, no attribution component); Foldkit-native API
only, no `NodeChange` interop; performance gate is parity with React Flow on
xyflow's 625-node stress fixture; **v0.1 = M0–M2**, **v1.0** adds sub-flows,
resizing, minimap, and edge types.

Short version: build on `@xyflow/system` for geometry and pan/zoom, render the
graph with Foldkit's own `view`, keep nodes and edges owned by the parent app, and
report interactions as Messages and OutMessages — never a store, never two-way
binding.

## Development

```sh
pnpm install
pnpm check        # typecheck + lint + format check + unit tests
pnpm build        # library, demo, benchmark
```

Individual commands:

```sh
pnpm typecheck
pnpm lint         # @enfect/oxlint for domain code, base oxlint for tests
pnpm format       # Prettier, configured in .prettierrc.json
pnpm format:check
pnpm --filter @fllstck/foldkit-flow-benchmark exec playwright test
```

`pnpm check` typechecks `packages/example` and `packages/benchmark` against the
library's `dist/*.d.ts`, so run `pnpm build` first after changing the library's
public surface.

If the demo shows **"This page could not start safely"**, that is Foldkit's
build-skew guard, not an application error: the served HTML's
`data-foldkit-build` stamp and the build id in the client bundle came from
different builds, which is what a cached page plus a fresh `dist` looks like. Stop
every server (`pkill -f vite`), `pnpm build`, serve again, and hard-reload — a
reload alone cannot help if the server keeps handing out the older HTML.

### The pages

`pnpm dev` serves two pages from one build: `/` is the instrumented 630-node
playground (the fixture every browser proof reads) and `/example/` is a presentable
release pipeline — custom nodes, a frame with children, a consumer panel, connect,
resize, collapse — with its own source shown beside it. The source is the file
itself (`app.ts?raw`), so the page and its code cannot drift. The trailing slash
matters: a static host serves the prerendered page at `/example/`, while
`/example` falls back to the playground's HTML.

`pnpm benchmark` serves the measurement pages: `/foldkit.html`, `/react.html`,
`/svelte.html` (the 625 comparison), `/large.html` and `/large-chrome.html` (1k,
culled and with chrome), `/subflow.html`, `/large-hidden.html` (10k collapsed),
`/large-expanded.html` (10k expanded), and the fixture gallery:
**`/gallery.html`** is its index — one row per fixture with a link into both
libraries and into each "feature off" state — and the pages themselves are
`/gallery-foldkit.html?fixture=edge-types` and
`/gallery-react.html?fixture=edge-types` (any of `edge-types`, `labels`, `markers`,
`subflow`, `hidden`, `resize`, `fitview`, with `&variant=off` for the paint
comparison). The index is built from `src/gallery/fixtures.ts`, so it cannot list a
fixture that does not exist and cannot miss one that does.

### The fast loop

The full browser suite is the frame gate and takes ~4.9 min (55 tests): 3
libraries × 11 cold loads of the 625-node fixture, then 11 of the 1k fixture, then
11 of the same fixture with M3's chrome on, plus the 10k explorations, the gallery
and the pan-stall diagnostic — one worker at a time, because the measured quantity
is a frame-time distribution. Run the files you touched instead, and save the whole
suite for a change to the render path:

```sh
pkill -f vite   # a preview left running owns port 4173 and the run fails on it
cd packages/benchmark
pnpm exec playwright test tests/chrome.spec.ts       # chrome + a11y proofs, ~9 s
pnpm exec playwright test tests/connection.spec.ts   # 5 connection proofs, ~5 s
pnpm exec playwright test tests/interaction.spec.ts  # pointer layer, ~9 s
pnpm exec playwright test tests/m4.spec.ts           # graph features, ~11 s
pnpm exec playwright test tests/hidden.spec.ts       # the 10k exploration, ~9 s
pnpm exec playwright test tests/expanded.spec.ts     # the 10k ceiling, ~20 s
pnpm exec playwright test tests/gallery.spec.ts      # the React Flow gallery, ~12 s
pnpm exec playwright test tests/stall.spec.ts        # the pan-stall diagnostic, ~55 s
pnpm exec playwright test tests/churn.spec.ts        # heap after 1,000 create/delete cycles, ~25 s
pnpm exec playwright test --grep "1000-node"         # both 1k gates, ~53 s
pnpm exec playwright test tests/bench.spec.ts        # every gate test, ~2.1 min
```

Playwright starts the two preview servers itself (`reuseExistingServer`), so a
targeted run costs a few seconds of server boot on top of the test.

Run `pnpm build` (all three packages) first when the change was to the library's CSS
or its public surface: the benchmark bundle inlines `@fllstck/foldkit-flow/style.css`
at its **own** build time, so a stale benchmark build serves the previous stylesheet
and makes fixed code look broken. That cost an hour at M4 (`docs/verification.md`,
rule 4).

`@enfect/oxlint`'s recommended Effect rules apply to `packages/*/src`; the
incompatible rules and the reasons for each exception are documented in
`oxlint.config.ts`. Playwright harnesses are plain browser drivers and are linted
with the smaller `oxlint.tests.json` ruleset. Prettier owns formatting for the
workspace sources, package manifests, and the M0 docs; `docs/PLAN.md` and the
critique history are deliberately excluded in `.prettierignore`.

## Measuring the graph

Handles are geometry, and geometry is DOM truth: it is measured in the node Mount
and stored node-local in the Model (`HandleBounds`), never read from `view`. The
contract a consumer has to act on is three sentences (`docs/PLAN.md` §2.5.3):

1. While a node's DOM changes through the renderer — its content, its handles,
   styles it applies itself — geometry stays fresh automatically, because a
   `ResizeObserver` watches the node and a `MutationObserver` watches its subtree,
   coalesced to one measurement per animation frame.
2. If **external CSS** changes layout without producing either event (a class on an
   ancestor, a theme swap, a CSS-variable change), call
   `Flow.remeasure(paneId, nodeIds)`.
3. Until you do, hit-testing is still correct — every connection gesture starts with
   a `MeasureHandles` checkpoint — but **edge endpoints may point at the old handle
   position**.

```ts
// after a theme swap that moved one node's handles
Flow.Remeasure(paneId, ["a"]);

// every visible node. There is no implicit "measure everything" overload: the cost
// is one getBoundingClientRect per node plus two querySelectorAll passes.
Flow.Remeasure(
  paneId,
  Flow.visibleNodes(model.flow, nodes).map((node) => node.id),
);
```

`Flow.Remeasure` is the same `MeasureHandles` Command under a public name, so it
inherits merge semantics: measuring a subset replaces only those nodes' bounds, and
a node it was asked about but could not find is pruned instead of being kept stale.
Return the Command through the parent's dispatcher, as the demo's **Remeasure**
button does.

## Connections

Connect by dragging a handle, reconnect by dragging an edge end. Both are
gestures in `Flow.update` against measured geometry, and both report a fact the
parent applies:

| Gesture                                                                | OutMessage                                 |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| `StartedConnection`, `MovedPointer`, `ReleasedPointer`                 | `ConnectedHandles({ source, target })`     |
| `StartedReconnect` (from an edge end's grab handle), `ReleasedPointer` | `ReconnectedEdge({ edgeId, end, handle })` |
| `CancelledGesture` (pointercancel, blur, Escape)                       | nothing — the parent's edge is untouched   |

A gesture may start at either kind of handle, and a release lands if it is within
`Flow.connectionRadius` (20 screen pixels) of a handle rather than exactly on its
box — a handle is about 7px on screen, and "drop it on the node" is what people
do. The preview leaves the handle the user grabbed, but the fact is oriented by
handle type, so `ConnectedHandles.source` is always the `Source` handle and
`target` always the `Target` one — dragging a
target handle onto a source handle produces the same `n1 → n2` edge the other
direction does, and the predicate sees it that way round too.

`Flow.Context` may carry the parent's policy, which `update` evaluates on release:

```ts
const contextFrom = (model: Model): Flow.Context => ({
  nodes: model.graph.nodes,
  edges: model.graph.edges,
  // Asked with { source, target, sourceHandle, targetHandle }. A rejected
  // release emits no OutMessage, so there is nothing for the parent to undo.
  isValidConnection: (connection) => !wouldCreateCycle(model.graph, connection),
});
```

The predicate is asked at release only — hover still previews the target — and it
judges a reconnect as well, with the end that did not move supplying the other
half of the connection. No predicate means "accept everything".

Because a rejection is silent by design (no OutMessage, nothing to undo), the
consumer is where the feedback belongs: the demo reads the hovered candidate from
`model.flow.gesture` and shows it, so a duplicate reads as "rejected" rather than
as a broken gesture. The library's own `data-connection-target` instrumentation on
the pane is available for the same purpose.

Edge endpoints come from measured handles: `edge.sourceHandle` /
`edge.targetHandle` name the handle, the path starts and ends at the handle's
centre, and it leaves along the handle's own `position`. An edge that names no
handle uses the node's first handle of that type; a handle that is unmeasured or
missing falls back to the node-border anchor, so an edge never disappears because
measurement has not landed yet.

## Chrome

Chrome is ours: `packages/flow/style/flow.css` is written from scratch against the
`fflow__` prefix, and no upstream stylesheet or visual component is imported
(`docs/PLAN.md` §2.4). Every piece of it is off by default and opt-in through
`createRenderer`:

```ts
const renderer = Flow.createRenderer({
  paneId: "main-flow",
  renderNode,
  background: { variant: "dots" }, // or { variant: "lines", gap: 30 }
  controls: true, // zoom in, zoom out, fit
  minimap: true, // every node + the viewport rectangle
  accessibleName: (node) => node.data.label, // a11y; see below
});
```

| Piece        | What it is                                                                                                                                                 | Cost it opts into                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `background` | dots or lines, one CSS `background-image` whose position and size follow the viewport transform                                                            | two style properties per viewport frame, no elements                     |
| `controls`   | zoom in / zoom out / fit buttons, dispatching `ClickedZoomIn`, `ClickedZoomOut`, `ClickedFitView`                                                          | three buttons; all three messages route to `zoomBy`/`setViewport`        |
| `minimap`    | every node as a `<rect>` in a `viewBox` of the graph's bounds, plus the pane's rectangle in flow space                                                     | one memoized `<g>` of `nodes.length` rects, rebuilt only when nodes move |
| `panel(...)` | a positioned container for your own chrome, threaded through `ViewInput.panel` so its markup stays in your boundary and its buttons dispatch your messages | nothing beyond your markup                                               |

The pattern is transform-aware without being inside the transform: the background
element is a sibling of `.fflow__viewport`, so the content's `scale()` cannot
double-apply the zoom. Its `background-position` is the viewport's `x`/`y` and its
`background-size` is `gap × zoom`, which is what makes it pan and zoom with the
graph while the dots stay one pixel.

Everything above the viewport is a press target inside the pane, so chrome carries
`fflow__nopan` (the pane's d3 filter skips it, and `closest` covers its children)
and `data-fflow-chrome` (the pane's own handler declines it, so a control press
never clears the selection). A consumer panel built by hand needs both; `panel(...)`
adds them for you.

**`Flow.fitViewport(model, nodes, padding?)`** is the pure helper behind the fit
button: `getViewportForBounds` over `nodeBounds`, clamped by the Model's zoom
bounds, returning the current viewport unchanged for an empty graph or an
unmeasured pane. Call it from your own `update` and fold `setViewport` if you
would rather animate the fit yourself. The usual place for the first fit is
`ResizedPane`, and that works because the pane's `MountedPane` always arrives
**first**: `Flow.setViewport` needs the pane id that Message folds, and a viewport
committed without it would be one the engine never received — the next pan would
then apply its delta to the engine's older transform (`docs/M5-FINDINGS.md` §8.2).

**Zoom bounds have one source of truth.** `Model.minZoom`/`maxZoom` are seeded by
`init(viewport, { minZoom, maxZoom })`, passed to the pan/zoom engine as its
`scaleExtent`, and enforced once in `setViewport`. At a bound a control press
changes nothing and dispatches nothing — the Model never holds a zoom the engine
would refuse. (`RendererConfig.minZoom`/`maxZoom` used to be declared and were
never read; they are gone.)

`Flow.viewportRect(model)` is the pane's box in flow space with no overscan.
`Flow.visibleRegion` is that box plus one screen on each side — culling's buffer,
which is exactly what a minimap must **not** draw as the viewport rectangle.

## Graph features

The M4 surface. Everything here is opt-in per renderer, and the `M4-FINDINGS.md`
sections named beside each item hold the reasoning and the proofs.

### Sub-flows: a child's position is relative to its parent

```ts
const nodes: FlowNode<Data>[] = [
  {
    id: "group",
    position: { x: 100, y: 100 },
    data,
    size: { width: 420, height: 300 },
  },
  { id: "child", position: { x: 20, y: 60 }, parentId: "group", data },
];
```

One rule, one place: `Flow.positionIndex(nodes)` resolves the parent chain to
absolute flow positions, and every position-derived helper reads it —
`nodeRect`, `nodeBounds`, `visibleNodes`, `visibleEdges`, the edge anchors,
hit-testing, the drag overlay, the minimap, the description and `fitViewport`.
Three properties worth knowing:

- Dragging a parent moves its subtree: the child's absolute position is built from
  the parent's, so it follows the overlay and the committed move with no
  per-descendant OutMessage. `MovedNodes` reports the parent only, in the space the
  flow received it (absolute, or parent-relative for a child).
- A `parentId` that names no node resolves as absolute, and a cycle stops at the
  node the walk re-enters — a mid-edit graph draws children, it does not lose them.
- Selecting a parent and a child and dragging moves them once: a node whose
  ancestor is also dragged is dropped from the gesture's node list.

### `hidden` means collapsed

`hidden: true` on a node removes that node, **its whole subtree**, their edges,
their measurement and their selection — at any zoom, with `cull` on or off. It is
the escape hatch for very large graphs: 10,000 nodes with 98% of them collapsed
pan at the frame rate with 200 nodes in the DOM, and the same 10k graph *expanded*
also pans at the frame rate but takes ~1.3 s to settle, because its first render
happens before the pane is measured (`docs/BENCHMARKS.md` §"10k"). A collapsed node
is not fitted by `fitViewport`, not drawn in the minimap and not listed in the
description.

Collapsing from your own `update` is a graph change the flow never sees, so fold
`Flow.informGraphChanged(model, context)` in the same handler — that is what prunes
the measurement.

### Resizing

```ts
const renderer = Flow.createRenderer({ paneId, renderNode, resize: true });
```

Off by default. On, each node gets four corner controls (the edge midpoints belong
to your port handles), and the flow draws `node.size` as the node's box — so a
persisted resize survives the next render. A release emits
`OutMessage.ResizedNodes({ nodes: [{ nodeId, x, y, width, height }] })`; persist it
wherever you keep the node, and the positions come back in the space you gave
them. The gesture is a Flow gesture: pure geometry in `Flow.resizeRect`, one
`ResizedNodes` fact, and the box written as a measurement so geometry agrees with
the DOM without waiting a frame. `XYResizer` is deliberately not used
(`docs/M4-FINDINGS.md` §2.6).

The box is the flow's; filling it is yours. A node the flow draws a box for carries
`data-boxed`, and `tools.size` reports that box to `renderNode` (live, while a
resize runs), so one line of your own CSS makes the resize visible:

```css
.fflow__node[data-boxed] > .my-node-content {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
}
```

It is deliberately not a library default: a container node wants a frame with its
children inside, a leaf wants a filled box, and only you know which you have
(`docs/M4-FINDINGS.md` §14).

### Snap grid

```ts
const renderer = Flow.createRenderer({
  paneId,
  renderNode,
  snapGrid: { x: 20, y: 20 },
});
```

Optional, and it applies to exactly one thing: a drag, snapped once per pointer
event so the overlay and the released position are the same number. The grabbed
node lands on a multiple; every other dragged node keeps its offset from it. A
resize snaps its moving edge with the same rule. Arrow-key nudging is not snapped.

### `fitView` options

```ts
// your own update
Flow.setViewport(
  model,
  Flow.fitViewport(model, nodes, {
    padding: 0.2,
    maxZoom: 1, // can only tighten the Model's bounds
    nodes: (node) => selected.includes(node.id), // "fit the selection"
  }),
);

// the library's fit button
const renderer = Flow.createRenderer({
  paneId,
  renderNode,
  controls: true,
  fitView: { padding: 0.2, maxZoom: 1.25, duration: 200 },
});
```

The Model's `minZoom`/`maxZoom` remain the only clamp: an option can tighten it,
never loosen it. A filtered fit resolves positions against the whole graph and
measures only the nodes the filter keeps.

### Edge markers and labels

```ts
{ id: "e1", source: "a", target: "b", label: "yes", markerEnd: "ArrowClosed" }
```

`edge.label` renders without any configuration, as a `<text>` at the path's label
point with a halo (a background-coloured stroke under the glyphs, so no box needs
measuring). `renderEdgeLabel(edge, h)` replaces the label's _content_ at the same
point. Markers are our own glyphs (`Arrow`, `ArrowClosed`) in a `<defs>` block that
exists only when an edge asks for one, sized in user units so they scale with the
viewport. Per-edge styling is `[data-edgeid]` in your own stylesheet.

### Minimap click-to-centre

With `minimap: true`, a press inside it centres the view on the flow point under
the cursor (`ClickedMiniMap`, handled as one `setViewport`). Drag-to-pan is not in
v1.0 (`docs/M4-FINDINGS.md` §2.9), and neither is edge selection from the pointer
layer (§2.10).

## Accessibility

What the flow provides:

- **Focusable nodes.** Each node wrapper is `tabindex="0"`, `role="button"`,
  `aria-pressed` (the selection is a toggle), and named by the `accessibleName`
  hook — falling back to the node id, because the flow cannot read `node.data`.
  Tab order is the DOM's: nodes are tabbed in render order, with whatever
  focusable content you put inside them, and Tab is not trapped.
- **Arrow-key nudging.** With a node focused, arrow keys move it by
  `Flow.nudgeStep` (1) or `Flow.nudgeLargeStep` (10) with Shift, one `MovedNodes`
  OutMessage per press. The keys are ignored while the event target is an input,
  a textarea, a select, `contenteditable`, or inside `.fflow__nokey`, and the
  page does not scroll (`preventDefault`).
- **Keyboard activation.** `Enter` or `Space` on a focused node selects it, with
  the same toggle rules as a press (`Shift` adds), which is what `role="button"`
  with `aria-pressed` promises. Space is prevented on a node (it would scroll) and
  left alone everywhere else, so `Enter` on a focused control button still clicks
  it.
- **A description region.** A visually hidden `role="region"` listing the summary,
  each node, and its incoming and outgoing connections — 50 nodes and 6
  connections per node, with a count of what is omitted. It is **not** a live
  region: it describes the graph and is memoized on `nodes`/`edges`, so a pan or a
  drag produces no DOM work in it. It sits beside the viewport, outside the
  transform.
- **The minimap is `aria-hidden`** — it is a picture of what the description says
  in words.

**Selectors.** The flow's per-node instrumentation is `data-nodeid`, and it is on
the handles and the four resize controls too — a node is
`.fflow__node[data-nodeid="…"]`, and a loose `[data-nodeid]` query returns seven
elements per node. Edges are `[data-edgeid]`; the viewport is
`[data-fflow-viewport]`.

What you have to supply: `accessibleName`, and the same `flow.css`. A node without
it is announced by its id. If a node contains controls, mark the ones that must not
trigger the flow's keyboard with `fflow__nokey` (delete, escape, and nudging all
read that class) and the ones that must not zoom with `fflow__nowheel`.
