# Verification: how not to ship a correct implementation nobody can see

This file exists because of a pattern, not a single bug. Three times in a row a
milestone shipped with green tests — 194 unit tests and 35 browser proofs at M3,
271 and 44 at M4 — and a person using it found something broken within minutes:

| Report                                                                  | What was "correct"                                           | What was wrong                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| "the connection works but the edge is invisible" (`M3-FINDINGS` §14)    | every path in the DOM with the right `d`, stroke and `1.5px` | a 0×0 SVG viewport made `non-scaling-stroke` degenerate: nothing painted |
| "the preview is drawn way above the pointer" (`M3-FINDINGS` §11)        | the `<g>` had a transform attribute                          | CSS-form `translate(20px, …)` in an SVG attribute: inert                 |
| "it only changes its visual size after I release" (`M4-FINDINGS` §14)   | the wrapper's `getBoundingClientRect()` grew, mid-gesture    | the consumer's content was not told, so only the wrapper grew            |
| "it stays grey, with a bar at the top and the side" (`M4-FINDINGS` §14) | `data-boxed` was set, the content stretched                  | the stretch also hit the four 10×10 corner handles                       |

Each one had a test. Each test measured the thing the code produced, at the layer
the code produces it. The user was looking one layer further out.

## The rule

**Assert at the layer the user perceives, and name that layer in the test.**

Between the Model and the eye there are at least six boundaries, and every one of
them has produced a bug in this repo. Each has exactly one kind of assertion that
crosses it:

| Boundary                     | What hides there                                                             | The assertion that crosses it                                                           | Seen in                 |
| ---------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| Model → DOM value            | right number, wrong space or units (`translate(20px)` in an SVG attribute)   | read the **screen** result (`getScreenCTM`, `getBoundingClientRect`), not the value     | M3 §11                  |
| DOM value → paint            | element present, nothing drawn (zero-sized ancestor, marker not resolved)    | screenshot two states differing only in the thing under test; count pixels              | M3 §14, M4 proofs 42–43 |
| Element box → content layout | wrapper grows, content does not (a resize, a scroll region, a container)     | compare the **consumer's** root rect to the wrapper's, during the change                | M4 §14                  |
| One element → its siblings   | a rule meant for content hits chrome, handles, or changes paint order        | assert the neighbours' geometry too (a handle stays 10×10; the edges layer stays below) | M4 §14, M3 §3           |
| Overlay → committed data     | geometry built from committed state during a gesture                         | assert **mid-gesture**, then again after release, and compare the two                   | M3 §15, M4 §14          |
| Source → served bundle       | a stale `dist`, a preview serving the last build, CSS inlined at bundle time | rebuild all three, let the harness own the server, `pkill -f vite`                      | M1 §11, M4 §14          |

Two questions catch most of it before a test is written:

1. **What does the user look at?** Not "what does `update` produce" — the pixels,
   the content inside the box, the thing under the pointer.
2. **Which boundary is between that and my assertion?** If there is one, cross it
   or say in the test why you are not.

## Four rules that come from the failures

### 1. A gesture is asserted in flight, not at rest

`M3-FINDINGS` §15: edges hung at the node's old place for the whole drag and
snapped into position on release. The release was correct, the gesture was not.
`M4-FINDINGS` §14 is the mirror: the release was correct (the box persisted), the
gesture was invisible. Both are one assertion away — measure **while the pointer is
down**, then again after release, and compare the two.

### 2. One rule, one home

When a predicate is needed in several places, N−1 of them will drift. M4 shipped
`hidden` filtering implemented in `visibleNodes`, `visibleEdges`, `fitViewport`,
`selectAll` and the description, and three of them disagreed
(`M4-REVIEW` findings 1–3). The fix was not "fix three bugs" but `shownEdges` —
one function the three call sites share. The same shape appeared in CSS: a stretch
rule meant for "the content" was written as `> *` and hit the chrome.

When a rule genuinely cannot live in one place, add a test that asserts the call
sites **agree** on the same input, not that each one works.

### 3. Publish facts; do not impose layouts

The library draws geometry; the consumer draws looks. The one time M4 broke that —
stretching a boxed node's children to fill its box — it restyled a container into a
filled rectangle and ate the four resize handles. `NodeTools.size` and the
`data-boxed` attribute carry the same information without deciding what it means,
and the consumer writes one line of CSS. Any default that restyles consumer data
needs to be proved on **at least two consumer shapes**: the demo's node and the
benchmark page's label/container are different shapes, and they disagreed.

### 4. The bundle is not the source

`M1-FINDINGS` §11 was build skew (a stale `data-foldkit-build` stamp); the M4
version was subtler: the benchmark bundle inlines `@fllstck/foldkit-flow/style.css`
at **its own** build time, so rebuilding the library and the example leaves the
benchmark page serving the previous CSS — and two proofs "failed" against code I
had already fixed. Before a browser run, in this order: `pkill -f vite`,
`pnpm typecheck`, `pnpm build` (all three), then the browser. When behaviour does
not match the source you just read, suspect the served artifact before the code.

## The checklist for a visual feature

Run this before calling one done. It is deliberately five questions, not a
bureaucracy:

1. **Pixel**: is there an assertion that compares painted output for two states
   differing only in this feature? (`chrome.spec.ts` proof 36, `m4.spec.ts` 42–43)
2. **Content, not wrapper**: if the feature changes a box, does the assertion
   measure the consumer's content too? (`m4.spec.ts` 44)
3. **Mid-flight**: is there an assertion while the pointer is down, and does it
   agree with the post-release one? (proofs 37, 44)
4. **Neighbours**: did you assert what must _not_ change — a handle's size, another
   node's transform, the edges layer's z-order? (proofs 36, 44; `view/culling.test.ts`)
5. **Second consumer**: does the thing work on the other page that renders it
   (`/subflow.html`, `/large.html`, the demo) after a full `pnpm build`?

## What is already mechanical here

- Pixel proofs for anything drawn: edges (36), markers (42), labels (43).
- Screen-space geometry instead of attribute reading: the connection preview (32)
  and the minimap click (46) both convert through `getScreenCTM`.
- Content-vs-wrapper and neighbour assertions for resizing (44).
- One shared predicate where the rule has several call sites (`hiddenIds`,
  `shownNodes`, `shownEdges`, `positionIndex`).
- Review discipline: every milestone's findings document records the reports, and
  the review files name what the tests could not see.

## What remains judgement

No test can tell you a box "looks broken". The three reports above were found by a
person _using_ the thing, and the cheapest mitigation is to do that: after each
milestone, open the demo and the new benchmark pages, resize something, drag
something, collapse something — and look at a **readable** screenshot (2× device
scale; a 500×180 JPEG can hide a whole missing label, which is how one of the M4
screenshots looked "fine" while the node had no content).
