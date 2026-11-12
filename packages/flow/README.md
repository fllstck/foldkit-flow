# @fllstck/foldkit-flow

A flow / node-graph canvas for [Foldkit](https://foldkit.dev) — one Model, pure
`update`, every effect at a named seam. Geometry (bezier, step, smoothstep and
straight edge paths, pan/zoom, handle measurement, `fitView`) comes from
[`@xyflow/system`](https://github.com/xyflow/xyflow); the graph itself is rendered
by Foldkit's own `view`, and the node and edge data stay owned by your app.

**Status: `0.1.1`.** It covers M0–M5: the interaction core,
measurement, chrome and accessibility, sub-flows, resizing, snap, edge types and the
performance work. The Model/Message/OutMessage shapes, the measurement contract and
the `fflow__` class prefix are the parts meant to hold still; `1.0.0` follows once the
library has had real use, rather than on a milestone's say-so.
Deliberately absent, and planned as research-first work: edge selection, minimap
drag, `nodeOrigin`, multi-node resize, interactive edge labels, and React Flow's
`XYResizer` seam. The full list and the reasoning are in the repository's
`docs/M4-FINDINGS.md` §8 and `docs/PLAN.md` §7 (M6).

## Install

```sh
pnpm add @fllstck/foldkit-flow
```

Peers: `foldkit` (0.170.0) and `effect` (~4.1.0) — this is a Foldkit submodel, not
a framework of its own. `@xyflow/system` is a normal dependency.

The stylesheet is not optional: handle boxes are geometry the engine measures, so a
page without it has 0×0 handles and nothing to hit.

```ts
import "@fllstck/foldkit-flow/style.css";
```

## Quick start

A flow is a submodel of yours: you fold its Messages, run the Commands it returns,
and answer its OutMessages by editing *your* graph.

**What the snippet below does:** it compiles, draws the graph, and handles
pan/zoom, selection and the start of every gesture. **What it does not do** is keep
anything — `nodes` and `edges` are constants and the facts the flow reports are
dropped, so a drag springs back and a connection draws nothing. Persisting them is
step 2, after the snippet.

```ts
import { Option, Schema } from "effect";
import { Command, Subscription, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";

const nodes: ReadonlyArray<FlowNode<{ label: string }>> = [
  { id: "a", position: { x: 0, y: 0 }, data: { label: "A" } },
  { id: "b", position: { x: 260, y: 120 }, data: { label: "B" } },
];
const edges: ReadonlyArray<FlowEdge> = [
  { id: "e1", source: "a", target: "b", markerEnd: "ArrowClosed" },
];

const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
});

const Model = Schema.Struct({ flow: Flow.Model });

const init = () => ({
  model: { flow: Flow.init({ x: 0, y: 0, zoom: 1 }).model },
});

const toParentMessage = (message: Flow.Message) =>
  Message.GotFlowMessage({ message });

const update = (model: typeof Model.Type, message: typeof Message.Type) =>
  Message.match(message, {
    GotFlowMessage: ({ message: flowMessage }) => {
      const result = Flow.update(model.flow, flowMessage, { nodes, edges });
      return {
        model: { flow: result.model },
        commands: Command.mapMessages(result.commands ?? [], toParentMessage),
      };
    },
  });

// Gesture Messages (document-level pointermove/up during a drag, delete, Escape)
// only arrive if the flow's subscriptions are mounted.
const subscriptions = Subscription.lift(Flow.subscriptions)<
  typeof Model.Type,
  typeof Message.Type
>({
  read: (model) => Option.some(model.flow),
  toParentMessage,
});

const renderNode = (
  node: FlowNode<{ label: string }>,
  _tools: Flow.NodeTools,
  h: HtmlBuilder<typeof Message.Type>,
): Html => h.div([h.Class("fflow__node-label")], [node.data.label]);

// Created once, at module or app scope: the node cache lives on the renderer, and
// rebuilding it per render silently disables that memoization. Call
// `renderer.dispose()` when a route or tab permanently unmounts the flow.
const renderer = Flow.createRenderer({
  paneId: "main-flow",
  renderNode,
  background: { variant: "dots" },
  controls: true,
  minimap: true,
  accessibleName: (node) => node.data.label,
});

const view = (model: typeof Model.Type, h: HtmlBuilder<typeof Message.Type>) =>
  renderer.view({ model: model.flow, nodes, edges, toParentMessage }, h);
```

**Step 2 — keep the facts.** `Flow.update` reports one OutMessage per Message —
`MovedNodes`, `ConnectedHandles`, `ReconnectedEdge`, `DeletedElements`,
`ResizedNodes`, `SelectedElements`, `ChangedViewport` — and `Update.foldChild`'s
`foldOutMessage` is where they become your graph: one branch per fact, each
returning the next Model. `Flow.OutMessage.match` is exhaustive, so the compiler
lists them for you.

The typed version of all seven is `foldFlow` in `packages/example/src/examples/harness.ts`
in this repository — the file seven example pages run and a browser test walks — and
`docs/CONTRACT.md` says what each fact means. Copy that shape rather than a second
one pasted here.

Then `Runtime.makeApplication({ Model, init, update, view, subscriptions,
container })` — the same wiring any Foldkit app uses. The playground in
`packages/example` is a working 630-node version of exactly this, with the
`data-*` instrumentation the browser proofs read.

## The measurement contract

Handles are geometry, and geometry is DOM truth. Three sentences, and your app has
to act on all three:

1. While a node's DOM changes through the renderer — its content, its handles,
   styles it applies itself — geometry stays fresh automatically, because a
   `ResizeObserver` watches the node and a `MutationObserver` watches its subtree,
   coalesced to one measurement per animation frame.
2. If **external CSS** changes layout without producing either event (a class on an
   ancestor, a theme swap, a CSS-variable change), call
   `Flow.Remeasure(paneId, nodeIds)`.
3. Until you do, hit-testing is still correct — every connection gesture starts
   with a `MeasureHandles` checkpoint — but **edge endpoints may point at the old
   handle position**.

## Documentation

- **The full contract**: `docs/CONTRACT.md` in the repository — the public API
  surface, chrome, graph features (sub-flows, `hidden`, resizing, snap, `fitView`
  options, markers, labels) and accessibility — with quick starts in that
  repository's `README.md` and build/test commands in `CONTRIBUTING.md`. None of
  them are shipped inside this package; the paths are named rather than linked
  because npm has no repository root to link to.
- **`docs/PLAN.md`**: the design — ownership split, runtime wiring, the hot path,
  the performance gate, milestones.
- **`docs/BENCHMARKS.md`**: the measured numbers, the protocol, the machine and the
  reproduction command.
- **`docs/verification.md`**: the boundary rule ("assert at the layer the user
  perceives") and the five-question checklist every visual feature answers here.

## Licence

MIT — see `LICENSE`. The MIT notice for `@xyflow/system`, which this package
depends on for geometry and pan/zoom, is in `THIRD-PARTY-NOTICES.md`.
