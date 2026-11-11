# @fllstck/foldkit-flow

A flow / node-graph canvas for [Foldkit](https://foldkit.dev), in the spirit of
React Flow and Svelte Flow — but Foldkit-native: one Model, pure `update`, every
effect at a named seam.

**Status: M0 complete.** The plan is at revision 7; the six M0 proofs and the 625-node
benchmark are green. Evidence and deviations are in
**[docs/M0-FINDINGS.md](docs/M0-FINDINGS.md)**; the next milestone is M1
(`docs/PLAN.md` §7). Start with:

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

`@enfect/oxlint`'s recommended Effect rules apply to `packages/*/src`; the
incompatible rules and the reasons for each exception are documented in
`oxlint.config.ts`. Playwright harnesses are plain browser drivers and are linted
with the smaller `oxlint.tests.json` ruleset. Prettier owns formatting for the
workspace sources, package manifests, and the M0 docs; `docs/PLAN.md` and the
critique history are deliberately excluded in `.prettierignore`.
