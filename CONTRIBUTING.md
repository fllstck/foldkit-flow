# Contributing

How this repository is built, tested and measured. The behavioural contract is in
[`docs/CONTRACT.md`](docs/CONTRACT.md); the design is in [`docs/PLAN.md`](docs/PLAN.md).

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

**Examples** live on the same server as the two pages above: `/examples/` is an
index generated from `packages/example/src/examples/registry.ts`, and
`/examples/<name>/` is one small flow — minimal, custom nodes, resizing, edge types,
connection policy, collapsing a subtree, fit and zoom — with its own source beside
it (`?raw`, so the file shown is the file that ran) and the shared wiring in a
second tab. The trailing slash is required on a static host, for the same reason
`/example/` is: the unslashed path falls back to `/`'s document.

### The fast loop

The full browser suite is the frame gate and takes ~4.9 min (56 tests): 3
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
