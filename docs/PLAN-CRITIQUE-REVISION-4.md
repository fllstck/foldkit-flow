# Fourth-Pass Critique of the Foldkit Flow Plan

## Summary

The latest revision successfully applies the third-pass fixes:

- partial handle measurement now merges per node;
- renderer cache ownership is explicit;
- parent graph reconciliation is shown in the wiring example;
- stylesheet-only geometry changes have an explicit remeasure path.

I also compared the plan with current React Flow and Svelte Flow source and with
Foldkit's current guidance on view purity, Mount lifecycle, keying, and informing
submodels. The overall architecture remains sound and is coherent enough to
begin M0.

Four smaller issues remain before M1/M2 should be considered fully specified.

## Online validation

The architectural choices are consistent with the following upstream behavior
and Foldkit guidance:

- [XYFlow `getHandleBounds`](https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/dom.ts)
  normalizes handle offsets by zoom while using `offsetWidth` and `offsetHeight`
  for dimensions.
- [React Flow `Viewport`](https://github.com/xyflow/xyflow/blob/main/packages/react/src/container/Viewport/index.tsx)
  seeds the initial transform and writes pan/zoom transforms directly to the DOM
  outside the regular render hot path.
- [React Flow `NodeRenderer`](https://github.com/xyflow/xyflow/blob/main/packages/react/src/container/NodeRenderer/index.tsx)
  separates visible-node selection from per-node rendering to reduce repeated
  work.
- [React Flow `ZoomPane`](https://github.com/xyflow/xyflow/blob/main/packages/react/src/container/ZoomPane/index.tsx)
  initializes `XYPanZoom` with the initial viewport and updates its behavior
  separately from the mount lifecycle.
- [Svelte Flow's root composition](https://github.com/xyflow/xyflow/blob/main/packages/svelte/src/lib/container/SvelteFlow/SvelteFlow.svelte)
  confirms the same broad separation between pane, viewport, node renderer,
  edge renderer, and keyboard/selection behavior.
- [Foldkit Mount lifecycle](https://foldkit.dev/core/mount) requires
  element-local, repeat-safe work with paired cleanup and confirms that a reused
  DOM node keeps its Mount running.
- [Foldkit View purity](https://foldkit.dev/core/view) requires view functions to
  describe HTML without mutating state or running effects.
- [Foldkit Informing Submodels](https://foldkit.dev/patterns/informing-submodels)
  supports the proposed parent-to-flow reconciliation helper.

## Findings

### 1. High — `data-handles` signature generation may violate view purity

The plan proposes that the renderer emits a `data-handles` signature and says:

> “The view knows the declaration because it builds `tools.handle(...)`.”

See [§2.5.3](./PLAN.md#25-state-and-context-contract).

But `renderNode` is a consumer callback. The renderer does not know the handle
declarations before invoking it. If `tools.handle()` records declarations into a
mutable collection while rendering, that introduces observable mutation into
view construction and conflicts with Foldkit's requirement that view remain a
pure Model-to-HTML description.

**Suggested correction:** define a pure source for the signature:

- make handle declarations an explicit node input separate from `renderNode`;
- require a pure `handles(node)` callback and derive the signature from it;
- derive the signature from the generated VNode tree, if Foldkit exposes a
  supported pure traversal; or
- remove the signature and rely on the `MutationObserver`'s `childList`, `class`,
  `style`, and handle-attribute observation.

The last option may be sufficient because the observer already watches the
actual handle DOM structure.

### 2. Medium — renderer cache cleanup is still incomplete

The plan says the renderer is created once at module or app scope; see
[the Renderer API](./PLAN.md#33-the-view-helper) and
[the cache ownership section](./PLAN.md#45-the-hot-path-and-the-performance-gate).

This solves recreation on every render, but creates a lifecycle problem: a
module-scope renderer can outlive the Flow instance and retain cached
`createLazy()` slots and VNodes after the pane is permanently unmounted.

The cache is swept only after a later render. If the flow is removed and never
rendered again, the renderer retains the largest graph it has seen.

**Suggested correction:** provide explicit disposal:

```ts
const renderer = Flow.createRenderer(config)

// Called from the pane Mount release or Flow-owned cleanup.
renderer.dispose()
```

Alternatively, make the renderer instance owned by a parent
component/controller with an explicit lifecycle instead of recommending module
scope as the normal pattern.

Clarify whether cached VNodes can retain parent dispatchers or renderer
closures after disposal.

### 3. Medium — the pane host registry does not show the root required by subscriptions

The subscriptions call:

```ts
getPaneRoot(paneId)
```

See [§4.4](./PLAN.md#44-subscriptions-gestures-that-span-elements).

But the host registry example only defines `panZoomByPaneId` and
`lastViewportByPaneId`; see [§4.3](./PLAN.md#43-host-registry-live-handles-out-of-the-frozen-model).

There is no shown `setPaneRoot`, `getPaneRoot`, or cleanup path. Since the design
supports ShadowRoot hosting, iframes, multiple flows, and replay/unmount, the
registry should own the live root or a host record containing both the pan/zoom
instance and root.

**Suggested correction:**

```ts
type PaneHost = {
  element: HTMLElement
  root: Document | ShadowRoot
  panZoom: PanZoomInstance
}
```

Define:

- registration during pane Mount;
- lookup for Commands and Subscriptions;
- identity-safe cleanup during release;
- replacement behavior when a pane ID is reused.

### 4. Low — one stale statement contradicts the corrected invalidation design

The plan says in [§4.2](./PLAN.md#42-mount-per-node-measurement-and-handle-bounds):

> “a new node object (which re-renders the memoized subtree, so handles that
> appear or disappear are re-measured)”

Earlier, [§2.5.3](./PLAN.md#25-state-and-context-contract) correctly explains
that re-rendering does not rerun a Mount and introduces the MutationObserver and
`data-handles` trigger.

Change the §4.2 wording to say that a new node object updates the DOM, after
which the observer detects the relevant structural or attribute change. It
should not imply that the Mount itself reruns.

## Additional API documentation note

The plan now correctly documents `Flow.remeasure` for stylesheet-only geometry
changes. That is a reasonable consumer responsibility.

The public API documentation should explicitly distinguish:

- `ResizeObserver` and `MutationObserver` maintaining ordinary live geometry;
- `Flow.remeasure` being required when external CSS changes layout without
  producing either observable event;
- edge endpoint correctness after such a change not being guaranteed until
  remeasurement.

This behavior should not exist only in implementation notes.

## Recommended actions

Before M0, decide whether `data-handles` is retained or removed.

Before M1/M2:

1. make handle-signature generation pure, or eliminate the signature;
2. define renderer disposal and cached-VNode cleanup;
3. complete the pane host/root registry;
4. correct the stale Mount invalidation wording;
5. document the `Flow.remeasure` responsibility in the public API.

## Verdict

The plan is coherent enough to begin M0. The comparison with current React Flow,
Svelte Flow, and Foldkit guidance supports the overall architectural direction.
The remaining issues are specific purity and lifecycle details, not fundamental
design flaws.
