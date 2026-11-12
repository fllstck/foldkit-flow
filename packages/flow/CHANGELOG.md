# Changelog

All notable changes to `@fllstck/foldkit-flow` are recorded here. Paths name files in
the repository this package is built from, the way the README does — a tarball has no
tree around it to link into. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versioning is
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with one deliberate
exception: `1.0.0` waits until the library has had real use, so the pre-1.0 series
carries a surface meant to hold still and a version that says what it is.

## [Unreleased]

M6 — the deliberate gaps, researched first (`docs/M6-RESEARCH.md` is the decision,
`docs/M6-FINDINGS.md` the record). Three opt-in behaviours, no change to anything
existing; the surface is meant to be `0.2.0`, and the version bump belongs to the
release.

### Added

- **`RendererConfig.edgeSelection`** — edges become press targets and tab stops:
  `Message.PressedEdge` / `Message.ActivatedEdge`, `role="button"` with
  `aria-pressed` and an `aria-label` built from `accessibleName`, an invisible hit
  path 20 flow units wide, and `SelectedElements` reporting `edgeIds` (it always
  could). The edges layer stops being `aria-hidden` while the feature is on.
- **Drag-to-pan in the minimap** — `Message.StartedMiniMapPan` and
  `Gesture.MiniMapPanning`. A press still centres the view; holding and dragging now
  pans from there, one `setViewport` per pointer move, with the screen mapping read
  once at press.
- **`ResizeOptions.keepAspectRatio`** — hold Shift (or ⌘/Ctrl) during a resize and
  the box keeps its start ratio. `Flow.update` reads it from `isAdditiveModifier`, so
  it is live mid-gesture; nothing in the Message surface changed for it.

### Changed in the consumer

- The example harness's `SelectedElements` fold now reads `edgeIds` as well as
  `nodeIds` — a page with an edge selected used to report "Nothing selected".
- `/examples/resizing/` turns `edgeSelection` on, so the feature ships on two pages.

### Not shipped

`XYResizer`, `nodeOrigin`, parent-resize child compensation, `resizeDirection`,
`shouldResize`, interactive edge labels, multi-node resize, per-frame handle
re-measurement, a culling index, minimap wheel-zoom and minimap node targets. Each has
a verdict and a "what would change it" in `docs/M6-RESEARCH.md`; the culling scan's
numbers say why it is not a fix (0.48 / 0.75 / 5.44 ms of a 16.7 ms frame at
625/1k/expanded-10k, zero long frames).

### Measured

The gate re-ran unchanged at this tree: 625 at parity with React Flow on pan
(16.7 / 16.7 / 16.8 for both), 1k p95 16.8 ms, zero long frames in 3 407 recorded
frames. 334 Vitest tests, 61 Playwright proofs.

Nothing yet.

## [0.1.1] — 2026-11-12

Documentation and packaging only. `dist/index.js` and `dist/style.css` are
byte-identical to 0.1.0; the only byte that differs anywhere in `dist` is a JSDoc
comment in `geometry/bounds.d.ts` and the source map beside it.

### Added

- `CHANGELOG.md`, shipped in the tarball.
- `repository`, `homepage`, `bugs`, `author` and `keywords` in `package.json`. 0.1.0
  shipped without them, so the npm page had no link to the repository.
- A root `LICENSE`, and a `prepublishOnly` guard (`pnpm typecheck && pnpm test &&
  pnpm build`) so a release cannot ship a `dist` older than its source.
- `docs/CONTRACT.md` — the contract feature by feature — and
  `CONTRIBUTING.md` — build, test and measurement workflow — split
  out of the README.

### Changed

- `README.md`: 515 lines that mixed a front door, the whole contract, the
  development workflow and a twenty-item docs index became a 184-line front door.
- The quick start now says what it does and does not do: it renders and handles
  gestures, and the facts it reports have to be folded with `Update.foldChild` before
  anything persists. The typed version of all seven facts is
  `packages/example/src/examples/harness.ts`.

### Fixed

- The measurement contract named `Flow.remeasure`; the export is `Flow.Remeasure`.
  Fixed in the README, the package README and `docs/CONTRACT.md`. 0.1.0's own README
  still carried the typo, and npm does not let a published version be edited.

## [0.1.0] — 2026-11-12

The first release: the whole M0–M5 surface, in one package.

### Added

- **Interaction** — drag, additive selection, delete, and pan/zoom through
  `XYPanZoom` with the Model as the committed viewport.
- **Connections** — handle-anchored endpoints, a 20px release radius,
  `isValidConnection`, and reconnect by dragging an edge end.
- **Measurement** — `ResizeObserver` plus a `MutationObserver` coalesced to one
  measurement per animation frame, stored node-local in the Model, with
  `Flow.Remeasure` for stylesheet-only changes.
- **Chrome** — dots or lines background, zoom/out/fit controls, a minimap, and a
  panel for consumer markup. All of it off by default.
- **Graph features** — parent/child sub-flows with relative positions, `hidden`
  collapsing that takes a subtree and its edges, node resizing, a snap grid,
  `fitView` options, four edge types, labels and markers, minimap click-to-centre.
- **Accessibility** — focusable nodes, arrow-key nudging, Enter/Space activation, and
  a memoized description region.

### Performance

- Viewport culling and a renderer-owned, swept node cache.
- Published and measured, not promised: 625 nodes at parity with React Flow on pan;
  1k culled inside the 33 ms p95 gate with zero long frames; 10k collapsed at the
  frame rate with 200 nodes in the DOM, and 10k expanded with a stated settle cost.
  The protocol, the machine and every figure are in
  `docs/BENCHMARKS.md`.

### Fixed before release

Written up section by section in the findings, rather than here: an edge that was in
the DOM and painted nothing, a connection preview drawn in the wrong coordinate
space, a resize that only appeared on release, a CSS rule that stretched the resize
handles, edges that lagged a node during its drag, quadratic position resolution on a
flat graph, and a fit folded before the pane was registered that left the engine on
the old viewport. Each has a proof now; see
`docs/M5-FINDINGS.md` §8.2 and the M3/M4 documents it points at.

[unreleased]: https://github.com/fllstck/foldkit-flow/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/fllstck/foldkit-flow/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fllstck/foldkit-flow/releases/tag/v0.1.0
