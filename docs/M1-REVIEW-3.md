# M1 final review

## Verdict

M1 is functionally ready. The latest interaction fix is correct, and the
validation evidence now covers the failure mode that prompted it: dragging a
node does not pan the pane, while dragging an empty pane still pans the
viewport.

No new implementation defect was found in this pass.

## Verified fixes

- Node wrappers carry the shared `classes.NoPan` class, matching the
  `XYPanZoom` `noPanClassName` contract.
- The pane mount uses the shared `NoPan` and `NoWheel` class names rather than
  duplicating those literals.
- The node-drag path changes the node overlay transform without changing the
  viewport transform.
- Empty-pane dragging still changes the viewport.
- The benchmark selects a visible node for dragging and uses explicit,
  fixture-safe pan points.
- Benchmark gestures assert actual movement instead of accepting idle frames.
- React Flow drag is reported as unverified under this harness rather than
  being represented by misleading idle-frame timings.
- Foldkit benchmark pages lift `Flow.subscriptions`, so pointer moves reach the
  interaction state machine.

## Fresh validation

All commands were run after the latest drag/pan and benchmark changes:

| Check                           | Result                                                   |
| ------------------------------- | -------------------------------------------------------- |
| `pnpm check`                    | Passed: typecheck, lint, formatting, and 89 Vitest tests |
| Interaction and viewport proofs | Passed: 13/13                                            |
| 625-node benchmark              | Passed                                                   |
| 1,000-node culled benchmark     | Passed                                                   |

The 625-node run verified nonzero drag movement for Svelte Flow and Foldkit,
nonzero pan movement for React Flow, Svelte Flow, and Foldkit, and reported
React Flow drag as unverified. The run recorded 21 culling samples. The
1,000-node gate also verified both drag and pan movement and stayed below the
33 ms p95 threshold.

The first attempt to run the browser proofs overlapped with the benchmark
server and failed because port 4173 was occupied; it was an infrastructure
collision, not a test failure. A clean rerun passed all 13 proofs.

## Remaining finding: stale historical counts in `M1-FINDINGS.md`

`M1-FINDINGS.md` still opens with the earlier M1 verification counts
(75 Vitest tests and 8 interaction tests), then describes the later proof 16
addition. Its later sections also mix historical benchmark figures with the
freshly corrected methodology. The document explains the evolution, so this
does not invalidate the evidence, but the opening verification table can be
misread as the final state.

Recommended documentation-only cleanup:

- change the final verification table to 89 Vitest tests;
- report 13 combined browser proofs in the current run (9 M1 interaction
  proofs and 4 M0 proofs);
- label earlier test counts and benchmark values explicitly as historical;
- optionally add the fresh benchmark output alongside the prior figures rather
  than leaving the reader to infer which run is authoritative.

This is low severity and does not block M1.

## Scope boundary

The review does not treat the unverified React Flow drag leg as a Foldkit
failure. The harness delivers the press but does not observe React Flow moving
the node, while the Svelte Flow and Foldkit drag legs are verified. The M1
comparison therefore supports verified pan parity across all three libraries
and verified drag measurements for Svelte Flow and Foldkit, not an unsupported
React Flow drag comparison.
