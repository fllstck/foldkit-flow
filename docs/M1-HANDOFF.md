# M1 handoff

This is the starting point for the next session. M0 is complete; the plan was not
re-litigated. The repo is initialized on `main`, and M0 is commit `c40ae47`
(`M0: static render, pan/zoom, benchmark, and tooling`). Do not amend that commit;
commit M1 work at logical checkpoints. Ask before force-pushing or rewriting
history.

## Copy-paste prompt for the next session

> Work on M1 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M1-HANDOFF.md` first, then `docs/PLAN.md` §2.5, §3.1–§3.3, §4.1–§4.6, §6,
> and §7 (M1), plus `docs/foldkit-constraints.md` and `docs/M0-FINDINGS.md` §2/§5.
> Do not re-plan or re-litigate the locked decisions. Extend the existing M0 code;
> run `pnpm check`, `pnpm build`, and the Playwright proofs before claiming anything
> is done. M0 is committed as `c40ae47`; do not amend it. Commit M1 work at logical
> checkpoints.

## Current state

| Area                 | State                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/flow`      | M0 library: static render, path geometry, pan/zoom Mount, ResizeObserver node measurement, host registry, `SyncViewport`, viewport throttle, adapter |
| `packages/example`   | SSG demo/instrumentation: 625 nodes, pan/zoom, re-render, animated sync, unmount/remount, Model viewport exposed as `data-viewport`                  |
| `packages/benchmark` | Three production pages (React Flow / Svelte Flow / Foldkit), 625-node fixture, Playwright frame recorder                                             |
| Tests                | 14 Vitest unit tests in `packages/flow`; 4 Playwright proofs in `packages/benchmark/tests/proofs.spec.ts`                                            |
| Tooling              | `pnpm check` (typecheck + Enfect lint + Prettier + unit tests), `pnpm build`, `pnpm dev`, `pnpm benchmark`, `pnpm bench`                             |
| Docs                 | `docs/PLAN.md`, six critiques, `docs/M0-FINDINGS.md`, two M0 reviews, `docs/xyflow-internals.md`, `docs/foldkit-constraints.md`                      |

M0 benchmark result at 625 nodes / 624 edges: all three libraries held the 60 fps
cadence, median 16.7 ms, p95 ≈16.8 ms, no frames over 50 ms. Details in
`packages/benchmark/results/benchmark.json`. Foldkit's drag leg does not move nodes
yet; only pan is directly comparable.

## Read first

1. `docs/M1-HANDOFF.md` (this file).
2. `docs/PLAN.md` §2.5 (state/context), §3.1–§3.3 (Model, Messages, renderer),
   §4.1–§4.6 (Mounts, host registry, subscriptions, hot path, propagation), §6
   (testing), §7 M1.
3. `docs/foldkit-constraints.md` — especially the Mount seam, subscriptions, and
   `viewInputs` restrictions.
4. `docs/M0-FINDINGS.md` §2 and §5 — the actual code differs from the plan sketches
   there; those diffs are already applied in the code.
5. `docs/M0-REVIEW-2.md` — read with the correction in `M0-FINDINGS.md` §1
   (proof 3): the reported stale-Model bug did not reproduce, but the explicit
   `CompletedSyncViewport` commit was adopted anyway.

## Current implementation map

```
packages/flow/src/
  model.ts        Model, Init, Viewport/Point/Rect/Size/NodeSize, Context, FlowNode/FlowEdge
  message.ts      the seven M0 Messages
  update.ts       update(model, message, context) — context currently unused
  geometry/
    paths.ts      edgePath(kind, input) via the adapter; Bezier/Straight/Step/SmoothStep
  runtime/
    adapter.ts    the only @xyflow/system importer; compile-time signature assertions
    adapter.typecheck.ts  @ts-expect-error negative checks (intentional)
    mountPane.ts  XYPanZoom, host registration, ResizeObserver, viewport writes
    mountNode.ts  ResizeObserver → MeasuredNode, rAF-coalesced
    host.ts       PaneHost registry: element, root, panZoom
    command.ts    SyncViewport
    viewportThrottle.ts  createViewportThrottle (offer/cancel, one per rAF)
  view/
    view.ts       createRenderer({ paneId, renderNode }).view(input, h)
    classes.ts    class/data-attribute names
  index.ts        public exports
style/flow.css    own visual identity
```

Current Model:

```ts
{ pane, paneId: Option<string>, viewport, nodeSizes }
```

Current Messages:

```ts
(MountedPane,
  FailedMountPane,
  ResizedPane,
  MeasuredNode,
  MovedViewport,
  CompletedSyncViewport({ viewport }),
  FailedSyncViewport);
```

`Flow.update` already takes `(model, message, context)`; no Message reads the
context yet. Extend this rather than changing the signature.

## Contract decisions already made (do not re-litigate)

