# M3 second-pass review

## Verdict

The two findings from the first M3 review are fixed correctly. No remaining
functional issues were found in this second pass.

## Verified fixes

### Description memo stability

`accessibleNameOf` is now created once per renderer rather than once per
`view()` call. The description memo therefore retains its inputs across
viewport-only renders and is rebuilt when graph inputs actually change.

The implementation includes unit coverage that counts accessible-name calls
across:

- a viewport-only render;
- a selection-only change;
- a node-size change;
- a graph change.

### Keyboard activation

Focusable nodes now support keyboard activation through the new
`ActivatedNode` message:

- Enter selects or toggles the focused node;
- Space selects or toggles the focused node;
- Shift, Meta, and Control preserve additive-selection behavior;
- activation does not arm a drag gesture;
- missing and non-selectable nodes are safely ignored;
- editable inputs and `.fflow__nokey` regions remain protected.

Browser proof 31 covers both Enter and Space activation.

## Validation

The following checks passed after the fixes:

| Check                     | Result                                                  |
| ------------------------- | ------------------------------------------------------- |
| `pnpm build`              | Passed                                                  |
| `pnpm check`              | Passed: typecheck, lint, formatting, and 184 unit tests |
| Complete Playwright suite | Passed: 32/32                                           |

The browser suite included all M0–M3 proofs, connection and reconnect proofs,
the 625-node comparison, the 1,000-node culled performance gate, and the
1,000-node culled gate with M3 chrome enabled.

The performance gates remained below the 33 ms p95 threshold with verified
drag and pan movement. React Flow drag remains explicitly unverified under the
existing harness, as documented by the benchmark.

The standalone chrome-only run encountered the known preview-server/port
collision before the first test could start. The complete suite subsequently
ran successfully and passed all 32 tests, including all 11 chrome proofs.

## Conclusion

M3 is ready from the reviewed scope. The description memo now provides the
intended viewport-frame optimization, and the focusable node's
`role="button"` contract now has matching Enter and Space keyboard behavior.
