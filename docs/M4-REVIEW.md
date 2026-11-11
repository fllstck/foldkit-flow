# M4 review

## Verdict

M4 is broadly implemented and the reported validation results are
reproducible, but five edge-case findings remain. The first three contradict
the documented `hidden` subtree contract and should be fixed before M4 is
considered fully complete.

## Findings

### 1. HIGH — `fitViewport` can include descendants of hidden nodes

**Location:** [packages/flow/src/geometry/fit.ts](../packages/flow/src/geometry/fit.ts)

`fitViewport` excludes nodes whose own `hidden` field is `true`, but it does
not exclude descendants of hidden nodes. A child below a collapsed parent can
therefore still contribute to the fit bounds even though the renderer,
culling, minimap, and description treat the whole subtree as hidden.

This violates the documented M4 rule that a collapsed subtree is not fitted.
The fit filter should use the same `hiddenIds(nodes)` result used by rendering
and culling.

### 2. MEDIUM — `selectAll` selects hidden nodes

**Location:** [packages/flow/src/update.ts](../packages/flow/src/update.ts)

`selectAll` maps every node in `context.nodes` into the selection, including
nodes hidden directly or through a hidden ancestor.

This conflicts with the documented contract that hidden nodes are removed from
selection and with `informGraphChanged`, which prunes hidden-node selections.
`selectAll` should select only shown nodes, using the shared hidden-subtree
calculation.

### 3. MEDIUM — The accessibility description includes hidden-subtree edges

**Location:** [packages/flow/src/view/view.ts](../packages/flow/src/view/view.ts)

The description receives `shownNodes(input.nodes)` but the unfiltered
`input.edges`. Consequently, its connection count and node sentences can
mention edges whose source or target is inside a collapsed subtree.

That makes the accessibility description disagree with the visible graph. The
description should receive only edges whose endpoints are both shown, using
the same filtering rule as `visibleEdges` without viewport culling.

### 4. MEDIUM — Parent-chain behavior is effectively limited to 12 levels

**Location:** [packages/flow/src/geometry/positions.ts](../packages/flow/src/geometry/positions.ts)

`maxParentDepth` is set to 12 and is used by `positionIndex`, `ancestorIds`, and
`withDescendants`. Parent-chain resolution is therefore order-dependent for
deep graphs: a chain longer than 12 levels can be truncated when an ancestor
has not already been resolved and the node array is not ordered from ancestors
to descendants.

The findings describe long chains as supported and describe the depth bound as
protection against pathological cycles, but the same bound also limits valid
deep nesting, hidden-subtree propagation, and parent dragging. The behavior
should either be made independent of a small fixed depth or the 12-level
nesting limit should be explicitly documented and tested.

### 5. LOW — Sanitized marker IDs can collide

**Location:** [packages/flow/src/view/markers.ts](../packages/flow/src/view/markers.ts)

Marker IDs are derived by replacing unsupported characters in `paneId` with
`-`. Different pane IDs can therefore produce the same marker ID; for example,
`a/b` and `a-b` both become `fflow-marker-a-b-...`.

If multiple flows with such pane IDs are mounted in one document, marker
references can resolve to the wrong flow's marker definition. Marker IDs need a
collision-resistant encoding or a guaranteed unique host identifier.

## Validation

The following checks passed against the current M4 implementation:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| `pnpm check` | Passed; 259 Vitest tests |
| M4 browser proofs | Passed; 9/9 |
| 10k hidden-subtree exploration | Passed on rerun |

The first combined M4 browser run reported one
`ERR_HTTP_RESPONSE_CODE_FAILURE` while navigating to
`/large-hidden.html`. No test body ran for that failure. Running
`tests/hidden.spec.ts` separately afterward passed and produced the expected
10,000-node result with 9,800 hidden nodes and 200 rendered nodes.

## Recommended priority

1. Fix hidden-subtree filtering in `fitViewport`, `selectAll`, and the
   accessibility description.
2. Resolve or document the parent-chain depth limit.
3. Harden marker ID generation for multi-flow documents.

No implementation changes were made as part of this review.
