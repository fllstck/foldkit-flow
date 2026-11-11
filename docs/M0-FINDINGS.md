# M0 findings

M0 was the spike that compiles `PLAN.md`'s sketches, proves the six runtime
assumptions, and stands up the performance harness. This file records what was
verified, the numbers, and where the plan's code needed to change. `PLAN.md`
itself is untouched; proposed edits are in §5.

Environment: Foldkit 0.170.0, `@xyflow/system` 0.0.84 (exact), Effect 4.1.3,
Node 24.15.0, pnpm 11.13.0, macOS 26.6.2 on a MacBook Air (Apple M5, 16 GB).

## 1. Status of the six proofs

| #   | Proof                                                                  | Status | Evidence                                                                                    |
| --- | ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 1   | Engine path helpers produce correct `d` strings through `h.path`       | Pass   | `packages/flow/src/geometry/paths.test.ts`, `packages/flow/src/view/render.test.ts`         |
| 2   | Node Mount + `ResizeObserver` emits `MeasuredNode`; re-render survives | Pass   | `packages/benchmark/tests/proofs.spec.ts` → "proof 2"                                       |
| 3   | `XYPanZoom` survives re-renders and `syncViewport` works from Command  | Pass   | `packages/benchmark/tests/proofs.spec.ts` → "proof 3"                                       |
| 4   | SSR carries the Model transform; hydration does not move it            | Pass   | `packages/benchmark/tests/proofs.spec.ts` → "proof 4"                                       |
| 5   | 625-node benchmark renders in all three libraries and records frames   | Pass   | `packages/benchmark/results/benchmark.json` (numbers in §2)                                 |
| 6   | `runtime/adapter.ts` compiles against the pinned engine                | Pass   | `pnpm -r typecheck`, plus compile-time negative tests in `src/runtime/adapter.typecheck.ts` |

### Proof 1 — path helpers

`edgePath()` routes every call through `runtime/adapter.ts`. The tests assert the
engine's exact output, including its spaces:

- `getStraightPath` → `M 0,0L 100,100`
- `getBezierPath` (Bottom→Top) → `M0,0 C0,50 100,50 100,100`
- `getSmoothStepPath` → `M0 0L 0,45Q 0,50 5,50L 95,50Q 100,50 100,55L100 100`
- `getSmoothStepPath` with `borderRadius: 0` (our `Step`) → `M0 0L 0,50Q 0,50 0,50L 100,50Q 100,50 100,50L100 100`

`render.test.ts` runs `@foldkit/vite-plugin`'s server renderer against the flow
view and asserts the SVG path reaches the served markup:
`d="M50,40 C50,80 250,80 250,120"` for a two-node graph, plus 625 positioned node
divs and 624 edge paths in the demo build.

### Proof 2 — node Mount survives a re-render

The demo's "Re-render" button changes every node label, which rebuilds the nodes
array and patches every node's text. The test captures the node and pane elements
before the patch and asserts they are the same objects afterwards. The counter of
`MeasuredNode` Messages stays at **625** and `MountedPane` stays at **1** after
the patch.

The first version of this test used nodes whose width was content-driven. Changing
the label changed every node's box, so the `ResizeObserver` correctly emitted a
second measurement per node (625 → 1250). That looked exactly like a Mount restart
but was not. The demo now pins the node box (`width: 150px; height: 36px`), which
makes the test measure Mount lifetime rather than layout change. This distinction
belongs in the M1 test suite: **if a re-render changes node size, a second
`MeasuredNode` is expected and is not evidence of a remount.**

### Proof 3 — pane Mount and Command

`MountPane` constructs `XYPanZoom` inside `Mount.defineStream` with the Model's
viewport as an argument, registers the `PaneHost`, then a `SyncViewport` Command
calls `setViewport({ x: -200, y: -100, zoom: 1.25 }, { duration: 120 })`. After a
re-render, `MountedPane` is still 1, the Command produces
`CompletedSyncViewport`, and the viewport element's inline style becomes
`translate(-200px, -100px) scale(1.25)`.

The load-bearing change from the plan: **`XYPanZoom` does not register its d3
gesture handlers until `panZoom.update(...)` is called.** The sketch constructs the
instance and never calls `update`, so `onPanZoom` never fires, `setViewport` moves
only d3's internal `__zoom`, and the DOM transform is never written by the engine
path. M0 calls `update` with the full `PanZoomUpdateOptions` record (17 required
fields in 0.0.84; see §5.1).