- Parent owns nodes/edges/data/positions; the flow submodel owns interaction state
  only. `update` receives the graph through `context`; it is never stored.
- Mounts own imperative work; document/root Subscriptions own cross-element
  gestures (M1).
- `PaneHost` holds live objects out of the frozen Model; Commands cross by
  `paneId`; a missing host yields `Failed*`, never a `document` fallback.
- `@xyflow/system` is pinned exactly at `0.0.84`, and every engine call goes
  through `runtime/adapter.ts`.
- Initial viewport is a Mount arg. Later programmatic changes go through
  `SyncViewport`.
- `panZoom.update(PanZoomUpdateOptions)` must be called after construction; it is
  what registers d3's handlers.
- `onPanZoom`, `onPanZoomStart`, `onPanZoomEnd` are `(event, viewport)` — event
  first.
- One writer for programmatic viewport transitions: `onPanZoom` writes the DOM only
  when `event !== null`. Transition frames are driven by the Model patch; otherwise
  the throttled patch races the d3 transition and oscillates.
- `CompletedSyncViewport` carries `panZoom.getViewport()` read after `setViewport`
  resolves, and `update` commits it to `model.viewport`. This is the explicit
  programmatic commit; do not switch it to the command's target, because a gesture
  that interrupts the sync must win.
- A renderer generic over `ParentMessage` must lift Mounts with
  `Mount.mapMessage(action, toParentMessage)`. Keep `renderNode` and
  `toParentMessage` referentially stable; the M1 node cache will depend on it.
- Node size resolution is measured size → `node.size` hint → `151×40` fallback.
- A re-render that changes a node's box legitimately emits another `MeasuredNode`;
  that is not a Mount restart. Mount-lifetime tests pin the box or assert element
  identity.
- `createViewportThrottle` (renamed from `makeViewportThrottle`) is a plain closure
  factory, not an Effect service.

## M1 scope (from `docs/PLAN.md` §7)

Implement the interaction core and hit the performance gate:

1. **State and update** — extend `Model` with selection, gesture state, handle
   bounds, pane identity; add the Messages/OutMessages from §3.1–§3.2; implement
   `Flow.update(model, message, context)` for drag, selection, delete, connection
   start/hover/cancel, viewport, measurement.
