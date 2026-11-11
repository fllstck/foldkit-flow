# M2 handoff

This is the starting point for the next session. M0 and M1 are complete; the plan
was not re-litigated. The repo is on `main`, working tree clean at `0a1db9a` (the
commit that adds this file).
Commit `c40ae47` is M0 and `a0a3fdc` is the M1 handoff — do not amend either, and
do not rewrite history. Commit M2 work at logical checkpoints.

## Copy-paste prompt for the next session

> Work on M2 of `@fllstck/foldkit-flow` in `~/Development/foldkit-flow`. Read
> `docs/M2-HANDOFF.md` first, then `docs/PLAN.md` §2.5 (especially §2.5.3), §3.1–§3.4,
> §4.2–§4.3, §4.6, §6, and §7 (M2), plus `docs/foldkit-constraints.md`,
> `docs/M1-FINDINGS.md` §5–§12, and `docs/M1-REVIEW-3.md`. Do not re-plan or
> re-litigate the locked decisions. Extend the existing M1 code; run `pnpm check`,
> `pnpm build`, and `pnpm bench` before claiming anything is done. The tree is
> clean at `0a1db9a`; do not amend `c40ae47` or `a0a3fdc`. Commit M2 work at
> logical checkpoints, and put deviations in `docs/M2-FINDINGS.md`.

## Current state

