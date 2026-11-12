# M7 findings: three keep-outs closed, and what proves them

`docs/M6-RESEARCH-FOLLOW-UP.md` is the proposal and
`docs/M6-RESEARCH-FOLLOW-UP-REVIEW.md` the cost; this is the record of what M7 built,
what proves it, and what it deliberately left. Written at the commit that carries it,
2026-11-12, against `docs/M7-HANDOFF.md`.

## 1. What M7 changed

| Ship                                   | Public surface                                                                           | The rung that proves it                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A resize veto                          | `Flow.Context.canResize`, `Flow.ResizeAttempt`                                           | rung 2, four tests in `state.test.ts`                                       |
| Parent-resize compensation as a value  | `Flow.compensateChildPositions` and its three input/output types                         | rung 1, five tests in `geometry/compensate.test.ts`                         |
| Edge controls in a flow-anchored layer | `RendererConfig.edgeOverlay`, `fflow__overlays` / `fflow__overlay`, `data-fflow-overlay` | rung 3, three tests in `view/selection.scene.test.ts`; rung 5, proofs 52–55 |

Nothing was removed, nothing defaulted on, and no Message or OutMessage changed shape.
A consumer that sets none of the three sees the same DOM, the same Model and the same
frames as M6. Each ship edits the M6 verdict it closes (`M6-RESEARCH.md` §6, §7, §8;
`M6-FINDINGS.md` §4), because a verdict changes when the code does.

The three were taken in the order the handoff set: the two pure functions first (one
sitting), then the overlay, which was a design before it was code.

## 2. The three ships

### `Flow.Context.canResize` — a veto, not a box

```ts
canResize?: (attempt: {
  node: FlowNode<NodeData>;
  start: Rect;
  next: Rect;
  modifier: boolean;
}) => boolean;
```

Asked once per pointer event in `MovedPointer`'s `Resizing` branch, on the **proposed**
box before it becomes `Gesture.Resizing`'s `current`. The properties, each deliberate:

- **A rejected frame keeps the last accepted box**, not the start box. That is the
  difference between "this node may not shrink below 200×120" and "the gesture snaps
  back to where it began": a box that walks through accepted frames holds its last good
  value through a rejected one.
- **`StartedResize` is not gated.** A gesture starts and its frames decide; there is no
  "may this node be resized at all" question at press, because the answer would have to
  be as live as the frames are (a node can become too small mid-gesture).
- **A policy that throws propagates.** Nothing is caught, for the same reason
  `isValidConnection` does not catch: a predicate that throws is a bug in the
  consumer's `update`, not a frame to skip.
- **A gesture whose every frame is rejected reports nothing on release**, since the box
  never changed, and a node the parent removed mid-gesture rejects by absence — the
  missing node is not a `FlowNode`, so `isAccepted` is false and the gesture is dropped
  by `informGraphChanged` on the next dispatch anyway.

This reverses the `shouldResize` half of M6's §7 verdict, and only that half. The M6
reason named upstream's callback, which returns a replacement box and rolls back the
parent's box, the start position and every child's position
(`@xyflow/system@0.0.84` `dist/esm/index.js:3607`–`:3615`). A predicate that can only
say no has none of those powers, and it sits in `Context`, which the consumer rebuilds
per dispatch — the same seam and the same cost as `isValidConnection`.

### `Flow.compensateChildPositions` — the arithmetic as a return value

```ts
compensateChildPositions({
  parentBefore, // the parent's box when the gesture began
  parentAfter,  // the parent's box after it
  children,     // direct children: { nodeId, position }
}): ReadonlyArray<{ nodeId: string; x: number; y: number }>
```

The formula is upstream's, with the origin this library actually has:

```
child.x -= parentAfter.left - parentBefore.left
child.y -= parentAfter.top  - parentBefore.top
```

- **Direct children only.** A grandchild's position is relative to its own parent, so it
  follows when that parent is compensated. The docblock says so rather than leaving it
  to be discovered.
- **The parent's own before/after pair**, never a delta recomputed from a grandparent's
  absolute position: for a nested container the delta is relative, and an absolute one
  is off by the grandparent's offset (`M6-RESEARCH.md` §6).
- **It returns; it applies nothing.** A consumer that folded nothing would see its
  children compensate during the gesture and snap back on the next render — the
  `M4-FINDINGS.md` §14 shape. The library supplies the arithmetic; the consumer's
  `update` persists it, which is the only place the graph exists.
- **A bottom-right resize compensates zero**, because the anchor did not move. The
  helper returns the same positions rather than inventing a delta from the size change.

### `RendererConfig.edgeOverlay` — a layer, designed before it was built

```ts
edgeOverlay?: (edge: FlowEdge<EdgeData>, h: HtmlBuilder<any>) => Html;
```