A subsequent review claimed that `SyncViewport` leaves `model.viewport` stale and
that a later rerender restores the old transform. That does not reproduce: the
Command fires `onPanZoom` during the d3 transition, seven `MovedViewport` frames
update the Model, and a rerender after completion keeps
`translate(-200px, -100px) scale(1.25)`. The review's proposed regression test
passes on the code as it stood, so it would not have caught a defect.

The adjacent real defect is a **two-writer race during programmatic animation**.
Recording every `style` mutation during the 120 ms `setViewport` transition shows
the transform moving forward on an engine tick and then backward when the
throttled Model patch (one frame behind) runs. Pointer pan does not show this,
because its events are handled before the rAF flush; d3 transition ticks can run
after it.

The fix is in `MountPane`: `onPanZoom` writes the DOM only when the engine event
has a source event (`event !== null`). Transition frames are driven by the Model
patch alone, which is now the only writer. `onPanZoomEnd` still writes the final
value and commits the terminal Message. Proof 3 now records the mutation sequence
and asserts monotonic x/y and zoom; a new proof (3b) does the same for a real
pointer pan and asserts the terminal viewport survives a rerender.

A second review repeated the stale-Model claim. It still does not reproduce: the
demo now exposes `model.flow.viewport` as `data-viewport`, which reads
`20,30,0.9` before the sync and `-200,-100,1.25` afterwards, while the DOM reads
`translate(-200px, -100px) scale(1.25)`. The Model commit comes from the
`MovedViewport` frames, not from a DOM diff.

The contract is now explicit anyway, because relying on the Mount queue's side
channel is an ordering assumption worth removing: `CompletedSyncViewport` carries
the viewport `panZoom.getViewport()` reports after `setViewport` resolves, and
`update` writes it to `model.viewport`. Reading the engine's current value rather
than the command's target means an interrupting gesture is not clobbered. A unit
test covers the update transition; the browser proof now unmounts and remounts the
pane and asserts the new Mount starts from the committed Model viewport, which is
the scenario the review described.

### Proof 4 — SSR and hydration

`vite build` prerenders `/` (`ssg`) to `packages/example/dist/client/index.html`.
The served document contains:

- `transform: translate(20px, 30px) scale(0.9)` on `.fflow__viewport`
- 625 `data-nodeid` wrappers and 624 `.fflow__edge-path` elements
- no `OnMount` markers (they are client-only)

The Playwright test reads the served HTML, then loads the page with JavaScript
disabled to capture the server-only computed transform. A second load records every
`style` attribute mutation on `[data-fflow-viewport]` from before hydration through
`MountedPane`. The hydrated transform equals the no-JS transform, and every
recorded style mutation still carries the same transform — no jump and no reflow
of the viewport. The pane Mount never writes a transform at construction; it only
writes in `onPanZoom`/`onPanZoomEnd`, so hydration cannot flash.

### Proof 5 — benchmark

Harness shape chosen: **one Vite app with three HTML entries** (`react.html`,
`svelte.html`, `foldkit.html`), one production `vite build`, one `vite preview`,
one Playwright run. The plugins did not fight. Each page is a separate document, so
each library gets its own main thread, realm, and compositor.

Protocol as §4.5: production bundle, one browser (headless Brave
156.1.98.63 / Chromium 156), warm-up discarded, 10 recorded runs, scripted A→B
chain drag (node `n0`, 20 × 5 px) and a pan on the empty pane, per-frame rAF
deltas, median/p95/longest. The full JSON is `packages/benchmark/results/benchmark.json`.

| Library            | Gesture | Frames | Median (ms) | p95 (ms) | Longest (ms) | > 50 ms |
| ------------------ | ------- | -----: | ----------: | -------: | -----------: | ------: |
| React Flow 12.12.1 | drag    |    419 |        16.7 |     16.8 |         16.8 |       0 |
| React Flow 12.12.1 | pan     |    410 |        16.7 |     16.7 |         16.8 |       0 |
| Svelte Flow 1.7.1  | drag    |    415 |        16.7 |     16.7 |         16.8 |       0 |
| Svelte Flow 1.7.1  | pan     |    402 |        16.7 |     16.7 |         16.8 |       0 |
| Foldkit Flow (M0)  | drag    |    417 |        16.7 |     16.7 |         16.8 |       0 |
| Foldkit Flow (M0)  | pan     |    400 |        16.7 |     16.7 |         16.8 |       0 |

