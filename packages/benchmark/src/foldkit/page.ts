import { Option, Schema } from "effect";
import { Command, Runtime, Subscription } from "foldkit";
import type { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";

import type { BenchGraph } from "../fixture";
import { installStats, recordCullScan, recordUpdate } from "../instrument";

export type BenchPageConfig = Readonly<{
  paneId: string;
  graph: BenchGraph;
  viewport: { x: number; y: number; zoom: number };
  cull: boolean;
}>;

/**
 * One benchmark page, driven by the same code for both fixtures.
 *
 * The graph is intentionally static: the harness measures the *interaction*
 * path — the drag overlay, culling, and the node cache — so folding
 * `MovedNodes` back into the graph would add parent-side work the comparison is
 * not about. The per-dispatch cost that *is* measured is the one §2.5.1
 * prescribes: build the fold, read the graph, run `Flow.update`.
 */
export const mountBenchPage = (config: BenchPageConfig): void => {
  const flowNodes: ReadonlyArray<FlowNode<{ label: string }>> =
    config.graph.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      size: { width: 150, height: 36 },
      data: node.data,
    }));

  const flowEdges: ReadonlyArray<FlowEdge> = config.graph.edges;
  const context = { nodes: flowNodes, edges: flowEdges };

  const Model = Schema.Struct({
    flow: Flow.Model,
    measured: Schema.Number,
  });
  type Model = typeof Model.Type;

  const Message = defineMessageUnion({
    GotFlowMessage: { message: Flow.Message },
  });
  type Message = typeof Message.Type;

  const toParentMessage = (message: Flow.Message): Message =>
    Message.GotFlowMessage({ message });

  const init = (): Update.Return<Model, Message> => ({
    model: { flow: Flow.init(config.viewport).model, measured: 0 },
  });

  const update = (
    model: Model,
    message: Message,
  ): Update.Return<Model, Message> =>
    Message.match(message, {
      GotFlowMessage: ({ message: flowMessage }) => {
        const startedAt = performance.now();
        const result = Flow.update(model.flow, flowMessage, context);
        recordUpdate(performance.now() - startedAt);

        const measured = Flow.Message.match(flowMessage, {
          MeasuredNode: () => model.measured + 1,
          // The culling scan is recomputed on viewport frames only (§4.5), so
          // that is where it is sampled.
          MovedViewport: () => {
            recordCullScan(() => Flow.visibleNodes(result.model, flowNodes));
            return model.measured;
          },
          MountedPane: () => model.measured,
          FailedMountPane: () => model.measured,
          ResizedPane: () => model.measured,
          MeasuredHandles: () => model.measured,
          MergedHandleBounds: () => model.measured,
          RemovedNodeMeasurement: () => model.measured,
          FailedMeasureHandles: () => model.measured,
          PressedPane: () => model.measured,
          PressedNode: () => model.measured,
          MovedPointer: () => model.measured,
          ReleasedPointer: () => model.measured,
          CancelledGesture: () => model.measured,
          PressedDeleteKey: () => model.measured,
          PressedEscape: () => model.measured,
          ChangedModifierState: () => model.measured,
          StartedConnection: () => model.measured,
          StartedReconnect: () => model.measured,
          CompletedSyncViewport: () => model.measured,
          FailedSyncViewport: () => model.measured,
        });

        return {
          model: { flow: result.model, measured },
          commands: Command.mapMessages(result.commands ?? [], toParentMessage),
        };
      },
    });

  const renderNode = (
    node: FlowNode<{ label: string }>,
    _tools: Flow.NodeTools,
    h: HtmlBuilder<Message>,
  ): Html => h.div([h.Class("fflow__node-label")], [node.data.label]);

  // Without these the drag leg only dispatches the press: no pointermove ever
  // arrives, so the node never moves and the recorded "drag" frames are idle
  // frames. The gesture path is part of what the harness measures.
  const subscriptions = Subscription.lift(Flow.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.flow),
    toParentMessage,
  });

  const renderer = Flow.createRenderer<{ label: string }, unknown>({
    paneId: config.paneId,
    renderNode,
    cull: config.cull,
  });

  const view = (model: Model, h: HtmlBuilder<Message>): Html =>
    h.div(
      [
        h.Class("bench-root"),
        h.DataAttribute("bench-ready", "true"),
        h.DataAttribute("measured", String(model.measured)),
        h.DataAttribute("rendered", String(model.flow.nodeSizes.length)),
      ],
      [
        renderer.view(
          {
            model: model.flow,
            nodes: flowNodes,
            edges: flowEdges,
            toParentMessage,
          },
          h,
        ),
      ],
    );

  installStats();

  const container = document.getElementById("root");

  if (container !== null) {
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
};
