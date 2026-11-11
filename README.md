# @fllstck/foldkit-flow

A flow / node-graph canvas for [Foldkit](https://foldkit.dev), in the spirit of
React Flow and Svelte Flow — but Foldkit-native: one Model, pure `update`, every
effect at a named seam.

**Status: M3 complete, M4 next.** The plan is at revision 7; v0.1 shipped at M2,
and v1.0 runs to M5. M3 added our own chrome (`Background`, `Controls`,
`MiniMap`, `Panel`) and the accessibility layer (focusable nodes, arrow-key
nudging, the description region) on top of the interaction core (drag, select,
delete, connect, reconnect), measured handle geometry, `isValidConnection`,
viewport culling, and the renderer node cache. The gate is unchanged and still
green: 625 nodes at parity with React Flow on pan, and 1k culled under the 33 ms
p95 gate — including with all of M3's chrome on. Evidence, deviations, and the
retracted measurements are in
**[docs/M0-FINDINGS.md](docs/M0-FINDINGS.md)**,
**[docs/M1-FINDINGS.md](docs/M1-FINDINGS.md)**,
**[docs/M2-FINDINGS.md](docs/M2-FINDINGS.md)** and
**[docs/M3-FINDINGS.md](docs/M3-FINDINGS.md)**. Start with:

- **[docs/PLAN.md](docs/PLAN.md)** — the design: ownership split, public API, runtime
  wiring, performance budget, milestones, decisions.
- **[docs/xyflow-internals.md](docs/xyflow-internals.md)** — how React Flow and
  Svelte Flow are actually built (`@xyflow/system`, the store, controlled state,
  the handle DOM contract), with sources.
- **[docs/foldkit-constraints.md](docs/foldkit-constraints.md)** — what Foldkit
  requires of a third-party integration, read from `foldkit@0.170.0` and its
  examples.
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

### The fast loop

The full browser suite is the frame gate and takes ~2.5 min: 3 libraries × 11
cold loads of the 625-node fixture, then 11 of the 1k fixture, then 11 of the same
fixture with M3's chrome on, one worker at a time because the measured quantity is
a frame-time distribution. Run the files you touched instead, and save the whole
suite for a change to the render path:

```sh
pkill -f vite   # a preview left running owns port 4173 and the run fails on it

cd packages/benchmark
pnpm exec playwright test tests/chrome.spec.ts       # chrome + a11y proofs, ~9 s
pnpm exec playwright test tests/connection.spec.ts   # 5 connection proofs, ~5 s
pnpm exec playwright test tests/interaction.spec.ts  # pointer layer, ~9 s
pnpm exec playwright test --grep "1000-node"         # both 1k gates, ~53 s
pnpm exec playwright test tests/bench.spec.ts        # every gate test, ~2.1 min
```

Playwright starts the two preview servers itself (`reuseExistingServer`), so a
targeted run costs a few seconds of server boot on top of the test.

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

A gesture may start at either kind of handle: the preview leaves the one the user
grabbed, but the fact is oriented by handle type, so `ConnectedHandles.source` is
always the `Source` handle and `target` always the `Target` one — dragging a
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

| Piece        | What it is                                                                                                                          | Cost it opts into                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `background` | dots or lines, one CSS `background-image` whose position and size follow the viewport transform                                     | two style properties per viewport frame, no elements                    |
| `controls`   | zoom in / zoom out / fit buttons, dispatching `ClickedZoomIn`, `ClickedZoomOut`, `ClickedFitView`                                   | three buttons; all three messages route to `zoomBy`/`setViewport`       |
| `minimap`    | every node as a `<rect>` in a `viewBox` of the graph's bounds, plus the pane's rectangle in flow space                              | one memoized `<g>` of `nodes.length` rects, rebuilt only when nodes move |
| `panel(...)` | a positioned container for your own chrome, threaded through `ViewInput.panel` so its markup stays in your boundary and its buttons dispatch your messages | nothing beyond your markup                                              |

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
would rather animate the fit yourself.

**Zoom bounds have one source of truth.** `Model.minZoom`/`maxZoom` are seeded by
`init(viewport, { minZoom, maxZoom })`, passed to the pan/zoom engine as its
`scaleExtent`, and enforced once in `setViewport`. At a bound a control press
changes nothing and dispatches nothing — the Model never holds a zoom the engine
would refuse. (`RendererConfig.minZoom`/`maxZoom` used to be declared and were
never read; they are gone.)

`Flow.viewportRect(model)` is the pane's box in flow space with no overscan.
`Flow.visibleRegion` is that box plus one screen on each side — culling's buffer,
which is exactly what a minimap must **not** draw as the viewport rectangle.

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

What you have to supply: `accessibleName`, and the same `flow.css`. A node without
it is announced by its id. If a node contains controls, mark the ones that must not
trigger the flow's keyboard with `fflow__nokey` (delete, escape, and nudging all
read that class) and the ones that must not zoom with `fflow__nowheel`.