What these numbers do and do not say:

- At 625 simple nodes all three hold the 60 fps cadence under this machine and
  browser. There are no frames over 50 ms.
- rAF deltas are quantized to the display cadence. They prove parity in "no frame
  missed its budget", not equality of main-thread work below 16.7 ms. M1 should add
  a main-thread time column (e.g. `PerformanceObserver` long tasks or a
  `performance.mark` around `update` + diff) before claiming a finer comparison.
- **The Foldkit drag leg does not move nodes.** M0 has no node drag (non-goal); the
  input is the same scripted drag against `n0`, and the measured frames are the
  static render plus the engine's own pan/zoom listeners. Only the pan leg is
  directly comparable today. The harness is ready for M1's drag without changing
  the script.
- Foldkit edges are one `<path>` and nodes have no handles in M0; React Flow and
  Svelte Flow nodes have handle DOM. The parity result is therefore an upper bound
  in Foldkit's favour, not a like-for-like DOM comparison. Recorded here rather than
  hidden.

### Proof 6 — adapter compiles and pins signatures

`src/runtime/adapter.ts` is the only file that imports `@xyflow/system`. It
assigns, rather than re-exports:

- `createPanZoom` to `(params: PanZoomParams) => PanZoomInstance`, where
  `PanZoomParams` declares `onPanZoom`, `onPanZoomStart`, `onPanZoomEnd` as
  `OnPanZoom = (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void`.
  A viewport-first callback is a type error.
- `getHandleBounds` to a local `MeasureHandleBounds` signature (type is
  `'source' | 'target'`, element is `HTMLDivElement`, return is
  `ReadonlyArray<RawHandle> | null`).
- `getBezierPath`, `getSmoothStepPath`, `getStraightPath`,
  `getViewportForBounds` via `typeof` the upstream function.
- `PanZoomInstance` includes `setViewport(viewport, options?: { duration?, ease?,
interpolate? })`, `setViewportConstrained`, `syncViewport(viewport)`, `update`,
  `destroy`.

`adapter.typecheck.ts` is compiled by `tsc` and contains negative cases with
`@ts-expect-error`: a one-argument viewport callback, `setViewport(viewport, 300)`,
`syncViewport(viewport, { duration })`, `getHandleBounds('both', …)`, and the
five-element path tuple. If the pinned engine changes any of these, `pnpm
typecheck` fails.

## 2. What did not work as written in `PLAN.md`

1. **`panZoom.update(...)` is missing from the Mount sketch and is mandatory.**
   `XYPanZoom` wires `onPanZoom*` only inside `update`. Without it, panning does
   nothing and `syncViewport` silently changes d3's internal transform without
   touching the DOM. `update` also needs `onTransformChange`, `lib`,
   `panOnScrollMode`, and the rest of `PanZoomUpdateOptions` — not just the two
   class names §4.6 mentions.

2. **A renderer generic over `ParentMessage` must lift each Mount action.**
   `h.OnMount` requires `MountAction<ParentMessage>`, but library Mounts emit
   `Flow.Message`. The renderer wraps them with
   `Mount.mapMessage(MountNode({ nodeId }), input.toParentMessage)`. This makes
   `ViewInput.toParentMessage` a required, typed argument
   `(message: Flow.Message) => ParentMessage`; the §3.3 sketch does not show it.

3. **`writeTransform(paneId, next)` has no element in the host record.** The
   §4.3 `PaneHost` has `element` (the pane) but the transform lives on its
   `[data-fflow-viewport]` child. M0 captures that child once in `MountPane` and
   writes to it directly. If M1 ever lets the viewport element be replaced without
   replacing the pane, the capture goes stale; either add `viewportElement` to
   `PaneHost` or re-query in `writeTransform`.

4. **A content re-render that changes node size legitimately re-measures.** The
   plan's trap list says a reused node keeps its Mount; that is true, and proof 2
   confirms it, but the `ResizeObserver` will still emit when the box changes. Test
   assertions must pin the box or compare element identity.

5. **`Schema.Option` fields are `Option`, not `null`.** `Flow.init` uses
   `Option.none()` for `paneId`; the §3.1 sketch's `Option.none()` in prose was
   right, but the initial object in some revisions of the sketch used `null`.

