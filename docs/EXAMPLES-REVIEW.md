# Example harness review

## Scope

This review covered the new example registry, shared harness, individual example
specifications, server/client routing, and the example browser proof. It also
checked the integration against the Foldkit constraints documented in
[`foldkit-constraints.md`](./foldkit-constraints.md).

## Finding

### MEDIUM — The connection-policy example does not reject cycles

**Location:** [`packages/example/src/examples/specs/connection-policy.ts`](../packages/example/src/examples/specs/connection-policy.ts)

The example says that it rejects a connection that would close a cycle and
specifically instructs the reader to drag from the last node back to the first.
Its graph is:

```text
a → b
b → c
b → d
```

But the predicate only rejects an exact reverse of an existing edge:

```ts
!edges.some(
  (edge) =>
    edge.source === connection.target && edge.target === connection.source,
);
```

Connecting `c → a` does not match any direct reverse edge, so it is accepted even
though it creates the cycle `a → b → c → a`.

The example should either implement directed-cycle detection by checking whether
the proposed target can already reach the proposed source, or change its
description and comments to say that it rejects only direct reverse edges. As
written, its central teaching point is inaccurate.

The policy is otherwise placed correctly: it is pure example-level logic and is
passed through `Flow.Context` rather than stored in Flow state.

## Harness review

No other Foldkit integration issues were found. The harness follows the
documented patterns:

- application state is held in the parent Model;
- Flow state is folded through `Update.foldChild`;
- graph nodes and edges remain parent-owned;
- `Flow.Context` is derived from the current parent Model;
- Flow `OutMessage`s are folded back into parent graph updates;
- pane fitting waits for `ResizedPane`;
- viewport changes use the returned Commands;
- subscriptions are composed with `Subscription.lift`;
- renderer configuration is created once per application;
- custom node renderers use `tools.handle(...)`;
- server and client routing use the same registry and route resolution;
- example sources are statically imported and prerendered consistently.

## Validation

The following checks passed:

- example package typecheck;
- example package production build;
- prerendering of all seven example pages;
- `tests/examples.spec.ts` — 1 test passed;
- mounting of every registered example;
- collapse and fit behavior browser proofs.

No implementation changes were made as part of this review.
