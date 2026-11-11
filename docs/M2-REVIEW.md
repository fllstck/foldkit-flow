# M2 review

## Verdict

M2 is largely well implemented and the findings document accurately describes
the current architecture, deviations, and validation evidence. However, one
connection-orientation bug remains and should be fixed before M2 is considered
complete.

## Finding

### HIGH — target-originated connections emit reversed endpoints

Both source and target handles dispatch `StartedConnection` from
`packages/flow/src/view/view.ts`. The handle type is forwarded unchanged.

During pointer movement, `packages/flow/src/update.ts` correctly searches for
the opposite handle type. However, on release it always emits the initiating
handle as `source` and the hovered handle as `target`:

```ts
OutMessage.ConnectedHandles({
  source: gesture.from,
  target,
});
```

Consequently, dragging from a `Target` handle to a `Source` handle produces a
fact shaped like:

```text
ConnectedHandles({
  source: { type: "Target", ... },
  target: { type: "Source", ... }
})
```

The same reversed orientation is passed to `isValidConnection`, so a parent
predicate receives a semantically invalid `Connection` for this gesture.

I confirmed this behavior directly against the built package. The current
browser proof covers only source-to-target connection creation and therefore
does not detect it.

### Recommended resolution

Choose and document one of these policies:

1. Normalize the pair at release so the `Source` handle is always emitted as
   `source` and the `Target` handle is always emitted as `target`; or
2. Explicitly support only source-originated connections, prevent target
   handles from dispatching `StartedConnection`, and add a regression test for
   the rejected interaction.

Normalization is the more flexible option and is consistent with the public
`Connection` shape and the existing opposite-handle hit testing.

## Areas verified

- Measured handle geometry supplies edge endpoints and preserves handle
  orientation.
- Unmeasured or missing handles fall back to node-border anchors.
- Connection previews use the shared edge-path geometry.
- `isValidConnection` is evaluated at release and can reject connections
  without requiring parent rollback.
- Reconnect gestures preserve the stationary edge end and emit
  `ReconnectedEdge` only for accepted releases.
- Reconnect affordances are opt-in and excluded from pane panning.
- `Flow.Remeasure` is publicly documented for stylesheet-only geometry changes.
- Handle indexing and endpoint memoization address the M2 performance
  regression.
- `HoveredHandle` was removed consistently because Foldkit does not provide
  the required pointer-enter attribute.

## Validation

The following checks passed after the M2 implementation:

| Check                     | Result                                                  |
| ------------------------- | ------------------------------------------------------- |
| `pnpm build`              | Passed                                                  |
| `pnpm check`              | Passed: typecheck, lint, formatting, and 120 unit tests |
| Focused M2 unit tests     | Passed                                                  |
| Complete Playwright suite | Passed: 19/19                                           |

The browser suite included:

- connection creation and measured endpoint proof;
- rejected self-loop and duplicate connection proof;
- reconnect proof;
- stylesheet-only handle movement and explicit remeasure proof;
- all M0 and M1 interaction proofs;
- the 625-node comparison benchmark;
- the 1,000-node culled performance gate.

The performance gates passed with verified gesture movement. The React Flow
drag leg remains explicitly unverified by the harness, while pan movement is
verified for all three libraries and drag movement is verified for Svelte Flow
and Foldkit.

## Conclusion

M2 has strong coverage and the implementation passes its current build,
unit-test, browser-proof, and benchmark gates. The target-originated
connection orientation issue is the only functional defect found in this
review and should be addressed with a focused code change plus a regression
test before the milestone is closed.