| Area                 | State                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/flow`      | M1 library: interaction core (drag, selection, delete, modifiers), measurement + handle bounds, culling, renderer node cache |
| Connections          | Gesture exists end to end but the geometry it produces is provisional (see “What M2 inherits” below)                         |
| `packages/example`   | 625-node playground: drag, select, connect, delete, `SyncViewport`, instrumentation attributes                               |
| `packages/benchmark` | 625 parity + 1k culled gate, both verified to move something; ShadowRoot and culling pages                                   |
| Tests                | 89 Vitest tests; 15 Playwright tests (13 proofs + 2 gate)                                                                    |
| Tooling              | `pnpm check` (typecheck + Enfect lint + Prettier + unit), `pnpm build`, `pnpm dev`, `pnpm bench`, `pnpm benchmark`           |

Commits, newest last: `c17964e` (M1 library), `0faf42b` (example + benchmark),
`4afe982` (findings), `58a1436` (review 1 fixes), `e0ac2ee` (probe timeouts +
proofs 14–15), `f240d9e` (demo instrumentation), `d78a5ac` (doc counts),
`cc25b5a` (node press panned; benchmark idle legs), `0039750` (verify every
scripted gesture; drop `?cull`), `898bb46` (doc evidence), `0a1db9a` (this file).

## Read first

1. `docs/M2-HANDOFF.md` (this file).
2. `docs/PLAN.md` §7 **M2** — the milestone text, quoted in full under “M2 scope”.
3. `docs/PLAN.md` §2.5.3 — the measurement contract M2 is supposed to close out:
   the `MutationObserver` mechanism, the `MeasureHandles` checkpoint, merge-only
   `MergedHandleBounds`, `missingNodeIds` pruning, and `Flow.remeasure` as the
   answer to stylesheet-only layout changes.
4. `docs/PLAN.md` §3.1–§3.4 — `HandleRef`, `HandleBounds`, `Gesture.Connecting`,
   the `Connection`-shaped helpers, and the handle DOM contract.
5. `docs/PLAN.md` §4.2–§4.3 — the node Mount, `getHandleBounds`, and the
   `MeasureHandles` command.
6. `docs/PLAN.md` §4.6 — propagation rules, as actually implemented (see traps).
7. `docs/M1-FINDINGS.md` §5–§12 — how M1 diverged from the plan, and the four
   bugs the proofs found. §5 lists what M1 deliberately left for M2.
8. `docs/foldkit-constraints.md` — Mount args, subscriptions, `viewInputs`.

## What M2 inherits (read this before designing anything)

The connection **state machine** is done and Story-tested; the **geometry** is not.

Works today:

- `Message.StartedConnection({ from, pointer })` → `Gesture.Connecting({ pointer, from, current, maybeTarget })`,
  and it returns the `MeasureHandles` checkpoint for the visible node ids when
  `model.paneId` is set (`update.ts` → `measureVisible`).
- `MovedPointer` while connecting hit-tests every move:
  `hitTestHandle(model, point, context, { accept: bounds => bounds.type === oppositeHandleType(from.type) })`,
  and writes `current` + `maybeTarget`.
- `ReleasedPointer` → `OutMessage.ConnectedHandles({ source, target })` when a
  target was hit and still exists in `context`; otherwise nothing.
- `CancelledGesture` (pointercancel / blur / Escape) clears the gesture silently.
- Renderer draws `svg.fflow__connection` while connecting: a **straight line**
  from the source handle centre to the hovered target centre (or the pointer),
  with `pointer-events: none`.
- Demo folds `ConnectedHandles` into a new edge (`addEdge` dedupes by
  source/target node id and mints an id).

Provisional, and what M2 replaces:

1. **Edge endpoints ignore handles.** `view.ts` → `edgeEndpoints` anchors every
   edge at `(node centre, node bottom)` → `(node centre, node top)` using
   `model.nodeSizes`. `FlowEdge.sourceHandle` / `targetHandle` exist but nothing
   reads them. §7 M2: “edge endpoints switching from node borders to measured
   handle positions”.
2. **The connection preview is a straight line.** It ignores the handle's
   `position` (`Top`/`Right`/`Bottom`/`Left`), so the line does not leave the
   handle in its own direction the way a Bezier/Step path would.
3. **No `isValidConnection`.** `Context` is `{ nodes, edges }`; the plan’s
   `isValidConnection?: (connection: Connection) => boolean` is absent, and
   nothing rejects a self-loop, a duplicate, or a cycle.
4. **No reconnect.** Nothing to grab an existing edge endpoint with.
5. **`HoveredHandle` is handled but never dispatched.** `update` accepts it and
   writes `maybeTarget` only while connecting; no code sends it. Decide: drive it
   from the pointer layer, or drop the variant and keep hit-testing in `update`.
6. **`Flow.remeasure` exists but is undocumented** (`Remeasure` in
   `runtime/command.ts`), and the three-sentence public contract from §2.5.3 is
   not in `README.md`.
7. **Edge id minting is the demo’s problem** (`nextEdgeId` in the example uses a
   length+sum heuristic). M2 should not inherit that as library behaviour: the
   parent owns edge identity.

## Contract decisions already made (do not re-litigate)

Everything in `docs/M1-HANDOFF.md`’s list still holds. The ones M2 will keep
running into:

- The parent owns nodes/edges/identity; the flow owns interaction state only.
  `update` receives the graph through `context` and never stores it.
- `HandleBounds` are **node-local** (`getHandleBounds` divides offsets by zoom;
  sizes come from `offsetWidth`/`offsetHeight`). Flow-space positions come from
  `context` node positions — which is why `hitTestHandle(model, point, context,
options?)` takes the graph (§M1-FINDINGS §2.3).
- Handle identity is `nodeId` + `type` + `handleId`, in one place:
  `geometry/handles.ts` (`isSameHandle`, `findHandle`, `handleCenter`). Use it;
  do not compare two of the three fields.
- `MergedHandleBounds` merges **per node** and prunes `missingNodeIds`; a
  `MeasureHandles` sweep of a subset must never erase the rest.
- `data-handlepos` is authored markup, not an engine enum: parse it
  case-insensitively against our own literals (`runtime/measure.ts`). Calling
  `fromUpstreamPosition` on it produced `undefined` and silently zeroed every
  bound in M1.
- Measurements are zoom-invariant; do not re-measure per viewport frame. The one
  mutation the node Mount ignores is the node wrapper’s own `style` (the drag
  transform), because a node move cannot change node-local geometry.
- No `document` fallback for subscriptions; resolve the pane root through
  `PaneHost`.
- Nothing live in the Model; `PaneHost` is the boundary.
- Everything engine-specific goes through `runtime/adapter.ts`, pinned at
  `@xyflow/system@0.0.84`.

## M2 scope (from `docs/PLAN.md` §7, quoted)

> **M2 — connections.** Connection gesture (`StartedConnection` →
> `MeasureHandles` → `HoveredHandle` → `ReleasedPointer` → `ConnectedHandles`
> OutMessage) driven by `Flow.hitTestHandle(model, point)` against bounds
> refreshed at gesture start, connection line rendering, an `isValidConnection`
> predicate supplied through `context` and evaluated in `update`, reconnect, and
> edge endpoints switching from node borders to measured handle positions.
> Measurement contract closed out here: merge-only updates
> (`MergedHandleBounds`), `missingNodeIds` pruning, and `Flow.remeasure`
> documented as the answer to stylesheet-only layout changes (§2.5.3).

Turned into a checklist:

1. **`isValidConnection` through `context`.** Add `isValidConnection?: (connection: Connection) => boolean`
   to `Context`, with a `Connection` type (`{ source, target, sourceHandle, targetHandle }`),
   and evaluate it in `update` at release: an invalid target must not produce
   `ConnectedHandles`. Decide and document whether a rejected target is also
   reflected during hover (the plan says “evaluated in `update`”), and whether the
   Model needs a `isConnectionValid` flag for styling the preview.
2. **Edge endpoints from measured handles.** Read `edge.sourceHandle` /
   `edge.targetHandle`, look the bounds up with `findHandle`, and anchor at the
   handle centre with the handle's own `position` as the path's source/target
   position. Fall back to the current node-border anchor when a handle is
   unmeasured or missing, so an edge never disappears because measurement has not
   landed yet. Do this in a pure `geometry/` helper (the renderer should stay a
   thin projection), and test it without a DOM.
3. **Connection line geometry.** Same helper, driven by `Gesture.Connecting`:
   start at the source handle centre with the handle's position, end at the
   hovered target handle centre with _its_ position (or the pointer when there is
   no target). Visual affordance for a valid vs invalid target is optional but
   cheap once (1) exists.
4. **Reconnect.** Drag an existing edge’s endpoint onto another handle. Decide the
   Messages and the OutMessage (`ReconnectedEdge({ edgeId, end: "source" | "target", handle })`
   is the shape M1 would have chosen), the gesture variant (a fourth
   `Gesture.Reconnecting`, or a flag on `Connecting`), and how it fails
   (`CancelledGesture` keeps the edge as it was). The parent applies it.
5. **Close the measurement contract.** README section with §2.5.3’s three
   sentences; `Flow.remeasure(paneId, nodeIds)` documented as the stylesheet-only
   answer; confirm merge/prune semantics are enforced by tests you can point at.
6. **`HoveredHandle`:** either drive it from the pointer layer (a handle’s own
   `OnPointerEnter/Leave`, which needs no `pointermove` and therefore works in
   Scene) or delete the variant. Leaving a handled-but-never-sent Message in the
   union is the one thing not to do.
7. **Demo.** Connect handles for real (`sourceHandle`/`targetHandle` on the new
   edge, `isValidConnection` rejecting self-loops and duplicates), reconnect an
   existing edge, and expose the instrumentation Playwright needs.
8. **Tests.** Story for the connection state machine including rejection and
   reconnect; Scene for a handle press starting a connection and its Command; and
   Playwright for a real connect gesture, a reconnect, and the stylesheet-only
   remeasure case.

## Suggested order

1. `geometry/handles.ts`: an `edgeEndpoints(model, edge, nodes)` helper (handle
   bounds → anchored endpoints + positions, node-border fallback). Pure tests.
2. Wire it into `view.ts` (`edgeEndpoints` currently at `view.ts:247`) and into
   the connection preview.
3. `Context.isValidConnection` + `Connection`; evaluate at release; Story tests
   for accept and reject.
4. Reconnect: Messages, gesture, OutMessage, Story tests, demo.
5. `HoveredHandle` decision, then the measurement-contract docs + README.
6. Playwright proofs; then `docs/M2-FINDINGS.md`.

## Known traps and gotchas

Everything in `docs/M1-HANDOFF.md`’s trap list still applies. New ones from M1:

- **`data-handlepos` is ours, not the engine’s.** Parse it; do not route it
  through `fromUpstreamPosition` (M1 bug: `position: undefined`, Schema validation
  threw once per node, every handle bound was lost while `MeasuredNode` still
  worked — `data-handle-nodes` was 0).
- **Handle elements also carry `data-nodeid`.** Node selectors in tests must be
  scoped (`.fflow__node[data-nodeid="…"]`), and `hitTestHandle` returns the
  topmost match, so a handle id matters, not just its node.
- **Handle press must not drag or pan.** It works because the node wrapper
  carries `classes.NoPan` and the node handler declines when
  `isHandleTarget(target)`; keep both when you touch that markup.
- **`Story.Command.resolve` needs explicit type arguments** for a Command whose
  results are a union: `Story.Command.resolve<"MeasureHandles", Message>(...)`.
- **Scene has no `pointermove`** and its simulated pointer target is built from
  _attributes_ only (no class list). That is why the guards match class **or**
  data attribute (`runtime/domTarget.ts`), and why `.fflow__nodrag` is covered in
  Playwright instead of Scene.
- **Never trust a scripted gesture without asserting it moved something.** Two
  M1 runs recorded idle frames and reported them as frame distributions
  (`M1-FINDINGS` §9, §10). If M2 adds a gesture to the harness, assert the effect.
- **`page.waitForFunction` has no default timeout**; pass one or a broken
  assertion burns the 600 s test budget.
- **A benchmark preview left running owns port 4173** (`reuseExistingServer`), so
  `pkill -f vite` before a full suite run.
- **Hydration is build-id sensitive.** If a browser shows “This page could not
  start safely”, the served HTML and the client bundle are from different builds
  (`M1-FINDINGS` §11) — rebuild and re-serve; a reload cannot fix it.
- **Do not let the first render depend on `location`/`window`.** The demo’s
  `?cull=1` switch made the prerendered HTML disagree with the client and forced
  Foldkit to reconcile a 625-node mismatch.

## Verification and definition of done

```sh
pkill -f vite              # a stale preview owns 4173
pnpm check                 # typecheck, Enfect lint, Prettier, unit tests
pnpm build                 # flow → example → benchmark
pnpm bench                 # Playwright benchmark + all proofs (Brave)
```

M2 is done when:

- an edge drawn between two measured handles starts and ends at those handles,
  and follows them when the node moves or a handle moves;
- an unmeasured/missing handle falls back to the node-border anchor rather than
  dropping the edge;
- `isValidConnection` is evaluated in `update`, a rejected release emits no
  `ConnectedHandles`, and Story covers accept/reject/self-loop;
- reconnect works gesture-to-OutMessage, with `CancelledGesture` restoring the
  original edge;
- `Flow.remeasure` is documented in `README.md` alongside §2.5.3’s three
  sentences, and a Playwright proof shows a stylesheet-only handle move
  recovering an edge endpoint after `remeasure`;
- no handled-but-unsent Message remains in the union (`HoveredHandle` either used
  or removed);
- `pnpm check`, `pnpm build` and `pnpm bench` are green and the benchmark JSON is
  committed; the 1k culled gate still holds (p95 < 33 ms, verified movement).

## Open design questions for M2

- Whether an invalid hover target is shown (needs Model state) or only rejected on
  release. §7 says “evaluated in `update`”; the release is the minimum.
- Whether reconnect is a fourth gesture variant or a flag on `Connecting`. A flag
  keeps the release path in one place but makes `Gesture.Connecting` carry
  `edgeId`; a variant keeps the union honest.
- Whether edge endpoints should read bounds from the Model (fast, needs
  measurement) or measure at render (never allowed — measurement is DOM truth,
  never `view`).
- Whether the connection preview should snap to a hovered target’s centre or only
  when the connection would be valid.
- How much of §3.4’s public helper surface to add now (`Flow.visibleEdges` exists;
  nothing else in that list is M2).

## Working agreements

- Do not edit `docs/PLAN.md` wholesale. Put deviations and proposed diffs in
  `docs/M2-FINDINGS.md`, as M0 and M1 did.
- Do not import `@xyflow/react` or `@xyflow/svelte` outside `packages/benchmark`.
- Do not copy upstream CSS or add an attribution component.
- Do not amend `c40ae47` or `a0a3fdc`; commit at logical checkpoints; ask before
  force-pushing or rewriting history. No network install beyond npm without asking.
- Every claim in the findings document must come from a run at the commit that
  carries it, and stale figures must be labelled historical (`M1-FINDINGS` §12).
