# @fllstck/foldkit-flow

A flow / node-graph canvas for [Foldkit](https://foldkit.dev) — one Model, pure
`update`, every effect at a named seam. Geometry (bezier, step, smoothstep and
straight edge paths, pan/zoom, handle measurement, `fitView`) comes from
[`@xyflow/system`](https://github.com/xyflow/xyflow); the graph itself is rendered
by Foldkit's own `view`, and the node and edge data stay owned by your app.

**Status: v1.0 (M0–M4 shipped, M5 hardening).** The Model/Message/OutMessage
shapes, the measurement contract and the `fflow__` class prefix are stable.
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

`Flow.update` also *reports* facts — `ConnectedHandles`, `MovedNodes`,
`ResizedNodes`, `DeletedElements`, `ReconnectedEdge` — as one OutMessage per
Message. They are what your app applies to its own graph, and the idiomatic way to
fold them is `Update.foldChild({ update, read, write, toParentMessage,
foldOutMessage })`; `src/example/app.ts` in this repository does exactly that, one
`foldOutMessage` branch per fact.

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
   `Flow.remeasure(paneId, nodeIds)`.
3. Until you do, hit-testing is still correct — every connection gesture starts
   with a `MeasureHandles` checkpoint — but **edge endpoints may point at the old
   handle position**.

## Documentation

- **The full contract**: `README.md` at the root of this repository — the public
  API surface, chrome, graph features (sub-flows, `hidden`, resizing, snap,
  `fitView` options, markers, labels), accessibility, and the development
  commands. It is not shipped inside this package; the path is named rather than
  linked because npm has no repository root to link to.
- **`docs/PLAN.md`**: the design — ownership split, runtime wiring, the hot path,
  the performance gate, milestones.
- **`docs/BENCHMARKS.md`**: the measured numbers, the protocol, the machine and the
  reproduction command.
- **`docs/verification.md`**: the boundary rule ("assert at the layer the user
  perceives") and the five-question checklist every visual feature answers here.

## Licence

MIT — see `LICENSE`. The MIT notice for `@xyflow/system`, which this package
depends on for geometry and pan/zoom, is in `THIRD-PARTY-NOTICES.md`.
