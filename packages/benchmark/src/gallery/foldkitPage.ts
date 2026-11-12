import { Match, Option, Schema } from "effect";
import { Command, Runtime, Subscription } from "foldkit";
import type { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import * as Flow from "@fllstck/foldkit-flow";
import type { FlowEdge, FlowNode } from "@fllstck/foldkit-flow";
import "@fllstck/foldkit-flow/style.css";

import type { GalleryEdgeKind, GalleryFixture } from "./fixtures";
import { galleryFixture, readGalleryQuery } from "./fixtures";

/**
 * One gallery fixture, rendered by `@fllstck/foldkit-flow`.
 *
 * The fixture is the same data the React Flow page renders (`reactPage.tsx`), so
 * the two libraries are compared on one input rather than on two hand-written
 * pages that happen to look alike.
 *
 * `fit` is the interesting case: the fit needs the pane's measured box, so it is
 * folded from `ResizedPane` — the same two-step a consumer writes in its own
 * `update` (`docs/CONTRACT.md`, "fitView options") rather than a renderer option.
 */
const kindOf = (kind: GalleryEdgeKind): FlowEdge["type"] => kind;

export const mountGalleryPage = (fixture: GalleryFixture): void => {
  const flowNodes: ReadonlyArray<FlowNode<{ label: string }>> =
    fixture.nodes.map((entry) => ({
      id: entry.id,
      position: { x: entry.x, y: entry.y },
      size: { width: entry.width, height: entry.height },
      data: { label: entry.label },
      parentId: entry.parentId,
      hidden: entry.hidden,
    }));

  const flowEdges: ReadonlyArray<FlowEdge> = fixture.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: kindOf(edge.kind),
    label: edge.label,
    markerEnd: edge.markerEnd,
  }));

  const context = { nodes: flowNodes, edges: flowEdges };
  const initialViewport =
    fixture.viewport === "fit" ? { x: 0, y: 0, zoom: 1 } : fixture.viewport;

  const Model = Schema.Struct({
    flow: Flow.Model,
    isFitted: Schema.Boolean,
  });
  type Model = typeof Model.Type;

  const Message = defineMessageUnion({
    GotFlowMessage: { message: Flow.Message },
  });
  type Message = typeof Message.Type;

  const toParentMessage = (message: Flow.Message): Message =>
    Message.GotFlowMessage({ message });

  const init = (): Update.Return<Model, Message> => ({
    model: { flow: Flow.init(initialViewport).model, isFitted: false },
  });

  const update = (
    model: Model,
    message: Message,
  ): Update.Return<Model, Message> =>
    Message.match(message, {
      GotFlowMessage: ({ message: flowMessage }) => {
        const result = Flow.update(model.flow, flowMessage, context);
        const commands = result.commands ?? [];

        // The pane's box is only known after it has been measured, so this is
        // where a fit can run — once. `Message.match` is exhaustive over 27
        // variants, so a partial question is asked with Effect's `Match`.
        const isResizedPane = Match.value(flowMessage).pipe(
          Match.when({ _tag: "ResizedPane" }, () => true),
          Match.orElse(() => false),
        );
        const fit =
          fixture.viewport === "fit" && !model.isFitted && isResizedPane;

        if (!fit) {
          return {
            model: { flow: result.model, isFitted: model.isFitted },
            commands: Command.mapMessages(commands, toParentMessage),
          };
        }

        const viewport = Flow.fitViewport(result.model, flowNodes, {
          padding: fixture.padding ?? 0.1,
        });
        const fitted = Flow.setViewport(result.model, viewport);

        return {
          model: { flow: fitted.model, isFitted: true },
          commands: Command.mapMessages(
            [...commands, ...(fitted.commands ?? [])],
            toParentMessage,
          ),
        };
      },
    });

  // The box comes from the consumer's content, which is the documented split:
  // the flow draws a box only when it owns one (§7 M4). Both pages therefore
  // render a node of the fixture's declared size, and the edge anchors are
  // computed from the same 140×60 — otherwise this would compare typography.
  const renderNode = (
    node: FlowNode<{ label: string }>,
    _tools: Flow.NodeTools,
    h: HtmlBuilder<Message>,
  ): Html => {
    const width = node.size?.width ?? 140;
    const height = node.size?.height ?? 60;
    return h.div(
      [
        h.Class("fflow__node-label gallery-node"),
        h.Attribute(
          "style",
          `width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center`,
        ),
      ],
      [node.data.label],
    );
  };

  const subscriptions = Subscription.lift(Flow.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.flow),
    toParentMessage,
  });

  // `resize: false` is the same thing as an absent key (every option in
  // `RendererConfig` is read as `=== true`), and it keeps this a plain inferred
  // object rather than a conditional spread.
  const renderer = Flow.createRenderer<{ label: string }, unknown>({
    paneId: "gallery-pane",
    renderNode,
    resize: fixture.resize === true,
  });

  const view = (model: Model, h: HtmlBuilder<Message>): Html =>
    h.div(
      [
        h.Class("gallery-root"),
        h.DataAttribute("gallery-ready", "true"),
        h.DataAttribute("gallery-fixture", fixture.name),
        h.DataAttribute("gallery-fitted", String(model.isFitted)),
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

const { name, variant } = readGalleryQuery(window.location.search);
mountGalleryPage(galleryFixture(name, variant));
