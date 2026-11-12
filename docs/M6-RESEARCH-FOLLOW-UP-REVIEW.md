# M6 follow-up research: response

A review of [`M6-RESEARCH-FOLLOW-UP.md`](M6-RESEARCH-FOLLOW-UP.md), written
**2026-11-12** against the tree that M6's findings commit carries. It is not a
re-litigation of the eleven verdicts: the follow-up proposes four next steps, and this
file says which of them I would take, which I would reshape first, and what each one
collides with in this repository. Where the follow-up corrects me, it says so.

## Summary

| Follow-up | Proposal                                                                     | My verdict                                                                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1        | Gate the first node render on the pane measurement, for the 10k startup cost | **Accept the target, reshape the mechanism.** A blank frame is the fallback, an estimate is the first experiment, and the gate is only meaningful under `cull: true`. Two existing proofs conflict. |
| §2        | A consumer-owned HTML overlay primitive for interactive edge labels          | **Accept.** Two obligations are missing from its proof list (paint order, and the pane handler declining the press), plus one rule about a second tab stop.                                         |
| §3        | A pure resize-policy callback instead of `XYResizer`'s live store            | **Accept, and it corrects my §7 keep-out.** Rename to `canResize`, put it in `Flow.Context`, veto only.                                                                                             |
| §4        | A pure parent-resize child-compensation helper                               | **Accept as a helper**, with a nested-parent subtlety to state, and ranked behind §3 — no consumer needs it yet.                                                                                    |
| §5        | Multi-node resize, if demand justifies it                                    | **Agree with the follow-up** (and with my §9 keep-out): it is a new interaction mode, and the public surface is the expensive half.                                                                 |
| §6        | Composite keyboard navigation                                                | **Agree it is not ready.** Its stated reason is weaker than the real one: roving tabindex needs new _state_.                                                                                        |
| §7        | Handle geometry during resize                                                | **Agree with the keep-out**, and declared geometry is more available here than the follow-up implies.                                                                                               |
| §8        | `nodeOrigin`, `XYResizer`, the culling index                                 | **Agree: no change to the verdicts.**                                                                                                                                                               |

The honest headline: **one of the four reverses a verdict of mine** (§3), one is a
candidate I had already listed with a mechanism I would choose differently (§1), and
two are small pure helpers that are worth having when a consumer asks (§2 is the
exception — it needs a design, not just a helper).

## 1. The 10k startup gate

The target is right and the number is the largest cost in the library: **523 ms to
first view and 1 201 ms to settle** on `/large-expanded.html`
(`packages/benchmark/results/expanded-10k.json`, the run committed with
`docs/M6-FINDINGS.md` §2 — the follow-up quotes the earlier run's 522 / 1 207, which is
the same measurement a run apart).

### What I would change

**There is no way to measure before the first render.** The first `view` pass
necessarily precedes every Mount — that is the ordering `M5-FINDINGS` §8.2 had to fix
from the other side (`MountedPane` must be offered before the first `ResizedPane`
precisely because the pane id arrives from a Mount). So the proposal's "until the first
usable pane rectangle arrives, render no graph nodes" is not "measure, then render";
it is **a blank frame**, and TanStack's `initialRect`/`estimateSize` is not an
"optional future input" but the branch that keeps first paint honest. I would try the
estimate first and keep the gate as the fallback, because:

- a blank frame is a regression at 625 and 1k, where the first paint is 33 ms and the
  page is measured within a frame or two;
- an estimate (the pane element's own box, or a documented `initialPane` renderer
  option) has no blank frame and can be corrected on the first `ResizedPane` exactly
  the way `estimateSize` is;
- the estimate is also what SSR needs (§ "SSR" below): the server cannot measure, and
  the only honest server-side answer is an estimate the client corrects.

**It has to be scoped to `cull: true`.** With culling off — the default, and every
page except the 10k explorations — a gate would suppress nodes nobody asked to have
culled, which is a silent behaviour change for every consumer. The proposal does not
say what happens at `cull: false`, and the answer must be "nothing".

### What it collides with, which the proposal does not mention

1. **`tests/expanded.spec.ts` declares "settled" as `data-measured >= 10 000`.** With a
   gate, only the visible ~280 nodes mount, so `data-measured` never reaches 10 000 and
   the `waitForFunction` times out after its 120 s budget — a hang, not a failure, which
   is the trap `docs/M4-FINDINGS.md` §9 and the handoff both warn about. The readiness
   signal has to be redesigned **with** the gate, not after it.