The design note, which is the part the handoff asked for:

- **Where it sits.** A `div.fflow__overlays` inside `.fflow__viewport`, between the
  edges `<svg>` and the nodes `<div>`. Inside the viewport because it has to pan and
  zoom with the graph; before the nodes because it must paint **above the edges and
  below the nodes**, and the nodes' own positioned wrappers make DOM order the whole
  rule — no `z-index` joins the cascade.
- **How the anchor is cancelled.** One item per edge, in flow space, with
  `translate(labelX, labelY) scale(1 / zoom) translate(-50%, -50%)` and
  `transform-origin: 0 0`. The origin is not decoration: with the default centre origin
  the item drifts with the zoom (proof 52 measures 13.75 px at zoom 0.694), and the
  third translate centres the item's own unmeasured box.
- **Who owns what.** The library owns the anchor, the transform, the paint order and the
  press guard; the consumer owns the markup and every Message in it. That is a render
  hook rather than a `panel(...)`-style helper because the item is _anchored per edge_
  and `panel` returns one block of markup outside the transform — the two shapes do not
  compose.
- **The pointer policy.** The layer and each item are `pointer-events: none`, so a
  decorative item cannot swallow a press meant for a node or an edge underneath. A
  control opts back in with `pointer-events: auto` on the consumer's own element.
- **The press guard.** `isOverlayTarget` in `runtime/domTarget.ts`, matched by
  `[data-fflow-overlay]` rather than a class so a consumer-built item is exempt without
  knowing the library's names. Without it the pane handler clears the selection and d3
  starts a pan from the same press — proof 54 watches that fail.
- **The second tab stop.** Edges are `role="button"` tab stops when `edgeSelection` is
  on, and the layer renders after them, so the sequence is every edge, then every
  edge's control, then every node. It is not an ARIA violation — the control is a
  sibling layer, not a descendant of the edge's group — but it is two stops at one
  visual place, and the contract says so.
- **`renderEdgeLabel` stays content-only.** Two ways to put content on an edge is a
  documentation cost, paid deliberately: `<text>` for text that sits on the edge, this
  for anything a user operates. Widening the label hook would have made SVG `<text>` a
  container for controls and moved the accessibility story nowhere good.

## 3. What proves each claim

Rung 1 for the pure arithmetic, rung 2 for the state-machine branch, rung 3 for the
layer's existence/wiring/guard, rung 5 for everything about the screen.

**Unit (346 Vitest: 323 flow, 23 example).**

- `geometry/compensate.test.ts` — five, rung 1: a top-left resize keeps the children
  where they were on screen; a bottom-right resize compensates nothing; only the direct
  children passed in are answered; no children is no work; the inputs are not mutated.
- `state.test.ts`, "resize policy (§7 M7)" — four, rung 2: a rejected frame keeps the
  last accepted box, not the start box; a policy that rejects every frame reports
  nothing on release; the policy is not asked for a drag or a connection; the policy is
  asked with the start box, the proposal and the live modifier (a spy pins the
  arguments).
- `view/selection.scene.test.ts` — three, rung 3: one item per edge anchored with the
  inverse zoom, a press on the overlay is the consumer's, and no config means no layer.

**Browser (65 Playwright, `tests/m7.spec.ts`), each watched failing first.**

- **52** — the item's centre is the label point at zoom 1 and again at 0.694, and its
  screen size is 90×24 at both; then the same measurement after a pointer pan. Fails
  with `transform-origin` at its default (centre 13.75 px off at the second zoom) and
  with `scale(1/zoom)` removed (62.5 px wide).
- **53** — the item paints above the edges and below the nodes, in pixels, in two
  states. Fails when the layer renders after the nodes div (817 magenta pixels inside
  the node that should have covered them); for the item over empty canvas, hiding the
  layer replaces its pixels with the edge stroke.
- **54** — a press _and a drag_ on the item leaves the viewport and the edge selection
  alone, a plain click is the consumer's Message, and Tab reaches: every edge, then
  every edge's control, then every node. Fails with `isOverlayTarget` removed. The page
  uses a `div[role=button]` for the control because `blocksDrag` already exempts form
  controls, so a real `<button>` would have passed that mutation for the wrong reason.
- **55** — a second consumer, `/examples/resizing/`: one item per edge, its centre on
  the Bezier's label point (the painted path's endpoint average), the edge focused and
  `Tab` then reaching the harness's own `<button>`, `Enter` producing the example's
  `ClickedEdgeAction` while the edge stays selected, and a drag on the control moving
  neither the viewport nor the selection. Watched failing with `edgeOverlay` turned off
  in the example's spec: no `[data-fflow-overlay]` ever mounts.

