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
import { installStartup, recordMeasured, recordReady } from "../startup";

export type BenchPageConfig = Readonly<{
  paneId: string;
  graph: BenchGraph;
  viewport: { x: number; y: number; zoom: number };
  cull: boolean;
  /** Draw the M3 chrome (background, controls, minimap). Off for the pages the
   *  M1/M2 gate measures, so their distribution stays comparable with the
   *  previous milestones; the chrome cost has its own leg (§7 M3). */
  chrome?: boolean;
  /** M4: eight resize corners, a snap grid, and fit options on the page's own
   *  controls. Off unless a page is proving something about them. */
  resize?: boolean;
  snapGrid?: { x: number; y: number };
  fitView?: { maxZoom?: number; padding?: number; duration?: number };
  minimap?: boolean;
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
      size: node.size ?? { width: 150, height: 36 },
      data: node.data,
      parentId: node.parentId,
      hidden: node.hidden,
    }));

  const flowEdges: ReadonlyArray<FlowEdge> = config.graph.edges;
  /** How many nodes `hidden` collapses, computed once at mount: the 10k
   *  exploration compares it against the model's node count. */
  const hiddenCount = Flow.hiddenIds(flowNodes).size;
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
          ClickedZoomIn: () => model.measured,
          ClickedZoomOut: () => model.measured,
          ClickedFitView: () => model.measured,
          NudgedNode: () => model.measured,
          ActivatedNode: () => model.measured,
          StartedResize: () => model.measured,
          ClickedMiniMap: () => model.measured,
        });

        // Every node measured: the "full mount" number §4.5 asks for beside the
        // first paint. A page whose nodes are mostly collapsed never reaches it,
        // and then the report has no `measuredAt` rather than a wrong one.
        if (measured >= flowNodes.length) recordMeasured();

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

  // Assigned field by field rather than spread conditionally: the config is a
  // presentation choice per page, and an absent key has to mean "off" rather
  // than "an empty object spread".
  type MutableConfig = {
    -readonly [
      K in keyof Flow.RendererConfig<{ label: string }, unknown>
    ]: Flow.RendererConfig<{ label: string }, unknown>[K];
  };
  const rendererConfig: MutableConfig = {
    paneId: config.paneId,
    renderNode,
    cull: config.cull,
  };
  if (config.chrome === true) {
    rendererConfig.background = { variant: "dots" };
    rendererConfig.minimap = true;
  }
  if (config.chrome === true || config.minimap === true) {
    rendererConfig.controls = true;
    rendererConfig.minimap = true;
  }
  if (config.resize === true) rendererConfig.resize = true;
  if (config.snapGrid !== undefined) rendererConfig.snapGrid = config.snapGrid;
  if (config.fitView !== undefined) rendererConfig.fitView = config.fitView;

  const renderer = Flow.createRenderer<{ label: string }, unknown>(
    rendererConfig,
  );

  const view = (model: Model, h: HtmlBuilder<Message>): Html => {
    recordReady();
    return h.div(
      [
        h.Class("bench-root"),
        h.DataAttribute("bench-ready", "true"),
        h.DataAttribute("measured", String(model.measured)),
        h.DataAttribute("rendered", String(model.flow.nodeSizes.length)),
        // M4: the graph the model holds, and how many of those nodes `hidden`
        // collapses — the two numbers the 10k exploration compares.
        h.DataAttribute("nodes", String(config.graph.nodes.length)),
        h.DataAttribute("hidden", String(hiddenCount)),
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
  };

  installStats();
  installStartup();

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
