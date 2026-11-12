# Test-strategy review

## Summary

The current suite broadly follows the ladder in
[`TEST-STRATEGY.md`](./TEST-STRATEGY.md). The core Flow library has a sound
separation:

| Area                                                                       |     Current rung | Assessment |
| -------------------------------------------------------------------------- | ---------------: | ---------- |
| Geometry, paths, positions, hidden-subtree logic, fit math and resize math |         1 — Pure | Correct    |
| `Flow.update`, gesture transitions, OutMessages and Commands               |        2 — Story | Correct    |
| View event propagation, chrome wiring and accessibility attributes         |        3 — Scene | Correct    |
| `MountPane` message ordering and initial measurement                       | 4 — Mount stream | Correct    |
| Layout, paint, real pointer/focus/resize behavior and SSR/hydration        |   5 — Playwright | Correct    |
| Frame timing, culling cost, heap/churn and cross-library comparison        |    5 — Benchmark | Correct    |

The browser suite should not be broadly moved downward. Most of its remaining
claims require real layout, paint, browser focus, `ResizeObserver`, pan/zoom
behavior, hydration, or frame timing.

## Tests that can move down the ladder

### 1. Example routing

The routing checks are pure and can be tested without Playwright:

- `routeFor()` route classification;
- trailing-slash handling;
- unknown-example fallback;
- `prerenderPathsFor()` output;
- consistency between registered slugs and generated paths.

Add a small unit test beside `packages/example/src/routes.ts`. Keep the browser
test for the separate claim that every generated route serves and hydrates the
correct page.

### 2. Example registry invariants

Pure tests can cheaply verify that:

- example names are unique;
- every entry has a nonempty title, description, category and source;
- every registry entry appears in `exampleSlugs`;
- every slug has a corresponding source filename;
- category grouping does not lose entries.

The browser proof should remain for mounting and hydration.

### 3. Connection-policy logic

The cycle predicate is pure graph logic and should have a Pure or Story test.
The browser test should retain only the real handle-drag and parent-visible
result.

The current policy also has a correctness risk: the callback in
`packages/example/src/examples/specs/connection-policy.ts` closes over the
module-level `edges` constant rather than the current parent graph. After
`c → d` is accepted, a later `d → c` can be accepted even though it creates a
cycle. The policy should receive current edges or be implemented in the harness
using `model.graph.edges`.

Once fixed, test:

- `c → a` rejection;
- `c → d` acceptance;
- subsequent `d → c` rejection;
- self-loop rejection.

### 4. Shared harness state transitions

The shared harness has meaningful state transitions that are currently exercised
primarily through Playwright:

- folding `MovedNodes` into parent-owned graph data;
- folding `ConnectedHandles`;
- folding `DeletedElements`;
- folding `ResizedNodes`;
- toggling `hidden` and calling `informGraphChanged`;
- fitting after the first `ResizedPane`;
- ensuring fit runs only once;
- applying a fit-button press.

Story tests can construct the application, dispatch Flow messages and assert
the resulting Model and Commands. Playwright should retain the real handle
drag, resize, collapse rendering and fit-transform claims.

## Tests that should remain on Playwright

These are correctly placed and should not move to jsdom or Story tests:

- edge and marker painting;
- edge labels over their halo background;
- screen-space connection previews;
- minimap click-to-centre mapping;
- resize content versus wrapper geometry;
- mid-gesture overlays;
- node dragging with real culling;
- pane panning through XYPanZoom;
- browser focus and keyboard behavior;
- SSR/hydration;
- ShadowRoot behavior;
- 10k startup and expanded/collapsed frame measurements;
- heap-after-churn and pan-stall diagnostics;
- React Flow/Svelte Flow/Foldkit gallery comparisons.

The browser tests often duplicate logical claims covered below, but their
remaining contribution is real browser wiring. They should not be deleted.

## Test that should move out of ordinary unit tests

The timing assertion in
[`packages/flow/src/geometry/geometry.test.ts`](../packages/flow/src/geometry/geometry.test.ts)
that requires twenty 10k culling scans to finish within 400 ms is a weak fit for
the Pure rung:

- it is environment-dependent;
- it can become flaky under CI load or worker contention;
- the browser benchmark already measures culling in a representative
  environment;
- semantic visible-node behavior is already covered separately.

Keep pure semantic tests for indexed lookup and fallback behavior. Move the 10k
timing threshold to the benchmark/performance suite, where the machine and
measurement protocol are explicit. Alternatively, replace the time threshold
with an operation-count or lookup-count assertion if that can be done without
adding production diagnostics.

## Additional tests recommended

### High priority

1. **Current-graph cycle policy**
   - Test initial cycle rejection.
   - Test a valid connection.
   - Test rejection of a cycle created after that connection.
   - Test self-loops.
   - Ensure the predicate reads current parent-owned edges.

2. **Example route unit tests**
   - `/examples/`;
   - `/examples/minimal/`;
   - unknown examples;
   - `/example/`;
   - `/`;
   - generated prerender paths.

3. **Shared harness Story tests**
   - OutMessage-to-parent graph updates;
   - one-time fit after `ResizedPane`;
   - collapse reconciliation;
   - current `Flow.Context` propagation;
   - resize persistence.

### Medium priority

4. **MountNode stream tests**

   Add focused tests for:

   - initial measurement;
   - ResizeObserver and MutationObserver coalescing;
   - ignoring self-generated transform mutations;
   - `RemovedNodeMeasurement` on teardown;
   - cancellation of queued animation-frame measurement.

5. **Pane-host lifecycle tests**

   Cover register/get/release, identity-safe release after same-`paneId`
   remount, missing-pane lookup, and cleanup after destruction.

6. **Renderer disposal and memo lifecycle**

   Also verify that geometry is rebuilt after disposal, repeated disposal is
   harmless, and rendering after disposal is either supported or explicitly
   rejected by contract.

7. **Property-style graph tests**

   Deterministic generated cases would strengthen parent-position resolution
   with arbitrary ordering, cycles and missing parents, hidden-subtree closure,
   edge filtering and fit bounds for nested subflows.

### Lower priority

8. **Accessibility checks**

   An axe-style Playwright pass could catch duplicate IDs, invalid ARIA
   relationships, missing accessible names and incorrect role/name combinations.
   It should complement, not replace, interaction assertions.

9. **Package smoke test**

   Pack the package into a temporary directory and import the packaged entry
   point. This verifies actual tarball exports and CSS availability rather than
   relying only on `pack --dry-run`.

## Documentation updates

The strategy document should be updated to reflect that:

- the connection-policy example now needs a current-graph follow-up assertion;
- the new examples harness has Pure and Story-level testing opportunities;
- the 10k unit timing check is a performance regression guard and may belong in
  the benchmark rung rather than the ordinary unit suite.

## Conclusion

The ladder is applied correctly to the core Flow library. The main opportunity
is not to move visual tests downward, but to add missing lower-rung tests around
the new example harness and routing.

Recommended order:

1. Fix and test the connection policy against the current graph.
2. Add Pure route and registry tests.
3. Add Story tests for shared harness transitions.
4. Move the 10k timing assertion to the benchmark suite.
5. Add MountNode and pane-host lifecycle tests.
6. Add optional accessibility and package-consumption checks.