6. **The demo needs (and M0 does not provide) a `toParentMessage`-stable
   renderer.** `Mount.mapMessage` closes over the mapper; if `renderNode` or the
   mapper is rebuilt per render, the future node cache will miss every frame. This
   is why `RendererConfig` holds `renderNode` and the parent must pass a stable
   mapper. The plan says this for `renderNode`; it should say it for
   `toParentMessage` too.

7. **`XYPanZoom` seeds d3, not the DOM.** Construction applies the initial
   viewport to d3's `__zoom` only. The view is responsible for the initial
   transform, which is exactly what the SSR proof relies on. Do not expect the
   engine to write the first frame.

8. **The "following patch is a no-op" assumption fails for animated viewport
   changes.** For pointer frames it holds: the DOM write and the Model value agree.
   For d3 transition frames the Model patch can lag a tick and write an older
   transform back, visibly oscillating. M0 gives transition frames a single writer
   (the Model patch) and makes `CompletedSyncViewport` carry the engine's current
   viewport, so the completion commits the Model without relying on Mount-queue
   ordering. The completion reads `getViewport()` rather than the target, so a
   gesture that interrupts the sync cannot be overwritten by a stale target.

9. **`makeViewportThrottle` was renamed to `createViewportThrottle`.** `@enfect/oxlint`'s
   `no-service-constructor-imports` rule reads a `make<Capitalized>` export as an
   Effect service constructor. The helper is a plain closure factory, not a
   service; the rename keeps the rule enabled for actual services.

## 3. What M0 deliberately does not do

Per the milestone: no node dragging, selection, handles/connections, culling,
`createLazy` node cache, MutationObserver handle invalidation, or CSS polish. The
Model is the minimal `{ pane, paneId, viewport, nodeSizes }`; the Messages are the
seven lifecycle/measurement/viewport ones. `Flow.update` already accepts the
graph through `context`, so M1 extends the signature rather than changing it.

Known M0 limitations recorded for M1:

- Node drag is absent, so the benchmark's Foldkit drag leg measures input and
  pan/zoom work only.
- The node Mount has `ResizeObserver` but no `MutationObserver`; handle geometry
  invalidation is untested.
- No selection/gesture state; `MovedViewport.isGestureEnd` is carried but the demo
  does not branch on it.
- The viewport culling scan is not implemented, so the §4.5 O(N) pan cost is not
  measured yet.
- `getViewportForBounds` is type-checked but unused (no fit-view control).

## 4. Recommended M1 changes

1. Add `panZoom.update(...)` to the Mount and keep `PanZoomUpdateOptions` in the
   adapter, so one update path exists for both construction and later option
   changes.
2. Add `viewportElement` to `PaneHost` (or a `writeViewportTransform(paneId,
viewport)` helper that re-queries) so Commands can write the transform without
   reaching through `element.querySelector`.
3. Make `ViewInput.toParentMessage` a named, documented part of the API and state
   that it must be referentially stable for the M1 node cache.
4. Add the node `MutationObserver` from §2.5.3 and the `MeasureHandles` checkpoint;
   keep the frame coalescer shared with `MeasuredNode`.
5. Extend the benchmark with the M1 metrics (`update`/diff time, culling scan,
   heap after 1,000-create/1,000-delete) and a Foldkit node-drag leg. Keep the
   three-page harness; it works.
6. Add 1k/10k fixtures when culling lands; the current harness already separates
   pages and records per-frame distributions.

## 5. Proposed `PLAN.md` diffs

### 5.1 §4.1 — wire the engine after construction

After `registerPane(...)`, add:

```ts
// `update` is what registers d3's wheel/pointer handlers and the three
// pan/zoom callbacks. Construction alone only seeds d3's internal transform.
panZoom.update({
  noWheelClassName: classes.NoWheel,
  noPanClassName: classes.NoPan,
  preventScrolling: true,
  panOnScroll: false,
  panOnDrag: true,
  panOnScrollMode: PanOnScrollMode.Free,
  panOnScrollSpeed: 0.5,
  userSelectionActive: false,
  zoomOnPinch: true,
  zoomOnScroll: true,
  zoomOnDoubleClick: true,
  zoomActivationKeyPressed: false,
  lib: "fflow",
  onTransformChange: () => {},
  connectionInProgress: false,
  paneClickDistance: 0,
});
```

