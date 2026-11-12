# README quality review

## Findings

### HIGH — The quick start does not implement the behavior it describes

**Locations:** [`README.md`](../README.md) and
[`packages/flow/README.md`](../packages/flow/README.md)

The quick-start prose says:

> You fold its Messages, run the Commands it returns, and answer its OutMessages
> by editing your graph.

However, the sample:

- defines `nodes` and `edges` as module-level constants;
- passes those immutable arrays to `Flow.update` and `renderer.view`;
- does not fold any `Flow.OutMessage`;
- does not update the graph after a drag, connection, deletion, resize or
  reconnect.

Therefore, it does not demonstrate the advertised parent-owned graph pattern,
and interactions will not persist in the displayed graph. The prose recommends
`Update.foldChild`, but the code does not show it.

The quick start should either:

1. use a compact `Update.foldChild` example that folds the important facts, such
   as `MovedNodes`, `ConnectedHandles`, `DeletedElements` and `ResizedNodes; or
2. explicitly label the snippet as a rendering-only/minimal setup and link to
   the complete working harness in
   [`packages/example/src/examples/harness.ts`](../packages/example/src/examples/harness.ts).

Because both READMEs contain the same snippet, they should be fixed together.

### MEDIUM — `Flow.remeasure` is shown with the wrong exported name

**Locations:** [`README.md`](../README.md) and
[`packages/flow/README.md`](../packages/flow/README.md)

Both files tell users to call:

```ts
Flow.remeasure(paneId, nodeIds);
```

The actual exported API is uppercase:

```ts
Flow.Remeasure(paneId, nodeIds);
```

`Flow.Remeasure` is exported from
[`packages/flow/src/index.ts`](../packages/flow/src/index.ts). It is a Command
constructor, so the lowercase example does not compile. The authoritative
[`docs/CONTRACT.md`](./CONTRACT.md) already uses the correct spelling.

## Strengths

- The split between the repository README and package README is clear.
- Install instructions, peer versions, CSS requirements, package status and
  unsupported features are explicit.
- The measurement contract is concise and consistent with
  [`docs/CONTRACT.md`](./CONTRACT.md).
- The documentation hierarchy is easy to follow.
- Performance claims link to measured evidence rather than unsupported
  guarantees.
- The package README correctly avoids linking to repository-relative files as
  though they were included in the npm tarball.
- The `renderer.dispose()` guidance and stable renderer-lifetime warning are
  useful and accurate.

## Recommended follow-up

Add a documentation compilation or example test that type-checks README code
snippets. This would catch the `Flow.remeasure` casing error and help ensure
the quick-start wiring remains executable as the API evolves.
