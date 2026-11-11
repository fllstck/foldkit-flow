import { Mount } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { edgePath } from "../geometry/paths.js";
import type { Message } from "../message.js";
import type { FlowEdge, FlowNode, Model, NodeSize, Size } from "../model.js";
import { MountNode } from "../runtime/mountNode.js";
import { MountPane, transformOf } from "../runtime/mountPane.js";
import * as classes from "./classes.js";

export type NodeTools = Readonly<{
  isSelected: boolean;
  isDragging: boolean;
}>;

export type RendererConfig<NodeData, EdgeData> = Readonly<{
  /** Stable across renders: this reference participates in node memoization
   *  identity once the cache lands in M1. */
  renderNode: (
    node: FlowNode<NodeData>,
    tools: NodeTools,
    h: HtmlBuilder<any>,
  ) => Html;
  renderEdgeLabel?: (edge: FlowEdge<EdgeData>, h: HtmlBuilder<any>) => Html;
  /** Host-registry key (§2.5, §4.3). */
  paneId: string;
  minZoom?: number;
  maxZoom?: number;
}>;

export type ViewInput<ParentMessage, NodeData, EdgeData> = Readonly<{
  model: Model;
  nodes: ReadonlyArray<FlowNode<NodeData>>;
  edges: ReadonlyArray<FlowEdge<EdgeData>>;
  toParentMessage: (message: Message) => ParentMessage;
}>;

export type Renderer<NodeData, EdgeData> = Readonly<{
  view: <ParentMessage>(
    input: ViewInput<ParentMessage, NodeData, EdgeData>,
    h: HtmlBuilder<ParentMessage>,
  ) => Html;
  /** Drops every cached VNode. M0 has no cache yet; M1 owns it (§3.3, §4.5). */
  dispose: () => void;
}>;

const fallbackSize: Size = { width: 150, height: 40 };

const sizeOf = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
): Size => {
  const measured = nodeSizes.find((size) => size.nodeId === node.id);
  if (measured !== undefined) {
    return { width: measured.width, height: measured.height };
  }
  if (node.size !== undefined) return node.size;
  return fallbackSize;
};

const nodeTools: NodeTools = { isSelected: false, isDragging: false };

export const createRenderer = <NodeData = unknown, EdgeData = unknown>(
  config: RendererConfig<NodeData, EdgeData>,
): Renderer<NodeData, EdgeData> => {
  const view = <ParentMessage>(
    input: ViewInput<ParentMessage, NodeData, EdgeData>,
    h: HtmlBuilder<ParentMessage>,
  ): Html => {
    const { model, nodes, edges } = input;
    const nodesById = new Map(nodes.map((node) => [node.id, node]));

    const edgesView = h.svg(
      [
        h.Class(classes.Edges),
        h.Attribute("width", "100%"),
        h.Attribute("height", "100%"),
        h.Style({
          position: "absolute",
          top: "0",
          left: "0",
          overflow: "visible",
        }),
        h.Attribute("aria-hidden", "true"),
      ],
      edges.flatMap((edge) => {
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        if (source === undefined || target === undefined) return [];

        const sourceSize = sizeOf(source, model.nodeSizes);
        const targetSize = sizeOf(target, model.nodeSizes);
        const geometry = edgePath(edge.type ?? "Bezier", {
          sourceX: source.position.x + sourceSize.width / 2,
          sourceY: source.position.y + sourceSize.height,
          targetX: target.position.x + targetSize.width / 2,
          targetY: target.position.y,
          sourcePosition: "Bottom",
          targetPosition: "Top",
        });

        const label =
          edge.label !== undefined && config.renderEdgeLabel !== undefined
            ? [
                h.text(
                  [
                    h.Attribute("x", String(geometry.labelX)),
                    h.Attribute("y", String(geometry.labelY)),
                    h.Attribute("text-anchor", "middle"),
                    h.Class(classes.EdgePath),
                  ],
                  [edge.label],
                ),
              ]
            : [];

        return [
          h.keyed("g")(
            edge.id,
            [h.Class(classes.Edge), h.DataAttribute("edgeid", edge.id)],
            [
              h.path([h.Attribute("d", geometry.d), h.Class(classes.EdgePath)]),
              ...label,
            ],
          ),
        ];
      }),
    );

    const nodesView = h.div(
      [h.Class(classes.Nodes)],
      nodes.map((node) =>
        h.keyed("div")(
          node.id,
          [
            h.Class(classes.Node),
            h.DataAttribute("nodeid", node.id),
            h.Style({
              position: "absolute",
              top: "0",
              left: "0",
              transform: `translate(${node.position.x}px, ${node.position.y}px)`,
            }),
            h.OnMount(
              Mount.mapMessage(
                MountNode({ nodeId: node.id }),
                input.toParentMessage,
              ),
            ),
          ],
          [config.renderNode(node, nodeTools, h)],
        ),
      ),
    );

    return h.div(
      [
        h.Class(classes.Pane),
        h.DataAttribute("paneid", config.paneId),
        h.Style({
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }),
        h.OnMount(
          Mount.mapMessage(
            MountPane({ paneId: config.paneId, viewport: model.viewport }),
            input.toParentMessage,
          ),
        ),
      ],
      [
        h.div(
          [
            h.Class(classes.Viewport),
            h.DataAttribute("fflow-viewport", ""),
            h.Style({
              position: "absolute",
              top: "0",
              left: "0",
              transformOrigin: "0 0",
              transform: transformOf(model.viewport),
            }),
          ],
          [edgesView, nodesView],
        ),
      ],
    );
  };

  return { view, dispose: () => {} };
};
