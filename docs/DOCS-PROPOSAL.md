# A documentation site for `@fllstck/foldkit-flow`

A proposal, not a milestone. Written after reading reactflow.dev on 2026-11-12
(`/learn`, `/examples`, `/examples/nodes/custom-node`) and comparing it with what
this repository already has. Nothing here is scheduled, nothing here is built, and
the point of writing it down is that the next session can pick a slice without
re-doing the reading.

## What React Flow's docs actually are

Five top-level sections, and they are separable — this matters, because the cheap
ones are cheap on their own:

| Section        | Shape                                                                                                                                                                                                                                                                                                                                                       | Volume |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Learn**      | Quick Start, Core Concepts (overview, building a flow, adding interactivity, the viewport), Customization (nodes, handles, edges, edge labels, utility classes, theming), Layouting, Advanced Use (hooks, accessibility, testing, TypeScript, uncontrolled flow, performance, state management, SSR, devtools, …), Tutorials, Troubleshooting, Migrations | dozens of pages |
| **Reference**  | One page per component, hook, type and util, mirroring the exported surface: two top-level components, then components, hooks, types, utils as separate lists                                                                                                                                                                                                | one page per export |
| **Examples**   | A category grid (Nodes, Edges, Interaction, Subflows & Grouping, Layout, Styling, Whiteboard, Misc), each entry a page: one-paragraph explanation, a **live demo**, and a **tabbed source viewer** (App.jsx / styles.css / index.html), with prev/next links                                                                                                  | over 60 examples, 16 marked Pro |
| **UI**         | shadcn-installable components (Base Node, Base Edge, Labeled Handle, …)                                                                                                                                                                                                                                                                                      | ~20 components |
| **Showcase / Changelog / Playground** | Case studies, release notes, a no-code playground                                                                                                                                                                                                                                                                                    | — |

The example page format is the part worth copying exactly: **prose → live demo →
the source of that demo, one tab per file**. Their explanation is one sentence plus
a link into the Learn page for the concept, and the demo is the same component the
source shows.

## What we already have

Nothing has to start from zero; three of their five sections have a working
equivalent here, just not shaped like docs.

| Their section | Our equivalent today | Gap |
| ------------- | -------------------- | --- |
| Learn         | `README.md` (507 lines: the public contract, feature by feature), `docs/PLAN.md` (the design), `docs/verification.md` | One long page instead of a path; no per-feature pages; no tutorials |
| Examples      | `packages/example/src/example/app.ts` — one presentable page with its source via `?raw` (`/example/`); `packages/benchmark/src/gallery/*` — six fixtures rendered by us *and* React Flow, with an index at `/gallery.html` | One example, not a set; no category index; no per-feature pages |
| Reference     | `packages/flow/dist/index.d.ts` + the JSDoc in `src/**` | No generated page; the contract is prose in the README |
| UI            | `packages/flow/style/flow.css` (`fflow__` prefix) | Deliberately no component library (§2.4: our own visual identity) |
| Showcase/Changelog | `docs/BENCHMARKS.md`, the M0–M5 findings, `CHANGELOG.md` (not yet — see `M5-FINDINGS` §7.1) | — |

## Slice 1 — shipped (2026-11-12)

`/examples/` and `/examples/<name>/` exist and are proved by
`packages/benchmark/tests/examples.spec.ts`. Seven examples, one file each:

| Route                  | Category    | What it is |
| ---------------------- | ----------- | ---------- |
| `minimal`              | Basics      | three nodes, two edges, no chrome |
| `custom-nodes`         | Nodes       | the consumer's own markup through `renderNode` and `tools.handle` |
| `resizing`             | Nodes       | `resize: true`, `ResizedNodes` persisted, the content-fills-box line |
| `edge-types`           | Edges       | Bezier / Step / SmoothStep / Straight, a label and a marker |
| `connection-policy`    | Interaction | `isValidConnection` refusing a cycle, derived from the example's own edges |
| `collapse`             | Sub-flows   | `hidden` on a container's *children*; the frame stays, its contents go |
| `fit-and-zoom`         | Viewport    | the fit folded from `ResizedPane`, and the mount-order contract behind it |

What it cost, and what it turned out to be:

- **One harness, N specs.** `packages/example/src/examples/harness.ts` is the
  Foldkit app — Model, Messages, update, `foldOutMessage`, the panel, the source
  pane — and `specs/*.ts` is data plus policy (the graph, renderer options,
  `isValidConnection`, an optional `renderNode`). A spec is 30–60 lines. The page
  shows the spec *and* the harness, because the reader needs the wiring once and
  the difference every time.
- **The source is the file.** Each spec is imported with `?raw`, so the pane on the
  right is the module that produced the graph on the left. Same trick as
  `/example/`, and the reason there is no snippet that can drift.
- **One proof for the set, driven by the index.** `tests/examples.spec.ts` reads the
  links the index offers, walks every one, and asserts each page mounts its flow,
  names itself, and lists exactly three files. It also asserts the two behaviours a
  reader would see but not report: collapse hides the children and not the frame,
  and the fit page's zoom is not the initial 1:1.