2. **SSR.** Today a culled page server-renders its graph and hydration does not move it
   (`tests/proofs.spec.ts` proof 4). A gate server-renders nothing and inserts on
   hydration: a pop-in. Proof 4 asserts the _transform_, so it would stay green while
   the property that matters regressed — a `docs/verification.md` shape (green at one
   layer, broken at the next), not a test failure that catches it.

### Verdict

**Strong candidate for the next milestone, as a design with nine measurements**: 625,
1k and expanded 10k, each in three states — today, estimate, gate — reporting first
paint, settle, and the rendered-node count before and after the first `ResizedPane`.
It competes with the small-page startup it can make one frame worse, and
`docs/BENCHMARKS.md` publishes that number.

## 2. Interactive edge labels

Agreed, and the shape is the one this repository already wrote down: the research's §8
names the HTML overlay with `translate(x, y) scale(1/zoom)` (the arithmetic the pinned
engine exports as `getEdgeToolbarTransform`), and `docs/M6-FINDINGS.md` §7 candidate 3
names it as the prerequisite. "The consumer owns the markup and its messages" is the
right line, and it keeps the library out of the control business.

Two obligations are missing from the proof list, and both are this repository's own
failure modes:

- **Paint order.** Upstream's overlay is a sibling layer inside the transformed
  viewport. Here that layer would sit between the edges SVG and the nodes div, which is
  exactly the "one element → its siblings" boundary that broke M4 (`M4-FINDINGS` §14: a
  rule meant for the content hit the four handles, and a container became a filled
  rectangle over its children). The proof has to assert, in pixels, that the overlay is
  above the edges and below the nodes.
- **The pane handler must decline it.** The overlay is a press target inside the pane,
  so it needs the same guard `isChromeTarget` and `isEdgeTarget` have, or every press on
  a label clears the selection and starts a viewport pan. That is not hypothetical: it
  is the bug the edge press would have had without `isEdgeTarget`
  (`docs/M6-FINDINGS.md` §3).

One rule to state before it is designed: our edges are now `role="button"` tab stops
(§2 of the research), so a focusable consumer control positioned over an edge adds a
second tab stop at the same place. It is not nested — different layers — so it is not
an ARIA violation, but the tab sequence has both, and the contract should say so.

## 3. Resize vetoes and per-node resize policy — this corrects me

**Accepted, and I was wrong about the mechanism.** My §7 keep-out said "a per-frame
veto callback is a second owner of the gesture". That is true of upstream's
`shouldResize`, which rolls back the parent box, the start position _and_ every child's
position (`@xyflow/system@0.0.84` `dist/esm/index.js:3607`–`:3615`). It is not true of a
predicate that receives `{ node, start, next, modifier }` and returns a boolean: that is
a pure function, and this library already has exactly one of those as its policy seam —
`isValidConnection` in `Flow.Context`, evaluated in `update` on every release. A resize
predicate belongs in the same place for the same reason.

Constraints I would add, because they are the difference between a predicate and a
second owner:

- **Name it `canResize`, not `ResizePolicy`, and put it in `Flow.Context`.** `Context`
  is rebuilt per dispatch by the consumer, so it costs nothing, and it matches the one
  policy hook the library already has.
- **Veto only. It must not return a box.** A predicate that returns a `Rect` is an
  axis-lock feature wearing a callback's clothes: the moment it can rewrite the box it
  owns the gesture, and the snapshot the rest of the machine reads stops being the
  gesture's own. "Reject this frame, keep the last accepted box" is the whole feature,
  and it is a one-line change in `update`'s `MovedPointer` resize branch plus a rung-1
  test.
- Per-node "resize horizontally only" stays data or consumer policy, as the follow-up
  says. With a veto it is expressible as "reject any frame that changes the height",
  which is enough, and it does not recreate `XYResizer`'s prop/update channel.

**Record change**: this reverses `docs/M6-RESEARCH.md` §7's `shouldResize` keep-out. When
it is built, the research's §7 and `docs/M6-FINDINGS.md` §4 have to point at the
follow-up rather than keep the old verdict as the last word. I have not edited either
document, because a verdict changes when the code does.

## 4. Parent-resize child compensation helper

**Accepted as a helper**, and the follow-up is right about why: the keep-out was about
persistence, not arithmetic. Two things to state when it is written:

- **The delta is the parent's, in the parent's own space.** Children's positions are
  relative to their parent, so a nested container's children compensate by the _parent's
  own_ position change — which, for a child that is itself a parent, is a relative
  number, not an absolute one. The helper has to take the same `(before, after)` pair
  the consumer persists, or a nested case is off by the grandparent's offset.
- **Grandchildren are not in the pass.** Upstream compensates one level (`childChanges`
  per direct child); grandchildren follow because their own parents did. The helper's
  docblock should say "direct children" rather than leave it to be discovered.