The page `/m7.html` (`src/fixture.ts` → `overlayFlow`) is two straight edges, one label
point over empty canvas and one inside a node, so the paint-order claim is two
comparisons against one clip and the label point can be read off the painted path
(`getPointAtLength(length / 2)`) instead of trusting the transform under test.

## 4. The gate, at this commit

`pnpm bench`, 65 tests, 5.1 min, one worker. Frame durations in ms as
`median / p95 / longest`, frame count in parentheses.

| Leg               | Foldkit                  | React Flow               | `cullScanMs` |
| ----------------- | ------------------------ | ------------------------ | ------------ |
| 625 pan           | 16.7 / 16.8 / 16.8 (479) | 16.7 / 16.7 / 33.2 (507) | 0.410        |
| 1k culled pan     | 16.7 / 16.7 / 16.8 (471) | —                        | 0.652        |
| 1k + chrome pan   | 16.7 / 16.7 / 16.8 (473) | —                        | 0.638        |
| 10k collapsed pan | 16.7 / 16.7 / 33.3 (253) | —                        | 3.392        |
| 10k expanded pan  | 16.7 / 16.8 / 33.4 (268) | —                        | 5.150        |

**The gate holds, and M7 cannot move it.** No M7 ship is on a gate page: `/m7.html`
and `/examples/resizing/` are their own pages, the resize policy is an absent-by-default
`Context` field, the compensation helper is not called by any library code path, and
the overlay is one opt-in layer. Zero long frames in every pan leg (1 944 frames across
the five legs above); the 2 % bound is never approached.

The 10k explorations keep their character: 280 of 10,000 nodes rendered at expanded 10k,
with **537.5 ms to first view and 1 192.9 ms to settle**, and 200 of 10,000 at collapsed
10k. The startup pair sits either side of M6's (523 / 1 201) — 3 % slower to first view,
under 1 % faster to settle — and the expanded `cullScanMs` is 5.150 against M6's 5.422.
No M7 change touches startup, the culling scan or the node cache, so these are
run-to-run variation on the same machine, and they stay outside the gate.

## 5. Deviations, and what a review should look at first

1. **The overlay is a render hook, not a `panel`-style helper** (open question 2 of the
   handoff). The item is anchored per edge; `panel(...)` returns one block of markup
   outside the transform. `edgeOverlay(edge, h)` is the smallest shape that keeps the
   anchor in the library and the markup in the consumer.
2. **The overlay does not absorb `renderEdgeLabel`'s interactive case** (open question
   3). `renderEdgeLabel` stays the text hook; this is the control layer. The
   documentation cost is paid rather than avoided, with both hooks described together
   in `CONTRACT.md`.
3. **No per-node `resizable` field** (open question 1). The veto expresses per-node
   policy for the graph (`node.id` is in the attempt), and a node the consumer wants
   frozen rejects every frame; the gesture then reports nothing. A data field would be
   a second policy owner and a second thing to keep live mid-gesture.
4. **Declared handle geometry (handoff item 4) was not built.** No consumer asked, and
   it is exact only when the declaration agrees with the consumer's CSS — a wrong
   declaration moves an endpoint every frame instead of one late. Keep-out 9 stays
   partial, with the same trigger as before.
5. **The 10k startup design stays out** (handoff "Not in M7"), unchanged in cost and
   trigger. Its open question stands: an estimate cannot come from the pane element,
   which does not exist until the first `view` has been patched, so it would be a
   declared rect on `Flow.init`.

A review should look first at the two claims a DOM test cannot see: proof 52's second
zoom (the inverse-zoom transform and its origin) and proof 53's paint order. Both are
screenshots, both were watched failing under a one-line mutation, and both are the kind
of claim `docs/verification.md` exists for.

## 6. What M7 did not ship

Unchanged keep-outs, each still with a trigger: `XYResizer` (§3), `nodeOrigin` (§5),
multi-node resize (§9), the culling index (§10 of the research, 0.434–6.122 ms of a
16.7 ms frame), handle geometry during a resize beyond today's one-frame lag (partial),
minimap wheel-zoom and minimap node targets, and the 10k startup design. `1.0.0` still
waits for real use, not for a milestone.

## 7. Verification

At the tree this document was written on:

```sh
pkill -f vite
pnpm typecheck   # flow, benchmark, example
pnpm build       # all three; the benchmark inlines the library CSS
pnpm check       # typecheck, Enfect lint, Prettier, 346 Vitest tests
pnpm bench       # 65 Playwright tests, 5.1 min
```

All four are green, the gate is unchanged, and no browser run was started before the
build that a browser serves. `0.2.0` is prepared at this commit: the version bumped,
the changelog dated, and the tag on the release commit. No npm publish and no push
happened as part of M7 or the release preparation.
