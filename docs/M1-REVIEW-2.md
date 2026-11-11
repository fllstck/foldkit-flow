# M1 Follow-up Review

## Summary

The three findings from the previous M1 review are fixed correctly:

- handle identity now includes `nodeId`, `type`, and `handleId`;
- dragged nodes and their connected edges remain rendered while culling is
  enabled;
- additive selection is wired through modifier-key subscriptions and covered
  by a browser test.

The new coverage is appropriate:

- [handles.ts](../packages/flow/src/geometry/handles.ts)
- [connection.test.ts](../packages/flow/src/view/connection.test.ts)
- [culling.test.ts](../packages/flow/src/view/culling.test.ts)
- [interaction.spec.ts](../packages/benchmark/tests/interaction.spec.ts)

Validation passed:

- `pnpm check`
  - typechecking passed;
  - Oxlint passed;
  - Prettier passed;
  - 88 unit tests passed;
- M1 browser regressions — 12 passed, including proofs 14 and 15.

## Remaining documentation issue

### Low — M1 findings coverage table is stale

[M1-FINDINGS.md](./M1-FINDINGS.md) still says that pointer-layer coverage is in
proofs “8–13,” but the suite now includes:

- proof 14: additive modifier selection;
- proof 15: culling while dragging.

The surrounding text also says “14 tests complete,” while the current combined
browser run contains 15 M1 interaction/proof cases. Update those references so
the findings document accurately describes the test suite.

## Verdict

The previous M1 implementation findings are resolved. No new functional
blockers were found. M1 is ready to proceed; only the findings-document
coverage counts need updating.
