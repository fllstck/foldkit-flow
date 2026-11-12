# The contract

Everything the library promises a consumer, feature by feature. This is the
reference the README points at; the README is the front door (what this is, how to
install it, the shortest path to a working flow), and the design reasoning lives in
[`PLAN.md`](PLAN.md) with the evidence in [`BENCHMARKS.md`](BENCHMARKS.md) and the
milestone records.

Published surface: `@fllstck/foldkit-flow` `0.1.1`, ESM, peers `foldkit@0.170.0`
and `effect@~4.1.0`.

## Contents

- [Measuring the graph](#measuring-the-graph)
- [Connections](#connections)
- [Chrome](#chrome)
- [Graph features](#graph-features)
- [Accessibility](#accessibility)

---

## Measuring the graph

Handles are geometry, and geometry is DOM truth: it is measured in the node Mount
and stored node-local in the Model (`HandleBounds`), never read from `view`. The
contract a consumer has to act on is three sentences (`docs/PLAN.md` §2.5.3):

1. While a node's DOM changes through the renderer — its content, its handles,
   styles it applies itself — geometry stays fresh automatically, because a
   `ResizeObserver` watches the node and a `MutationObserver` watches its subtree,
   coalesced to one measurement per animation frame.
2. If **external CSS** changes layout without producing either event (a class on an
   ancestor, a theme swap, a CSS-variable change), call
   `Flow.Remeasure(paneId, nodeIds)`.
3. Until you do, hit-testing is still correct — every connection gesture starts with
   a `MeasureHandles` checkpoint — but **edge endpoints may point at the old handle
   position**.

```ts
// after a theme swap that moved one node's handles
Flow.Remeasure(paneId, ["a"]);

// every visible node. There is no implicit "measure everything" overload: the cost
// is one getBoundingClientRect per node plus two querySelectorAll passes.
Flow.Remeasure(
  paneId,
  Flow.visibleNodes(model.flow, nodes).map((node) => node.id),
);
```

`Flow.Remeasure` is the same `MeasureHandles` Command under a public name, so it
inherits merge semantics: measuring a subset replaces only those nodes' bounds, and
a node it was asked about but could not find is pruned instead of being kept stale.
Return the Command through the parent's dispatcher, as the demo's **Remeasure**
button does.

## Connections

Connect by dragging a handle, reconnect by dragging an edge end. Both are
gestures in `Flow.update` against measured geometry, and both report a fact the
parent applies:

| Gesture                                                                | OutMessage                                 |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| `StartedConnection`, `MovedPointer`, `ReleasedPointer`                 | `ConnectedHandles({ source, target })`     |
| `StartedReconnect` (from an edge end's grab handle), `ReleasedPointer` | `ReconnectedEdge({ edgeId, end, handle })` |
| `CancelledGesture` (pointercancel, blur, Escape)                       | nothing — the parent's edge is untouched   |

A gesture may start at either kind of handle, and a release lands if it is within
`Flow.connectionRadius` (20 screen pixels) of a handle rather than exactly on its
box — a handle is about 7px on screen, and "drop it on the node" is what people
do. The preview leaves the handle the user grabbed, but the fact is oriented by
handle type, so `ConnectedHandles.source` is always the `Source` handle and
`target` always the `Target` one — dragging a
target handle onto a source handle produces the same `n1 → n2` edge the other
direction does, and the predicate sees it that way round too.

`Flow.Context` may carry the parent's policy, which `update` evaluates on release:

```ts
const contextFrom = (model: Model): Flow.Context => ({
  nodes: model.graph.nodes,
  edges: model.graph.edges,
  // Asked with { source, target, sourceHandle, targetHandle }. A rejected
  // release emits no OutMessage, so there is nothing for the parent to undo.
  isValidConnection: (connection) => !wouldCreateCycle(model.graph, connection),
});
```

The predicate is asked at release only — hover still previews the target — and it
judges a reconnect as well, with the end that did not move supplying the other
half of the connection. No predicate means "accept everything".

Because a rejection is silent by design (no OutMessage, nothing to undo), the
consumer is where the feedback belongs: the demo reads the hovered candidate from
`model.flow.gesture` and shows it, so a duplicate reads as "rejected" rather than
as a broken gesture. The library's own `data-connection-target` instrumentation on
the pane is available for the same purpose.

Edge endpoints come from measured handles: `edge.sourceHandle` /
`edge.targetHandle` name the handle, the path starts and ends at the handle's
centre, and it leaves along the handle's own `position`. An edge that names no
handle uses the node's first handle of that type; a handle that is unmeasured or
missing falls back to the node-border anchor, so an edge never disappears because
measurement has not landed yet.

## Chrome

Chrome is ours: `packages/flow/style/flow.css` is written from scratch against the
`fflow__` prefix, and no upstream stylesheet or visual component is imported
(`docs/PLAN.md` §2.4). Every piece of it is off by default and opt-in through
`createRenderer`:

```ts
const renderer = Flow.createRenderer({
  paneId: "main-flow",
  renderNode,
  background: { variant: "dots" }, // or { variant: "lines", gap: 30 }
  controls: true, // zoom in, zoom out, fit
  minimap: true, // every node + the viewport rectangle
  accessibleName: (node) => node.data.label, // a11y; see below
});
```

| Piece        | What it is                                                                                                                                                 | Cost it opts into                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `background` | dots or lines, one CSS `background-image` whose position and size follow the viewport transform                                                            | two style properties per viewport frame, no elements                     |
| `controls`   | zoom in / zoom out / fit buttons, dispatching `ClickedZoomIn`, `ClickedZoomOut`, `ClickedFitView`                                                          | three buttons; all three messages route to `zoomBy`/`setViewport`        |
| `minimap`    | every node as a `<rect>` in a `viewBox` of the graph's bounds, plus the pane's rectangle in flow space                                                     | one memoized `<g>` of `nodes.length` rects, rebuilt only when nodes move |
| `panel(...)` | a positioned container for your own chrome, threaded through `ViewInput.panel` so its markup stays in your boundary and its buttons dispatch your messages | nothing beyond your markup                                               |

The pattern is transform-aware without being inside the transform: the background
element is a sibling of `.fflow__viewport`, so the content's `scale()` cannot
double-apply the zoom. Its `background-position` is the viewport's `x`/`y` and its
`background-size` is `gap × zoom`, which is what makes it pan and zoom with the
graph while the dots stay one pixel.

Everything above the viewport is a press target inside the pane, so chrome carries
`fflow__nopan` (the pane's d3 filter skips it, and `closest` covers its children)
and `data-fflow-chrome` (the pane's own handler declines it, so a control press
never clears the selection). A consumer panel built by hand needs both; `panel(...)`
adds them for you.

**`Flow.fitViewport(model, nodes, padding?)`** is the pure helper behind the fit
button: `getViewportForBounds` over `nodeBounds`, clamped by the Model's zoom
bounds, returning the current viewport unchanged for an empty graph or an
unmeasured pane. Call it from your own `update` and fold `setViewport` if you
would rather animate the fit yourself. The usual place for the first fit is
`ResizedPane`, and that works because the pane's `MountedPane` always arrives
**first**: `Flow.setViewport` needs the pane id that Message folds, and a viewport
committed without it would be one the engine never received — the next pan would
then apply its delta to the engine's older transform (`docs/M5-FINDINGS.md` §8.2).

**Zoom bounds have one source of truth.** `Model.minZoom`/`maxZoom` are seeded by
`init(viewport, { minZoom, maxZoom })`, passed to the pan/zoom engine as its
`scaleExtent`, and enforced once in `setViewport`. At a bound a control press
changes nothing and dispatches nothing — the Model never holds a zoom the engine
would refuse. (`RendererConfig.minZoom`/`maxZoom` used to be declared and were
never read; they are gone.)

`Flow.viewportRect(model)` is the pane's box in flow space with no overscan.
`Flow.visibleRegion` is that box plus one screen on each side — culling's buffer,
which is exactly what a minimap must **not** draw as the viewport rectangle.

## Graph features

The M4 surface. Everything here is opt-in per renderer, and the `M4-FINDINGS.md`
sections named beside each item hold the reasoning and the proofs.

### Sub-flows: a child's position is relative to its parent

```ts
const nodes: FlowNode<Data>[] = [
  {
    id: "group",
    position: { x: 100, y: 100 },
    data,
    size: { width: 420, height: 300 },
  },
  { id: "child", position: { x: 20, y: 60 }, parentId: "group", data },
];
```

One rule, one place: `Flow.positionIndex(nodes)` resolves the parent chain to
absolute flow positions, and every position-derived helper reads it —
`nodeRect`, `nodeBounds`, `visibleNodes`, `visibleEdges`, the edge anchors,
hit-testing, the drag overlay, the minimap, the description and `fitViewport`.
Three properties worth knowing:

- Dragging a parent moves its subtree: the child's absolute position is built from
  the parent's, so it follows the overlay and the committed move with no
  per-descendant OutMessage. `MovedNodes` reports the parent only, in the space the
  flow received it (absolute, or parent-relative for a child).
- A `parentId` that names no node resolves as absolute, and a cycle stops at the
  node the walk re-enters — a mid-edit graph draws children, it does not lose them.
- Selecting a parent and a child and dragging moves them once: a node whose
  ancestor is also dragged is dropped from the gesture's node list.

### `hidden` means collapsed

`hidden: true` on a node removes that node, **its whole subtree**, their edges,
their measurement and their selection — at any zoom, with `cull` on or off. It is
the escape hatch for very large graphs: 10,000 nodes with 98% of them collapsed
pan at the frame rate with 200 nodes in the DOM, and the same 10k graph _expanded_
also pans at the frame rate but takes ~1.2 s to settle, because its first render
happens before the pane is measured (`docs/BENCHMARKS.md` §"10k"). A collapsed node
is not fitted by `fitViewport`, not drawn in the minimap and not listed in the
description.

Collapsing from your own `update` is a graph change the flow never sees, so fold
`Flow.informGraphChanged(model, context)` in the same handler — that is what prunes
the measurement.

### Resizing

```ts
const renderer = Flow.createRenderer({ paneId, renderNode, resize: true });
```

Off by default. On, each node gets four corner controls (the edge midpoints belong
to your port handles), and the flow draws `node.size` as the node's box — so a
persisted resize survives the next render. A release emits
`OutMessage.ResizedNodes({ nodes: [{ nodeId, x, y, width, height }] })`; persist it
wherever you keep the node, and the positions come back in the space you gave
them. The gesture is a Flow gesture: pure geometry in `Flow.resizeRect`, one
`ResizedNodes` fact, and the box written as a measurement so geometry agrees with
the DOM without waiting a frame. `XYResizer` is deliberately not used
(`docs/M4-FINDINGS.md` §2.6).

The box is the flow's; filling it is yours. A node the flow draws a box for carries
`data-boxed`, and `tools.size` reports that box to `renderNode` (live, while a
resize runs), so one line of your own CSS makes the resize visible:

```css
.fflow__node[data-boxed] > .my-node-content {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
}
```

It is deliberately not a library default: a container node wants a frame with its
children inside, a leaf wants a filled box, and only you know which you have
(`docs/M4-FINDINGS.md` §14).

**Hold Shift (or ⌘/Ctrl) while dragging a corner and the box keeps its start aspect
ratio.** The axis you moved further, proportionally, decides and the other follows; the
modifier is read per pointer event, so pressing or releasing it mid-gesture changes the
next frame. It is a modifier rather than a renderer option because `resize` is one flag
for the whole pane, and a per-node "always proportional" is a config surface nobody has
asked for (`docs/M6-RESEARCH.md` §7).

**A parent's children are not re-placed when the parent is resized.** Their positions are
relative to it, so resizing from the top-left carries them; keeping them still is a
container-layout decision that needs a fact the flow does not report. If you want the
upstream behaviour, fold `ResizedNodes` and subtract the parent's top-left delta from each
child's `position` — that is the whole rule, and it is yours to apply because only you
can persist it (`docs/M6-RESEARCH.md` §6).

### Snap grid

```ts
const renderer = Flow.createRenderer({
  paneId,
  renderNode,
  snapGrid: { x: 20, y: 20 },
});
```

Optional, and it applies to exactly one thing: a drag, snapped once per pointer
event so the overlay and the released position are the same number. The grabbed
node lands on a multiple; every other dragged node keeps its offset from it. A
resize snaps its moving edge with the same rule. Arrow-key nudging is not snapped.

### `fitView` options

```ts
// your own update
Flow.setViewport(
  model,
  Flow.fitViewport(model, nodes, {
    padding: 0.2,
    maxZoom: 1, // can only tighten the Model's bounds
    nodes: (node) => selected.includes(node.id), // "fit the selection"
  }),
);

// the library's fit button
const renderer = Flow.createRenderer({
  paneId,
  renderNode,
  controls: true,
  fitView: { padding: 0.2, maxZoom: 1.25, duration: 200 },
});
```

The Model's `minZoom`/`maxZoom` remain the only clamp: an option can tighten it,
never loosen it. A filtered fit resolves positions against the whole graph and
measures only the nodes the filter keeps.

### Edge markers and labels

```ts
{ id: "e1", source: "a", target: "b", label: "yes", markerEnd: "ArrowClosed" }
```

`edge.label` renders without any configuration, as a `<text>` at the path's label
point with a halo (a background-coloured stroke under the glyphs, so no box needs
measuring). `renderEdgeLabel(edge, h)` replaces the label's _content_ at the same
point. Markers are our own glyphs (`Arrow`, `ArrowClosed`) in a `<defs>` block that
exists only when an edge asks for one, sized in user units so they scale with the
viewport. Per-edge styling is `[data-edgeid]` in your own stylesheet.

### Minimap: click to centre, drag to pan

With `minimap: true`, a press inside it centres the view on the flow point under the
cursor, and holding the button down and dragging pans from there
(`StartedMiniMapPan` → `Gesture.MiniMapPanning` → one `setViewport` per pointer move,
through the same clamp and `SyncViewport` Command as every other programmatic move).

The mapping is read **once**, at press: the minimap's own `getScreenCTM()` gives the
flow point under the cursor and the scale, so no frame of the drag touches the DOM and
the pan is absolute from where you pressed rather than accumulated step by step.

Two minimap interactions are **not** shipped, and each for a reason
(`docs/M6-RESEARCH.md` §4): a wheel-zoom (`zoomable` is off by default upstream too, and
the zoom buttons already exist) and a per-node press target (a press already centres on
the node under the cursor). The minimap stays `aria-hidden` — it is a picture of what
the description region says in words, and a picture that is also an unlabelled control
is worse than one that is not a control.

### Selecting an edge

```ts
const renderer = Flow.createRenderer({
  paneId,
  renderNode,
  edgeSelection: true,
});
```

Off by default. On, each edge draws an invisible press path 20 **flow units** wide
(upstream's `interactionWidth` default, in flow space because the width must not depend
on the zoom), and the edge group becomes a control:

| Input                             | Message                                 | Result                                                          |
| --------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| a press on the edge               | `PressedEdge({ edgeId, isAdditive })`   | selects it; clears the node selection unless a modifier is held |
| `Tab` to it, then `Enter`/`Space` | `ActivatedEdge({ edgeId, isAdditive })` | the same                                                        |

Selection is reported as `SelectedElements({ nodeIds, edgeIds })` — the fact that
already existed — so `Delete` removes the selected edges through the path it always
had. The group carries `role="button"`, `aria-pressed` and an `aria-label` of
`Edge from <source> to <target>` (`: <label>` when the edge has one), built from the
same `accessibleName` hook the nodes use. The edges layer **loses `aria-hidden`** when
the feature is on, because a focusable descendant of a hidden subtree is an ARIA
violation; with it off, the layer stays hidden.

Tab order is the DOM's, and that has one consequence worth knowing: the edges layer
renders before the nodes layer, so every edge is tabbed before every node. A graph with
1,000 edges and `edgeSelection` on has 1,000 tab stops before the first node, which is
why the feature is opt-in.

## Accessibility

What the flow provides:

- **Focusable nodes.** Each node wrapper is `tabindex="0"`, `role="button"`,
  `aria-pressed` (the selection is a toggle), and named by the `accessibleName`
  hook — falling back to the node id, because the flow cannot read `node.data`.
  Tab order is the DOM's: nodes are tabbed in render order, with whatever
  focusable content you put inside them, and Tab is not trapped.
- **Focusable edges,** when `edgeSelection` is on: `tabindex="0"`, `role="button"`,
  `aria-pressed`, named `Edge from <source> to <target>`, selected by `Enter` or
  `Space`. An arrow key on an edge does nothing — an edge has no position of its own
  to nudge.
- **Arrow-key nudging.** With a node focused, arrow keys move it by
  `Flow.nudgeStep` (1) or `Flow.nudgeLargeStep` (10) with Shift, one `MovedNodes`
  OutMessage per press. The keys are ignored while the event target is an input,
  a textarea, a select, `contenteditable`, or inside `.fflow__nokey`, and the
  page does not scroll (`preventDefault`).
- **Keyboard activation.** `Enter` or `Space` on a focused node selects it, with
  the same toggle rules as a press (`Shift` adds), which is what `role="button"`
  with `aria-pressed` promises. Space is prevented on a node (it would scroll) and
  left alone everywhere else, so `Enter` on a focused control button still clicks
  it.
- **A description region.** A visually hidden `role="region"` listing the summary,
  each node, and its incoming and outgoing connections — 50 nodes and 6
  connections per node, with a count of what is omitted. It is **not** a live
  region: it describes the graph and is memoized on `nodes`/`edges`, so a pan or a
  drag produces no DOM work in it. It sits beside the viewport, outside the
  transform.
- **The minimap is `aria-hidden`** — it is a picture of what the description says
  in words.

**Selectors.** The flow's per-node instrumentation is `data-nodeid`, and it is on
the handles and the four resize controls too — a node is
`.fflow__node[data-nodeid="…"]`, and a loose `[data-nodeid]` query returns seven
elements per node. Edges are `[data-edgeid]`; the viewport is
`[data-fflow-viewport]`.

What you have to supply: `accessibleName`, and the same `flow.css`. A node without
it is announced by its id. If a node contains controls, mark the ones that must not
trigger the flow's keyboard with `fflow__nokey` (delete, escape, and nudging all
read that class) and the ones that must not zoom with `fflow__nowheel`.
