# M4 review, second pass

## Verdict

The five findings from [M4-REVIEW.md](./M4-REVIEW.md) have been addressed:

- `fitViewport` now excludes descendants of hidden nodes;
- `selectAll` excludes hidden nodes and edges;
- the accessibility description filters edges consistently with the visible
  graph;
- parent-chain resolution is no longer limited to 12 levels and is
  order-independent;
- marker IDs use an injective pane-id encoding and no longer collide through
  sanitization.

The new tests cover these fixes. The Flow suite now passes 268 tests.

## New finding

### MEDIUM — Parent-position indexing is unnecessarily quadratic for flat graphs

**Location:** [packages/flow/src/geometry/positions.ts](../packages/flow/src/geometry/positions.ts)

The new resolver bounds each walk with a reducer that runs `nodes.length`
iterations. For a root node with no parent, the walk is already complete after
the first step, but the reducer still performs the remaining no-op iterations.
This happens for every unresolved node in a flat graph.

As a direct production-build measurement, constructing a position index for
10,000 flat nodes took approximately 726 ms. This is graph-change or initial
render work rather than per-frame work, but it can still create a noticeable
pause for large graphs and contradicts the findings' claim that the index build
is effectively linear.

The walk should stop once it reaches a root or a resolved ancestor instead of
continuing through the full `nodes.length` range. A targeted flat-graph
benchmark or unit-level instrumentation should verify that the fix avoids
repeating no-op iterations.

## Documentation inconsistency

[M4-FINDINGS.md](./M4-FINDINGS.md) §2.1 still says that
`maxParentDepth (12)` bounds the parent chain. That statement is stale: the
implementation and the later corrective section say that the fixed depth limit
was removed. The historical text should be updated or explicitly marked as
superseded.

## Validation

The following checks passed against the fixed implementation:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed |
| `pnpm check` | Passed; 268 Vitest tests |
| M4 unit coverage | Passed, including hidden filtering, marker encoding, and 40-level order-independent parent resolution |
| 10k hidden-subtree proof before the latest rerun | Passed |

The latest browser reruns were blocked by occupied preview ports
(`4173`/`4174`). Those failures were infrastructure failures while starting or
connecting to the preview server, not product assertion failures. The M4 tests
that reached the existing preview server passed.

No implementation changes were made as part of this review.
