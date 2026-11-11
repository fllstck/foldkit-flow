# @fllstck/foldkit-flow

A flow / node-graph canvas for [Foldkit](https://foldkit.dev), in the spirit of
React Flow and Svelte Flow — but Foldkit-native: one Model, pure `update`, every
effect at a named seam.

**Status: M2 complete.** The plan is at revision 7, and v0.1 (M0–M2) ships here.
The interaction core (drag, select, delete, connect, reconnect), measured handle
geometry for both hit-testing and edge endpoints, the `isValidConnection`
predicate, viewport culling, the renderer node cache, and the performance gate are
green: 625 nodes at parity with React Flow on pan, and 1k culled under the 33 ms
p95 gate. Evidence, deviations, and the retracted measurements are in
**[docs/M1-FINDINGS.md](docs/M1-FINDINGS.md)** and
**[docs/M2-FINDINGS.md](docs/M2-FINDINGS.md)**. Start with:

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

The full browser suite is the frame gate and takes ~1.8 min: 3 libraries × 11
cold loads of the 625-node fixture, then 11 of the 1k fixture, one worker at a
time because the measured quantity is a frame-time distribution. Run the files
you touched instead, and save the whole suite for a change to the render path:

```sh
pkill -f vite   # a preview left running owns port 4173 and the run fails on it

cd packages/benchmark
pnpm exec playwright test tests/connection.spec.ts   # 4 connection proofs, ~4 s
pnpm exec playwright test tests/interaction.spec.ts  # pointer layer, ~8 s
pnpm exec playwright test --grep "1000-node"         # the 1k gate alone, ~26 s
pnpm exec playwright test tests/bench.spec.ts        # both gate tests, ~1.5 min
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
