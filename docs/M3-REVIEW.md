# M3 review

## Verdict

M3 is broadly implemented correctly and all current build, unit-test, browser,
and performance gates pass. Two issues remain in the accessibility and
memoization details.

## Findings

### MEDIUM — description memo invalidates on every render

In `packages/flow/src/view/view.ts`, `accessibleNameOf` is declared inside the
`view()` function:

```ts
const accessibleNameOf = (node) =>
  config.accessibleName === undefined ? node.id : config.accessibleName(node);
```

The description memo includes that function reference in its inputs:

```ts
descriptionMemo.on([
  input.nodes,
  input.edges,
  accessibleNameOf,
  config.paneId,
], ...)
```

Because `view()` creates a new `accessibleNameOf` function on every render, every
viewport frame changes the memo input identity. The description VNode is
therefore rebuilt during pan and zoom, despite the M3 findings claiming that it
is memoized on graph changes only.

The generated text remains equivalent, and the browser proof sees no resulting
DOM mutations, so this is not currently a visible correctness failure. However,
it defeats the intended allocation and subtree-diff optimization.

Recommended fix: make the name resolver stable by defining it once in the
renderer closure, or use stable configuration references directly in the memo
inputs while retaining the same fallback behavior.

### MEDIUM — focusable nodes lack keyboard activation

Node wrappers expose `role="button"` and `tabindex="0"`, and pointer activation
selects the node. However, the keyboard subscription handles Delete, Escape,
and arrow-key nudging but not `Enter` or `Space`.

As a result, a keyboard user can focus a node and nudge it, but cannot activate
the node's advertised button behavior from the keyboard:

- pointer activation selects the node;
- arrow keys nudge it;
- Enter and Space do not select or toggle it.

Recommended resolution: add keyboard activation for Enter and Space, including
the intended additive-selection behavior, and add browser regression coverage.
Alternatively, choose a role whose keyboard contract matches the deliberately
supported interactions and document that limitation. Since the implementation
describes the node as a selection toggle, keyboard activation is the more
consistent resolution.

## Verified implementation areas

- Fit-view geometry handles empty graphs, unmeasured panes, and unmeasured
  nodes.
- Zoom limits are centralized in the Model and shared by controls,
  `setViewport`, fit-view, and `XYPanZoom`.
- Background patterns are transform-aware and rendered outside the transformed
  viewport.
- Controls do not pan or clear selection.
- The minimap uses a plain viewport rectangle rather than the culling
  overscan region and is memoized on graph geometry.
- Nodes are focusable, named, and expose selection through `aria-pressed`.
- Arrow-key nudging uses the pane host and respects editable and `.fflow__nokey`
  guards.
- The description region is visually hidden, bounded, and not a live region.
- Consumer panels are treated as chrome and do not trigger pane behavior.
- The M2 connection and target-origin orientation fixes remain intact.

## Validation

The following checks passed:

| Check                     | Result                                                  |
| ------------------------- | ------------------------------------------------------- |
| `pnpm build`              | Passed                                                  |
| `pnpm check`              | Passed: typecheck, lint, formatting, and 176 unit tests |
| M3 chrome proofs          | Passed: 10/10                                           |
| Complete Playwright suite | Passed: 31/31                                           |

The full browser suite included the M0–M3 proofs, the 625-node comparison,
the 1,000-node culled performance gate, and the 1,000-node culled gate with
all M3 chrome enabled. The performance gates stayed below the 33 ms p95
threshold with verified drag and pan movement. React Flow drag remains
explicitly unverified under the existing harness.

The first chrome-only run had one transient HTTP navigation failure before the
test body executed. The rerun passed all 10 chrome proofs, and the subsequent
complete suite passed all 31 tests.

## Conclusion

M3 has strong coverage and passes its current validation gates. The remaining
issues are a memoization identity bug that undermines the claimed description
optimization and an accessibility contract gap for keyboard activation of
nodes. Both should be resolved or explicitly scoped before treating the M3
accessibility layer as fully complete.