and a sentence in §4.1: "Construction seeds d3's transform; `update` registers the
gesture handlers. Without it `onPanZoom` never fires."

### 5.2 §3.3 — show the Message lift

In `ViewInput`:

```ts
toParentMessage: (message: Message) => ParentMessage;
```

and at the node/pane Mount site:

```ts
h.OnMount(
  Mount.mapMessage(MountNode({ nodeId: node.id }), input.toParentMessage),
);
```

with one sentence: "A renderer generic over `ParentMessage` cannot pass a
`MountAction<Message>` to `h.OnMount`; the lift belongs in the renderer."

### 5.3 §4.1 / §4.3 — name the transform target

Replace `writeTransform(paneId, next)` with either:

```ts
writeTransform(viewportElement, next);
```

captured at mount, or add `viewportElement: HTMLElement` to `PaneHost` and keep the
`paneId` form. State the lifetime rule: the capture is valid for the pane's
lifetime; a replaced viewport child needs a new capture or a re-query.

### 5.4 §4.2 — distinguish re-measure from remount

Add: "A re-render that changes a node's box produces a new `MeasuredNode`; that is
correct and is not a remount. Mount-lifetime tests must pin the node box or assert
element identity."

### 5.5 §3.1 — `init` and `Option`

The `init` example should use `Option.none()`, and the Model field type should be
shown as `Option.Option<string>` (not a nullable string).

### 5.6 §4.1 — one writer for programmatic transition frames

In the `onPanZoom` sketch, replace the unconditional write with:

```ts
onPanZoom: (event, next) => {
  if (!isLive) return;
  // Transition frames have no source event. Let the Model patch drive those;
  // writing here too races the throttled patch and oscillates.
  if (event !== null) writeTransform(viewportElement, next);
  viewportThrottle.offer(next);
},
```

and add to §4.5, after "the following patch is a no-op": "That holds for pointer
frames. D3 transition ticks can run after the rAF flush, so programmatic animations
need a single writer — the Model patch."

If M1 prefers `CompletedSyncViewport` to carry the target viewport, keep it as the
only writer for the completion and do not also write from the terminal
`onPanZoomEnd`, or guard the completion against a newer gesture.

### 5.7 §4.1 — rename the throttle factory

Rename `makeViewportThrottle` to `createViewportThrottle` in the sketch and prose.
The helper is a closure factory, not an Effect service constructor, and the old name
trips `@enfect/oxlint`'s `no-service-constructor-imports` rule.

### 5.8 §3.2 / §4.3 — `CompletedSyncViewport` carries the committed viewport

Change the Message and the Command sample:

```ts
CompletedSyncViewport: { viewport },

// inside SyncViewport, after setViewport resolves
Effect.map(() => host.panZoom.getViewport()),
Effect.match({
  onFailure: (message) => message,
  onSuccess: (viewport) => Message.CompletedSyncViewport({ viewport }),
}),
```

and process it in `update`:

```ts
CompletedSyncViewport: ({ viewport }) => ({ model: { ...model, viewport } }),
```

Use the engine's current viewport, not the command's target: if a gesture
interrupts the transition, the commit must follow the gesture. This makes the
completion the explicit Model commit instead of depending on a later
`MovedViewport` frame.

## 6. Reproducing

```sh
pnpm install
pnpm check                   # typecheck + lint + format check + unit tests
pnpm -r typecheck
pnpm -r test                 # flow unit tests (14)
pnpm --filter @fllstck/foldkit-flow build
pnpm --filter @fllstck/foldkit-flow-example build
pnpm --filter @fllstck/foldkit-flow-benchmark build
pnpm --filter @fllstck/foldkit-flow-benchmark exec playwright test
```

The proof suite is four browser tests: Mount lifetime, animated `SyncViewport`,
pointer-pan commit, and SSR/hydration. The benchmark test runs separately.

The Playwright config expects the demo preview on `127.0.0.1:4174` and the
benchmark preview on `127.0.0.1:4173`; it starts both. It currently uses the locally
installed Brave binary as the Chromium engine (`launchOptions.executablePath`);
change that to a Playwright-installed Chromium if the machine has one.

The repository was initialized after M0 validation, and this tree is the first
commit on `main` (`M0: static render, pan/zoom, benchmark, and tooling`). Keep
later work in new commits; do not amend the M0 commit.