- **No router, no site generator.** `src/routes.ts` maps a pathname to one of four
  pages, used by both the client entry and the server entry, and
  `prerenderPathsFor(exampleSlugs)` gives the plugin ten paths to render. A new
  example is one module and one line in `registry.ts`.
- **The trailing slash is load-bearing.** The prerendered file is
  `examples/<name>/index.html`, so `/examples/<name>` falls back to `/`'s document
  on a static host and hydrates the playground into the example's markup — the
  misfire looks fine and does nothing. The index's links carry the slash and the
  proof asserts it (the same trap `/example` has, `M5-FINDINGS` §8).

Not built yet: slices 2 (generated reference) and 3 (Learn, regrouped). The
proposal below is unchanged for them.

## The sliced proposal

Ordered by cost, each slice independently useful. The first is cheap *because* of
machinery this repo already has.

### Slice 1 — Examples, as pages we already know how to build

Take the three patterns that exist and point them at a set of features instead of
one page:

- **Registry of examples** (`packages/example/src/examples/registry.ts`): name,
  category, one-sentence description, and the module that mounts it — the same
  shape as `src/gallery/fixtures.ts` in the benchmark.
- **One page per example, `/examples/?example=custom-nodes`** — query-driven like
  `gallery-foldkit.html?fixture=…`, so there is one Vite entry and one prerender
  path, not twenty. The example app already picks a page by `location.pathname`;
  a third branch adds `startsWith("/examples")`.
- **Source beside it, from the file itself**: `?raw` import per example module,
  exactly as `/example/` shows `app.ts` today, with a tab per file (the example's
  module, its CSS, and the shared wiring).
- **An index** at `/examples/` generated from the registry, like `/gallery.html` —
  a table of category, example, one sentence, link.

Candidate set, chosen because each is a question a reader actually asks (not a
mirror of xyflow's catalogue):

| Category    | Example              | What it shows |
| ----------- | -------------------- | ------------- |
| Basics      | `minimal`            | Model/Message/update/view in ~40 lines |
| Nodes       | `custom-nodes`       | `renderNode`, `tools.handle`, `tools.size` |
| Nodes       | `resizing`           | `resize: true`, `ResizedNodes`, the content-vs-box CSS line |
| Edges       | `edge-types`         | Bezier / Step / SmoothStep / Straight, markers, labels |
| Edges       | `connection-policy`  | `isValidConnection`, a rejected release, consumer feedback |
| Sub-flows   | `collapse`           | `hidden` on a container vs its children (the corrected lesson) |
| Viewport    | `fit-and-zoom`       | `fitViewport`, `setViewport`, zoom bounds, the mount-order contract |
| Interaction | `keyboard-and-a11y`  | nudge, activation, the description region, `fflow__nokey` |
| Data        | `parent-owned-graph` | `foldOutMessage` for every fact, one place |

Cost: one registry, one page module, one index, nine small app modules reused from
what the example page and the demo already do. **A proof that every example
mounts and paints** (one Playwright test that loops the registry and asserts nodes
exist) keeps the set from rotting — the same discipline as the gallery's index test.

### Slice 2 — A generated reference

`typedoc` with `typedoc-plugin-markdown` over `packages/flow/dist/index.d.ts`,
committing the markdown to `docs/reference/`. The public surface is already
documented in JSDoc, so this is generation plus a config, not writing. It needs two
new devDependencies — a network install, so it waits for an explicit yes.

Risk: generated output is noisy unless `@category` tags are added. Worth doing only
if the README keeps being the contract and the reference is the lookup table.

### Slice 3 — Learn, regrouped

Split `README.md`'s sections into a path: Quick start → Concepts (the Model owns
the graph; measurement is DOM truth; gestures are Messages) → Customization →
Advanced (perf, SSR, a11y) → Troubleshooting (the six boundaries in
`verification.md`, as "what a wrong layer looks like"). Mostly moving text, but
every moved paragraph has to stay true, so it wants the same review the findings
documents get. Deferred until slices 1 and 2 exist.

## The three decisions this needs

1. **In-app pages, not a site generator.** Slices 1 is Vite entries in a package
   that already builds and prerenders; a separate docs framework (VitePress,
   Astro) would be a second build, a second deploy and a second set of versions to
   keep honest. The recommendation is to stay inside `packages/example` until
   something forces a site.
2. **Examples are code that runs, or they do not exist.** The `?raw` trick is the
   rule, not a convenience: a pasted snippet in a page is a claim that nothing
   verifies, and this project has spent five milestones learning what unverified
   claims cost (`docs/verification.md`).
3. **No copy of xyflow's catalogue.** Their examples answer their API's questions.
   Ours should answer ours — the table above is deliberately nine, not sixty.

## Not proposed

- A UI component library (§2.4: our own visual identity, no attribution
  component).
- A Pro tier, a playground, case studies.
- Anything on the M6 list: a docs site is not research into `XYResizer`.