Rank: behind §3. No consumer in this repository needs it today — the demo and the seven
examples have no container that is resized with children inside it — so it is a
"ship when asked" item with a rung-1 test, not a milestone goal.

## 5. Multi-node resize

Agreed on both sides: it is a new interaction mode, not a gap in the existing one, and
it should wait for a concrete consumer. The one thing worth adding is where the cost
actually is — not the gesture, but the **public surface**: `ResizedNodes` carries one
box per node today, and a selection-scale would need a scale and a translation per node
plus a `NodeTools.scale` for the consumer's content. That is the design work, and a
loop over the single-node path (which the follow-up correctly forbids) would produce a
worse version of it.

## 6. Composite keyboard navigation

Agreed that it is not ready — and the follow-up's reason ("a graph is not a grid") is
the weaker half of the argument. The stronger half is **state**: the roving-tabindex
pattern the W3C APG prescribes for a composite widget needs an _active item_ that
survives focus leaving and returning, which is new Model state (or new host-registry
state), and Foldkit replays Models under DevTools time travel — so it would have to be
replay-safe in a way a DOM-only focus ring is not. That is the design question, not the
navigation model alone.

Worth stating plainly for the record: **the current behaviour is conformant**, not
merely "safer". The APG says "the default order of elements in the tab sequence is the
order of elements in the DOM", which is exactly what the library does, for nodes before
M6 and for nodes and edges after it.

## 7. Handle geometry during resize

Agreed: no general exact fix exists for arbitrary consumer DOM, and the current keep-out
stands. One correction in the library's favour: the follow-up's future option "a
consumer-declared handle geometry mode" is **already supported by the pinned engine** —
`parseHandles` (`@xyflow/system@0.0.84` `dist/esm/index.js`, next to `adoptUserNodes`)
reads `userNode.handles` as `{ id, x, y, width, height, position, type }` and falls back
to the measured `handleBounds` only when a node declares none. So a declared-geometry
mode here would not need an engine change, and this library's `tools.handle` spec
already has the declaration in the view — it is dropped at the moment of measurement.

That does not make it a fix: a declared handle still has to agree with what the
consumer's CSS draws, and a wrong declaration moves an endpoint every frame instead of
late. It makes it _available_, which is a different claim from the follow-up's.

## 8. `nodeOrigin`, `XYResizer`, the culling index

No change, for the reasons the follow-up gives and the research's §3, §5 and §1 give.
The culling index has one sentence I would keep to hand: it is cheap to reconsider _if_
the scan approaches the frame budget, and tldraw's R-tree took two releases (#8882 →
#9093) to stop its own maintenance being O(page) per update — so an index here is a
project, not a patch.

## What the follow-up is missing, as a document

- **Its numbers are from the earlier run.** 522 / 1 207 ms against the committed
  run's 523 / 1 201 ms. Small, but this repository's rule is that a figure comes from the
  run at the commit that publishes it (`M1-FINDINGS` §12, `BENCHMARKS.md`), and the
  follow-up has no commit to name.
- **Its citations stamp "fetched 2026-11-12" on pages that carry their own date.** The
  React Flow pages it cites say _Last updated on October 11, 2026_; the research uses
  that stamp. MDN it cites correctly (last modified 2025-11-07).
- **It does not cite the two proofs it collides with** (`tests/expanded.spec.ts`'
  readiness signal and `tests/proofs.spec.ts` proof 4), which are the cheapest part of
  the design to get right and the most expensive to discover late.
- **It is untracked and not in the format scripts.** A new findings, research or review
  document is added to both `format` and `format:check` in the root `package.json`
  (`docs/M6-HANDOFF.md`, "Formatting"). This response is.
- **It should be cross-linked.** `docs/M6-RESEARCH.md` §7 and `docs/M6-FINDINGS.md` §4
  still carry the `shouldResize` keep-out as the last word; §3 above reverses it. The
  link belongs in both, when the code changes.

## Second revision: the follow-up took the review

`docs/M6-RESEARCH-FOLLOW-UP.md` was revised the same day against this file. Every
substantive point above landed, and the record of _what_ landed belongs here rather than
in a silent edit, so that the two documents do not disagree about which version of the
argument is current.

