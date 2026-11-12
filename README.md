# @fllstck/foldkit-flow

A flow / node-graph canvas for [Foldkit](https://foldkit.dev): one Model, pure `update`, every effect at a named seam.

Published as **`0.1.1`**. It covers the whole M0–M5 surface:
pan/zoom, drag, select, delete, connect and reconnect, node resizing, sub-flows,
collapsing, snap, edge types, markers and labels, a minimap, own chrome and an
accessibility layer.

M6 adds three opt-in behaviours on top: **edge selection and edge focus**
(`edgeSelection`), **drag-to-pan inside the minimap**, and an **aspect-ratio lock** on a
resize (hold Shift). Everything else on M6's list was researched and deliberately left
out, with the reason and what would change it in
[`docs/M6-RESEARCH.md`](docs/M6-RESEARCH.md). `1.0.0` waits until the library has had
real use.

## Install

```sh
pnpm add @fllstck/foldkit-flow
```

Peers: `foldkit@0.170.0` and `effect@~4.1.0`. The library ships geometry, pan/zoom,
handle measurement and `fitView` from [`@xyflow/system`](https://github.com/xyflow/xyflow)
as a normal dependency; the graph itself is rendered by Foldkit's own `view`.

The stylesheet is **not optional** — handle boxes are geometry the engine measures,
so a page without it has 0×0 handles and nothing to hit:

```ts
import "@fllstck/foldkit-flow/style.css";
```

## Quick start

A flow is a submodel of yours: you fold its Messages, run the Commands it returns,
and answer its OutMessages by editing *your* graph. Two steps — render it, then keep
the facts it reports.

**Step 1 — render it.** This compiles and runs: it draws the graph, pans, zooms,
selects and starts gestures.

```ts
import { Option, Schema } from "effect";
import { Command, Subscription } from "foldkit";
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

const init = () => ({ model: { flow: Flow.init({ x: 0, y: 0, zoom: 1 }).model } });
const toParentMessage = (message: Flow.Message) => Message.GotFlowMessage({ message });

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
>({ read: (model) => Option.some(model.flow), toParentMessage });

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
});

const view = (model: typeof Model.Type, h: HtmlBuilder<typeof Message.Type>) =>
  renderer.view({ model: model.flow, nodes, edges, toParentMessage }, h);
```

What that snippet does **not** do is keep anything: `nodes` and `edges` are constants
and the facts the flow reports go nowhere, so a drag springs back, a connection
draws nothing, and a resize is forgotten on the next render.

**Step 2 — keep the facts.** `Flow.update` reports one OutMessage per Message —
`MovedNodes`, `ConnectedHandles`, `ReconnectedEdge`, `DeletedElements`,
`ResizedNodes`, `SelectedElements`, `ChangedViewport` — and `Update.foldChild`'s
`foldOutMessage` is where they become your graph: one branch per fact, each
returning the next Model. `Flow.OutMessage.match` is exhaustive, so the compiler
lists them for you as you go.

The typed version of all seven is `foldFlow` in
[`packages/example/src/examples/harness.ts`](packages/example/src/examples/harness.ts)
— the file the seven example pages run and `tests/examples.spec.ts` walks — and
[`docs/CONTRACT.md`](docs/CONTRACT.md#connections) says what each fact means. Copy
that shape rather than this page: the harness is compiled, typed and proved, and a
second version of it here would be a snippet nobody checks.

Then `Runtime.makeApplication({ Model, init, update, view, subscriptions, container })`.

## The measurement contract

Handles are geometry, and geometry is DOM truth. Three sentences, and your app has
to act on all three:

1. While a node's DOM changes through the renderer — its content, its handles,
   styles it applies itself — geometry stays fresh automatically.
2. If **external CSS** changes layout without any DOM event (a class on an ancestor,
   a theme swap, a CSS-variable change), call `Flow.Remeasure(paneId, nodeIds)`.
3. Until you do, hit-testing is still correct — every connection gesture starts with
   a `MeasureHandles` checkpoint — but **edge endpoints may point at the old handle
   position**.

## What you get

Every item is opt-in and documented in **[`docs/CONTRACT.md`](docs/CONTRACT.md)**,
with the reasoning and the proofs in the milestone findings.

| Area | What it is |
| --- | --- |
| Rendering | nodes as positioned divs, edges as SVG paths from `@xyflow/system`, your markup via `renderNode` |
| Gestures | drag, select (additive), delete, connect, reconnect, resize — all Messages in `Flow.update` |
| Viewport | pan/zoom from `XYPanZoom`, culling, `Flow.fitViewport`, zoom bounds with one source of truth |
| Graph | parent/child sub-flows, `hidden` collapsing, snap grid, `fitView` options |
| Edges | Bezier / Step / SmoothStep / Straight, labels, markers |
| Chrome | background (dots or lines), zoom/fit controls, minimap, consumer panel |
| Accessibility | focusable nodes, arrow-key nudging, Enter/Space activation, a description region |
| Performance | culling and a bounded node cache; the gate, the 1k/10k numbers and the ceiling are in [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) |

## Project layout

| Path | What it is |
| --- | --- |
| `packages/flow` | the library — this is what ships |
| `packages/example` | the demo playground (`/`), the presentable pipeline (`/example/`) and seven examples (`/examples/`) |
| `packages/benchmark` | the frame gate, the 10k explorations, the fixture gallery against React Flow, and the churn/stall diagnostics |
| `docs` | the plan, the published benchmarks, the contract, and the milestone findings |

Want to see it running before wiring anything? `pnpm dev` serves
`http://localhost:5173/examples/` — seven small flows, each with the source that
produced it beside it.

## Documentation

- **[docs/CONTRACT.md](docs/CONTRACT.md)** — the public contract, feature by feature.
- **[docs/BENCHMARKS.md](docs/BENCHMARKS.md)** — what it costs: the protocol, the machine, the numbers, the 10k ceiling, and how to reproduce every figure.
- **[docs/PLAN.md](docs/PLAN.md)** — the design: ownership split, runtime wiring, the hot path, milestones.
- **[docs/verification.md](docs/verification.md)** — the boundary rule that keeps a published figure honest.
- **[docs/TEST-STRATEGY.md](docs/TEST-STRATEGY.md)** — the five rungs the tests sit on, and which claim lives where.
- **[CHANGELOG.md](packages/flow/CHANGELOG.md)** — what changed in each release, and what did not.
- **[docs/RELEASING.md](docs/RELEASING.md)** — the release checklist, including the two steps that need npm credentials the agent does not have.
- **Findings** — [`M0`](docs/M0-FINDINGS.md), [`M1`](docs/M1-FINDINGS.md), [`M2`](docs/M2-FINDINGS.md), [`M3`](docs/M3-FINDINGS.md), [`M4`](docs/M4-FINDINGS.md), [`M5`](docs/M5-FINDINGS.md): what each milestone shipped, what it got wrong, and what the reviews found.

## Contributing

Build, test and measurement commands, the fast loop, and the traps that have cost
this repo hours: **[`CONTRIBUTING.md`](CONTRIBUTING.md)**.

## License

MIT — see [`LICENSE`](LICENSE). The MIT notice for `@xyflow/system`, which this
package depends on for geometry and pan/zoom, is in
[`packages/flow/THIRD-PARTY-NOTICES.md`](packages/flow/THIRD-PARTY-NOTICES.md).
