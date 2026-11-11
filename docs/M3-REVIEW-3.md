# M3 review, third pass

## Verdict

No new correctness findings.

The post-review fixes address the issues raised by the latest implementation
changes:

- connected edge anchors follow the dragged node overlay during the gesture;
- the transformed viewport has an explicit size, so the edge SVG receives a
  non-zero drawing box and committed edges paint;
- connection hit testing uses a 20 CSS-pixel radius, converted to flow units
  at the current zoom, while still filtering to the opposite handle type;
- connection previews apply the viewport transform and therefore end at the
  actual pointer location on screen;
- the pane prevents page-text selection during graph gestures while restoring
  text selection for inputs, textareas, and editable content;
- the example exposes the supported connectability behavior and its
  source/target limitation;
- the example no longer renders renderer-cache state, preserving SSR-stable
  output.

The edge-following implementation is appropriately limited to the dragged
node's endpoints. It leaves memoized measured endpoints unchanged and applies
the transient drag delta at render time, matching the existing overlay model.
The viewport sizing change is scoped to the flow viewport and does not alter
the edge geometry or interaction layers. The connection tolerance is applied
consistently to both new connections and reconnect hit testing through the
shared update path.

## Validation

Validation was run from the latest committed implementation:

| Check                  | Result                               |
| ---------------------- | ------------------------------------ |
| `pnpm build`           | Passed                               |
| `pnpm check`           | Passed; 194 Vitest tests in 20 files |
| Focused browser proofs | Passed; 35/35                        |
| M3 chrome proofs       | Passed; proofs 22–37, 17/17          |
| M2 connection proofs   | Passed; proofs 17–21, 5/5            |
| M1 interaction proofs  | Passed; proofs 8–16, 9/9             |
| M0 proofs              | Passed; proofs 2, 3, 3b, 4, 4/4      |
| Performance gates      | Passed; 3/3                          |

The performance run measured p95 frame times of 16.7–16.8 ms and zero long
frames for the 625-node comparison, the 1,000-node culled gate, and the
1,000-node culled gate with M3 chrome enabled. The 625-node comparison still
reports React Flow dragging as unverified because the harness does not engage
its node drag; it does not report that path as a successful performance result.

The first browser invocation had one infrastructure-only failure while
navigating to the preview server (`ERR_HTTP_RESPONSE_CODE_FAILURE` on port
4174). No test body ran for that case. A complete rerun passed all 35 tests.

## Remaining notes

No implementation changes are required from this review. The historical
issue text in [M2-REVIEW.md](./M2-REVIEW.md) and earlier M3 review files should
be read as review history, not as the current status; the target-originated
connection issue and the earlier M3 accessibility issues are covered by later
fixes and tests.
