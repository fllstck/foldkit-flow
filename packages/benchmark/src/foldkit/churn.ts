import { Stream } from "effect";
import { Schema } from "effect";
import { Command, Runtime, Subscription } from "foldkit";
import type { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowNode } from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";

import { installStartup, recordReady } from "../startup";

/**
 * The create/delete churn page (§4.5: "JS heap after a 1,000-create/1,000-delete
 * churn loop", the memo-cache bound).
 *
 * What is being measured is the **renderer's node cache**: one lazy slot per node
 * id, swept when an id is absent from a render pass, so memory follows the largest
 * graph rendered rather than its history. Only a churn loop shows that: the graph
 * stays 200 nodes while 1,000 unique ids pass through it, so a cache that swept
 * stays at 200 slots and one that did not would reach 1,200.
 *
 * The loop is a Subscription — the seam for "an external event while a Model
 * condition holds" — so each step is a dispatch and a render, not a mutation
 * behind the renderer's back. One node in, one node out, so the graph never grows.
 */
const PANE_ID = "churn-pane";
const BASE_NODES = 200;
const CHURN_CYCLES = 1000;
const STEP_INTERVAL = "2 millis";

const NodeData = Schema.Struct({ label: Schema.String });
type NodeData = typeof NodeData.Type;

const makeGraph = (count: number): ReadonlyArray<FlowNode<NodeData>> =>
  Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    position: { x: (index % 20) * 180, y: Math.floor(index / 20) * 100 },
    size: { width: 150, height: 60 },
    data: { label: `n${index}` },
  }));

const baseNodes = makeGraph(BASE_NODES);

export const Model = Schema.Struct({
  flow: Flow.Model,
  /** The churn node. `""` is the "deleted" half of the loop; the id it carries is
   *  never reused, which is what makes the cache sweep observable. */
  churnedId: Schema.String,
  step: Schema.Number,
  /** How many loops have been started: the driver's handle on "which completion
   *  is this", so a stale `done` from a previous loop cannot be mistaken for the
   *  current one. */
  loop: Schema.Number,
  isRunning: Schema.Boolean,
  isDone: Schema.Boolean,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  GotFlowMessage: { message: Flow.Message },
  StartedChurn: {},
  ChurnStep: {},
});
export type Message = typeof Message.Type;

const toParentMessage = (message: Flow.Message): Message =>
  Message.GotFlowMessage({ message });

export const init = (): Update.Return<Model, Message> => ({
  model: {
    flow: Flow.init({ x: 20, y: 20, zoom: 0.6 }).model,
    churnedId: "",
    step: 0,
    loop: 0,
    isRunning: false,
    isDone: false,
  },
});

/** The graph at this step: 200 nodes, or 201 while the churn node exists. */
const nodesAfter = (model: Model): ReadonlyArray<FlowNode<NodeData>> =>
  model.churnedId === ""
    ? baseNodes
    : [
        ...baseNodes,
        {
          id: model.churnedId,
          position: { x: 0, y: 0 },
          size: { width: 150, height: 60 },
          data: { label: model.churnedId },
        },
      ];

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match(message, {
    GotFlowMessage: ({ message: flowMessage }) => {
      const result = Flow.update(model.flow, flowMessage, {
        nodes: nodesAfter(model),
        edges: [],
      });
      return {
        model: { ...model, flow: result.model },
        commands: Command.mapMessages(result.commands ?? [], toParentMessage),
      };
    },
    StartedChurn: () => ({
      model: {
        ...model,
        loop: model.loop + 1,
        isRunning: true,
        isDone: false,
        step: 0,
        churnedId: "",
      },
    }),
    ChurnStep: () => {
      if (!model.isRunning) return { model };

      const step = model.step + 1;
      const next: Model = {
        ...model,
        step,
        churnedId: model.churnedId === "" ? `churn-${step}` : "",
        isRunning: step < CHURN_CYCLES * 2,
        isDone: step >= CHURN_CYCLES * 2,
      };
      // The graph changed under the flow's nose, so the parent prunes what it can
      // no longer see — the same call a consumer makes after its own edit
      // (§2.5.9), and part of what the loop is measuring.
      const pruned = Flow.informGraphChanged(next.flow, {
        nodes: nodesAfter(next),
        edges: [],
      });
      return { model: { ...next, flow: pruned.model } };
    },
  });

/** One tick per step while the loop runs. */
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  churn: entry(
    { isRunning: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ isRunning: model.isRunning }),
      dependenciesToStream: ({ isRunning }) =>
        isRunning
          ? Stream.tick(STEP_INTERVAL).pipe(
              Stream.map(() => Message.ChurnStep()),
            )
          : Stream.empty,
    },
  ),
}));

const renderNode = (
  node: FlowNode<NodeData>,
  _tools: Flow.NodeTools,
  h: HtmlBuilder<Message>,
): Html => h.div([h.Class("fflow__node-label")], [node.data.label]);

const renderer = Flow.createRenderer<NodeData, unknown>({
  paneId: PANE_ID,
  renderNode,
});

declare global {
  interface Window {
    __churn?: {
      cacheSize: () => number;
      peakCacheSize: () => number;
      cycles: number;
    };
  }
}

let peakCacheSize = 0;
const sampleCache = (): void => {
  const size = renderer.cacheSize();
  if (size > peakCacheSize) peakCacheSize = size;
};
window.__churn = {
  cacheSize: () => renderer.cacheSize(),
  peakCacheSize: () => peakCacheSize,
  cycles: CHURN_CYCLES,
};

const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  recordReady();
  sampleCache();
  return h.div(
    [
      h.Class("bench-root"),
      h.DataAttribute("bench-ready", "true"),
      h.DataAttribute("churn-step", String(model.step)),
      h.DataAttribute("churn-loop", String(model.loop)),
      h.DataAttribute("churn-done", String(model.isDone)),
      h.DataAttribute(
        "churn-nodes",
        String(BASE_NODES + (model.churnedId === "" ? 0 : 1)),
      ),
    ],
    [
      h.button(
        [
          h.Class("ex-button"),
          h.DataAttribute("churn-start", ""),
          h.OnClick(Message.StartedChurn()),
        ],
        ["Start churn"],
      ),
      renderer.view(
        {
          model: model.flow,
          nodes: nodesAfter(model),
          edges: [],
          toParentMessage,
        },
        h,
      ),
    ],
  );
};

const container = document.getElementById("root");
if (container !== null) {
  installStartup();
  Runtime.run(
    Runtime.makeElement({
      Model,
      init,
      update,
      view,
      subscriptions,
      container,
    }),
  );
}