2. **Per-dispatch fold** — the parent closes over the graph per dispatch
   (`Update.foldChild`'s update has no context parameter). Wire it in the demo and
   show the cost in the benchmark report.
3. **Node drag** — `DraggingNodes({ pointer, nodeIds, origin, delta, hasMoved })`
   overlay; render `node.position + delta`; one `MovedNodes` OutMessage on release;
   `CancelledGesture` clears without emitting. Pointer identity is part of the
   gesture.
4. **Selection** — split node/edge selection, additive press semantics,
   `SelectedElements` OutMessage, pane press clears unless additive.
5. **Keyboard delete** — document-level key handling gated by the editable-target
   guard and `.fflow__nokey`; one `DeletedElements` OutMessage.
6. **Subscriptions** — pointermove/pointerup/cancel, window blur, Escape, delete,
   document-level wheel if needed. Resolve the pane root through `PaneHost` (works
   for ShadowRoot/iframe); `keepAliveEquivalence` only if the pointer stream must
   not restart.
7. **Measurement** — `MeasuredHandles` per node from `getHandleBounds`; add the
   `MutationObserver` from §2.5.3 (`{ childList, attributes, subtree }`, no
   `attributeFilter`), coalesced per frame; `MeasureHandles` checkpoint before a
   connection; `MergedHandleBounds` merge/prune semantics;
   `Flow.informGraphChanged`; per-node `RemovedNodeMeasurement`.
8. **Propagation** — implement §4.6: handle stops propagation, node wrapper arms
   drag unless the target is a control/`.fflow__nodrag`, pane clears selection,
   `.fflow__nowheel` wins over zoom.
9. **Culling** — `geometry/visible.ts`, pane × viewport with one screen of
   overscan, recomputed on viewport frames only; record the O(N) scan cost.
10. **Node cache** — `view/nodeCache.ts`, one `createLazy()` slot per node id owned
    by the renderer, swept for absent ids after each render; `renderer.dispose()`
    drops all slots. Do not use `createKeyedLazy` for node ids.
11. **Performance gate** — 625-node parity, 1k p95 < 33 ms with culling, no frames
    over 50 ms; keep the three-page benchmark and the protocol in §4.5.
12. **Coverage** — Story tests for the state machine and lifecycle cases; Scene for
    propagation; Playwright for pointer identity, cancel, remeasurement, ShadowRoot,
    cache behavior, and the perf gate.

## Suggested first tasks

1. Add `selection`, `gesture`, `handleBounds`, and `paneId` to the Model per §3.1;
   add the matching Messages/OutMessages. Keep the M0 messages and behavior.
2. Write the pure helpers and Story tests before DOM work: `screenToFlow`,
   `flowToScreen`, `dragDelta`, `visibleNodes`, `hitTestHandle`, `isDeleteKeyAllowed`.
3. Add `CancelledGesture` and pointer identity, then node drag overlay + release.
4. Add selection and delete behind the editable-target guard.
5. Add node subscriptions for pointermove/up/cancel using the host root.
6. Add handle measurement + MutationObserver + `MeasureHandles` checkpoint.
7. Add culling, then the renderer node cache, then run the full benchmark.
8. Extend the demo with a drag/select/connect playground and expose any new
   instrumentation needed for Playwright; keep it clearly a harness.

## Known traps and repo-specific gotchas

- **Do not put live instances in the Model.** Foldkit 0.170.0 deep-freezes it in
  dev. `PaneHost` is the boundary.
- **Mount args are captured at mount** and are not reactive. Only the initial
  viewport belongs there; later changes are Commands.
- **A reused element keeps its Mount.** Re-renders do not restart it. Use observers
  or Messages for DOM changes that are not element replacement.
- **One `h.OnMount` per element.** A second one silently replaces the first.
- **`h.OnMount` needs `MountAction<ParentMessage>`.** Use `Mount.mapMessage`; keep
  `toParentMessage` stable or the M1 cache will miss every render.
- **`MutationObserver.attributeFilter` has no wildcards.** Observe unfiltered and
  coalesce per frame; do not invent `data-handle*`.
- **`Update.foldChild`'s `update` is `(childModel, input)`.** Close over the
  per-dispatch context; do not store a graph copy.
- **`createLazy` slots compare function/dispatcher/argument references and never
  evict.** The renderer must own and sweep the Map.
- **`getHandleBounds` is zoom-invariant** (offsets divided by zoom, sizes from
  `offsetWidth`/`offsetHeight`). Do not re-measure per zoom frame.
- **`Scene` cannot synthesize `pointermove`.** Keep gesture math pure for Story;
  use Playwright for the DOM layer.
- **DOM casts need `SAFETY:` comments** to pass Enfect lint.
- **Boolean Schema fields need a boolean prefix** (`is*`, `has*`, `can*`, …).
- **Tests are linted separately.** Enfect rules ignore `*.test.ts`, `*.spec.ts`,
  `*.typecheck.ts`, and `**/tests/**`; `oxlint.tests.json` covers them. Do not
  delete that split without updating `pnpm lint`.
- The Playwright config currently uses the locally installed Brave binary. Change
  `launchOptions.executablePath` if Chromium is installed instead.
- The demo preview binds `127.0.0.1:4174`; the benchmark binds `127.0.0.1:4173`.
  Playwright starts both.

## Verification and definition of done

Run all of these and read the output:

```sh
pnpm check                 # typecheck, Enfect lint, Prettier, unit tests
pnpm build                 # flow → example → benchmark
pnpm bench                 # Playwright benchmark + proofs (uses Brave)
```

M1 is done when:

- the drag/select/delete/connection state machine is covered by Story tests,
  including foreign `pointerId`, cancel paths, and the editable-target guard;
- Scene covers §4.6 propagation;
- Playwright covers pointer identity, cancellation, remeasurement after a handle
  change, ShadowRoot hosting, and the 625/1k performance gate;
- `Flow.informGraphChanged` and the existence checks prevent dead-id OutMessages;
- 625 nodes: median ≤ React Flow's median, p95 within 10%, no frame > 50 ms;
- 1k nodes with culling: p95 < 33 ms during drag and pan;
- `pnpm check` and `pnpm build` are green and the benchmark JSON is committed to
  the report (not the lockfile).

## Open design questions for M1

- Whether `informGraphChanged` should live in `update.ts` or a small geometry
  helper module; keep it pure and Model-first.
- Selection semantics on additive pane press and drag-select (out of M0 scope but
  specified in §4.6).
- Whether the node-drag overlay needs `hasMoved` to suppress a click on release;
  the plan's `PressedNode`/`ReleasedPointer` shape already carries it.
- How `.fflow__nodrag` and `.fflow__nopan` interact with nested controls; keep the
  class names in `view/classes.ts`.
- Whether culling should use a spatial index at 10k; do not add one before the
  benchmark says the O(N) scan is the bottleneck.
- How `nodeCache` keys relate to node ids after create/delete churn; the renderer
  sweep is the eviction mechanism.

## Working agreements

- Do not edit `docs/PLAN.md` wholesale. Put deviations and proposed diffs in
  `docs/M1-FINDINGS.md` as M0 did.
- Do not import `@xyflow/react` or `@xyflow/svelte` outside `packages/benchmark`.
- Do not copy upstream CSS or add an attribution component.
- M0 is commit `c40ae47` on `main`. Do not amend it. Commit M1 work at logical
  checkpoints; ask before force-pushing or rewriting history. No network install
  beyond npm without asking.