| Point in this review                                    | Where the revision puts it                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbers from the earlier run (522 / 1 207)              | §1 now quotes the committed 523 / 1 201 and cites `M6-FINDINGS.md` §2 and `expanded.spec.ts`                                                                   |
| The gate must be scoped to `cull: true`                 | §1 states it, and says `cull: false` must preserve today's behaviour                                                                                           |
| "Measure, then render" is a blank frame; estimate first | §1's proposal is now three measured states with the estimate leading and the gate as the fallback, and its required proof is the 3 × 3 grid at 625, 1k and 10k |
| The `data-measured >= 10 000` readiness signal breaks   | §1 says it is incompatible and must be redesigned                                                                                                              |
| SSR/hydration must be measured, not assumed             | §1 says so and names what proof 4 does _not_ check                                                                                                             |
| §2's missing paint-order and pane-handler obligations   | Both are in its required proof, and the second-tab-stop consequence is stated                                                                                  |
| `canResize`, veto only, not upstream's `shouldResize`   | §3 is renamed, says it reverses the keep-out, and rules out both `XYResizer` and a returned box                                                                |
| §4's nested-parent subtlety                             | §4 says the helper takes the parent's own before/after pair, never an absolute grandparent position, and covers direct children only                           |
| §6's reason is state, not the grid analogy              | §6 gives the active-item/replay-safe argument and says the current behaviour is _conformant_                                                                   |
| §7's declared-geometry option                           | §7 now cites `userNode.handles` and adds that a declaration is only correct when it agrees with the consumer's CSS                                             |
| Stamps                                                  | The two React Flow citations now carry _last updated 2026-10-11_; the pages with no stamp keep "fetched"                                                       |

Three things the revision leaves, all small enough to settle before any code:

1. **Where the estimate comes from.** §1 offers "the pane element's initial box or a
   documented `initialPane` renderer option". The first half is not available: the pane
   element does not exist until the first `view` has been patched, and every Mount runs
   after that — which is the same ordering the section itself relies on. Only a declared
   rect can be read before the first render, so the option is the whole mechanism, and
   it belongs on **`Flow.init`** (which is where `model.pane` is zeroed,
   `model.ts:278`), not on `createRenderer`: the renderer does not own the Model, and
   culling reads `model.pane`.
2. **What a veto keeps.** §3 says a returning `false` "would reject that frame". It
   should say _which_ box the gesture then holds — the last accepted one, not the start
   box — or a consumer cannot express "this node may grow but not shrink below its
   current size" without the gesture snapping back to where it began.
3. **The cross-link.** Neither document points at the other. `M6-RESEARCH.md` §7 and
   `M6-FINDINGS.md` §4 still carry the `shouldResize` keep-out as the last word; when
   `canResize` ships, all four documents should agree, and until then the follow-up and
   this review should at least point at each other.

One correction to this review, not the follow-up: **the duplicated `docs/M6-RESEARCH-FOLLOW-UP.md`
glob in `format` and `format:check` was mine.** The revision's working tree removes the
copy; the duplication came from inserting the follow-up into a list that already had it.

The recommended order below is unchanged by the revision. `canResize` is still first
because it is the smallest, the most clearly correct, and the only item that closes a
keep-out.

## Recommended order

1. **`canResize` in `Flow.Context`** (§3). The smallest item, the most clearly correct
   one, and it closes a keep-out. One rung-1 test and one rung-2 sequence.
2. **The 10k startup design** (§1) with the nine measurements, the readiness signal
   redesigned first, and an estimate as the leading candidate rather than a blank frame.
3. **The edge overlay primitive** (§2), when a consumer actually needs an edge control —
   it is a layer with a paint-order proof, not a helper.
4. **`compensateChildPositions`** (§4) on request, with the nested-parent note.
5. Everything else stays out until a consumer asks, and §5–§7 are design questions with
   their own documents.

## Sources

- `docs/M6-RESEARCH-FOLLOW-UP.md` (the document this responds to, read 2026-11-12)
- `docs/M6-RESEARCH.md` §1, §3, §5, §7, §8, §9, §10 — the verdicts under discussion
- `docs/M6-FINDINGS.md` §2 (the numbers), §3 (the ships and their proofs), §4 (the
  keep-outs), §7 (the candidates)
- `@xyflow/system@0.0.84` `dist/esm/index.js`: `shouldResize`'s rollback
  (`:3607`–`:3615`), `parseHandles` / `userNode.handles`, `getEdgeToolbarTransform`
  (`:1601`)
- `tests/expanded.spec.ts` (the `data-measured` readiness signal),
  `tests/proofs.spec.ts` proof 4 (SSR/hydration), `docs/verification.md` (the boundary
  rule), `docs/M4-FINDINGS.md` §14 and `docs/M5-FINDINGS.md` §8.2 (the two orderings
  §1 depends on)
- W3C ARIA APG, "Developing a Keyboard Interface" — DOM order _is_ the tab sequence
  (fetched 2026-11-12; the same source `M6-RESEARCH.md` §2 cites)
