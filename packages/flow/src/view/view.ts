import { Option } from "effect";
import { Mount } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { edgePath } from "../geometry/paths.js";
import { screenToFlow } from "../geometry/screen.js";
import { visibleEdges, visibleNodes } from "../geometry/visible.js";
import { Message } from "../message.js";
import { Gesture, zeroDelta } from "../model.js";
import type {
  FlowEdge,
  FlowNode,
  HandlePosition,
  HandleRef,
  HandleType,
  Model,
  NodeSize,
  Point,
  Pointer,
  Size,
} from "../model.js";
import {
  blocksDrag,
  isHandleTarget,
  isNodeTarget,
} from "../runtime/domTarget.js";
import { MountNode } from "../runtime/mountNode.js";
import { MountPane, transformOf } from "../runtime/mountPane.js";
import * as classes from "./classes.js";
import { createNodeCache } from "./nodeCache.js";
import type { NodeCache } from "./nodeCache.js";

/** A handle declaration a node renderer hands back through `tools.handle`. The
 *  element carries the exact markup the engine's geometry reads:
 *  `.source`/`.target`, `data-handleid`, `data-handlepos`. */
export type HandleSpec = Readonly<{
  id?: string;
  type: HandleType;
  position: HandlePosition;
}>;

export type NodeTools = Readonly<{
  handle: (spec: HandleSpec) => Html;
  isSelected: boolean;
  isDragging: boolean;
}>;

export type RendererConfig<NodeData, EdgeData> = Readonly<{
  /** Stable across renders: this reference participates in each node's
   *  memoization identity, so rebuilding it per render silently disables the
   *  node cache (§3.3, §4.5). */
  renderNode: (
    node: FlowNode<NodeData>,
    tools: NodeTools,
    h: HtmlBuilder<any>,
  ) => Html;
  renderEdgeLabel?: (edge: FlowEdge<EdgeData>, h: HtmlBuilder<any>) => Html;
  /** Host-registry key (§2.5, §4.3). */
  paneId: string;
  /** Render only what the viewport can see, plus one screen of overscan. Off by
   *  default: culling trades a per-frame scan for unmount/remeasure churn at the
   *  edges of the viewport, so it is an explicit choice (§4.5). */
  cull?: boolean;
  minZoom?: number;
  maxZoom?: number;
}>;

export type ViewInput<ParentMessage, NodeData, EdgeData> = Readonly<{
  model: Model;
  nodes: ReadonlyArray<FlowNode<NodeData>>;
  edges: ReadonlyArray<FlowEdge<EdgeData>>;
  /** Must be referentially stable across renders: every node slot compares it. */
  toParentMessage: (message: Message) => ParentMessage;
}>;

export type Renderer<NodeData, EdgeData> = Readonly<{
  view: <ParentMessage>(
    input: ViewInput<ParentMessage, NodeData, EdgeData>,
    h: HtmlBuilder<ParentMessage>,
  ) => Html;
  /** Drops every cached VNode and returns the renderer to its initial state.
   *  Safe to keep rendering afterwards: the cache repopulates. Optional while a
   *  flow keeps rendering — the per-render sweep already bounds the cache — and
   *  recommended when a route or tab permanently unmounts a flow (§3.3). */
  dispose: () => void;
  /** Diagnostic: the number of live node slots. */
  cacheSize: () => number;
}>;

const sizeOf = (
  node: FlowNode<unknown>,
  nodeSizes: ReadonlyArray<NodeSize>,
): Size => {
  const measured = nodeSizes.find((size) => size.nodeId === node.id);
  if (measured !== undefined) {
    return { width: measured.width, height: measured.height };
  }
  if (node.size !== undefined) return node.size;
  return { width: 151, height: 40 };
};

const pointerOf = (
  pointerId: number,
  pointerType: string,
  button: number,
): Pointer => ({ pointerId, pointerType, button });

const isPrimaryButton = (button: number): boolean => button === 0;

export const createRenderer = <NodeData = unknown, EdgeData = unknown>(
  config: RendererConfig<NodeData, EdgeData>,
): Renderer<NodeData, EdgeData> => {
  const cache: NodeCache = createNodeCache();

  const handleHtml = (
    nodeId: string,
    spec: HandleSpec,
    h: HtmlBuilder<any>,
    toParentMessage: (message: Message) => any,
  ): Html =>
    h.div(
      [
        h.Class(
          `${classes.Handle} ${
            spec.type === "Source" ? classes.SourceHandle : classes.TargetHandle
          }`,
        ),
        h.DataAttribute("handleid", spec.id ?? ""),
        h.DataAttribute("handlepos", spec.position),
        h.DataAttribute("nodeid", nodeId),
        // A handle press starts a connection and nothing else: the node
        // wrapper's handler skips presses that land on a handle, so no
        // propagation stop is needed (§4.6).
        h.OnPointerDown(
          (
            pointerType,
            button,
            _screenX,
            _screenY,
            _timeStamp,
            _clientX,
            _clientY,
            pointerId,
          ) =>
            isPrimaryButton(button)
              ? Option.some(
                  toParentMessage(
                    Message.StartedConnection({
                      from: {
                        nodeId,
                        handleId: Option.fromNullishOr(spec.id),
                        type: spec.type,
                      },
                      pointer: pointerOf(pointerId, pointerType, button),
                    }),
                  ),
                )
              : Option.none(),
        ),
      ],
      [],
    );

  /**
   * The consumer's node markup for one cache slot. Everything that changes per
   * frame — the position transform, the selection and drag classes — lives on
   * the wrapper the renderer rebuilds every pass, so neither a drag frame nor a
   * pan frame invalidates a slot.
   */
  const buildNodeContent = (
    node: FlowNode<NodeData>,
    isSelected: boolean,
    isDragging: boolean,
    h: HtmlBuilder<any>,
    toParentMessage: (message: Message) => any,
    renderNode: RendererConfig<NodeData, EdgeData>["renderNode"],
  ): Html =>
    renderNode(
      node,
      {
        handle: (spec) => handleHtml(node.id, spec, h, toParentMessage),
        isSelected,
        isDragging,
      },
      h,
    );

  const view = <ParentMessage>(
    input: ViewInput<ParentMessage, NodeData, EdgeData>,
    h: HtmlBuilder<ParentMessage>,
  ): Html => {
    const { model } = input;
    const isCulling =
      config.cull === true && model.pane.width > 0 && model.pane.height > 0;

    const nodes = isCulling ? visibleNodes(model, input.nodes) : input.nodes;
    const edges = isCulling
      ? visibleEdges(model, input.edges, input.nodes)
      : input.edges;

    const nodesById = new Map(
      input.nodes.map((node) => [node.id, node] as const),
    );

    const positionOf = (nodeId: string): Point =>
      nodesById.get(nodeId)?.position ?? { x: 0, y: 0 };

    const handleCenter = (ref: HandleRef): Point => {
      const bounds = model.handleBounds.find(
        (entry) => entry.nodeId === ref.nodeId && entry.type === ref.type,
      );
      if (bounds === undefined) return positionOf(ref.nodeId);
      return {
        x: positionOf(ref.nodeId).x + bounds.x + bounds.width / 2,
        y: positionOf(ref.nodeId).y + bounds.y + bounds.height / 2,
      };
    };

    const edgeEndpoints = (edge: FlowEdge<EdgeData>) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      if (source === undefined || target === undefined) return undefined;

      const sourceSize = sizeOf(source, model.nodeSizes);
      const targetSize = sizeOf(target, model.nodeSizes);
      return {
        sourceX: source.position.x + sourceSize.width / 2,
        sourceY: source.position.y + sourceSize.height,
        targetX: target.position.x + targetSize.width / 2,
        targetY: target.position.y,
      };
    };

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
        const endpoints = edgeEndpoints(edge);
        if (endpoints === undefined) return [];

        const geometry = edgePath(edge.type ?? "Bezier", {
          ...endpoints,
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

    const gesture = model.gesture;
    const draggedIds = Gesture.guards.DraggingNodes(gesture)
      ? gesture.nodeIds
      : [];
    const delta = Gesture.guards.DraggingNodes(gesture)
      ? gesture.delta
      : zeroDelta;

    const toFlowPoint = (clientX: number, clientY: number): Point =>
      screenToFlow(model, { screenX: clientX, screenY: clientY });

    const nodesView = h.div(
      [h.Class(classes.Nodes)],
      nodes.map((node) => {
        const isSelected = model.selectedNodeIds.includes(node.id);
        const isDragging = draggedIds.includes(node.id);
        const position = isDragging
          ? { x: node.position.x + delta.x, y: node.position.y + delta.y }
          : node.position;

        return h.keyed("div")(
          node.id,
          [
            h.Class(
              [
                classes.Node,
                isSelected ? classes.IsSelected : "",
                isDragging ? classes.IsDragging : "",
              ]
                .filter((name) => name !== "")
                .join(" "),
            ),
            h.DataAttribute("nodeid", node.id),
            h.Style({
              position: "absolute",
              top: "0",
              left: "0",
              transform: `translate(${position.x}px, ${position.y}px)`,
            }),
            h.OnPointerDown(
              (
                pointerType,
                button,
                _screenX,
                _screenY,
                _timeStamp,
                clientX,
                clientY,
                pointerId,
                target,
              ) => {
                // §4.6: a control or an explicit `.fflow__nodrag` region inside
                // the node keeps its own behavior, and a handle press starts a
                // connection instead of a drag.
                if (!isPrimaryButton(button)) return Option.none();
                if (isHandleTarget(target) || blocksDrag(target)) {
                  return Option.none();
                }
                return Option.some(
                  input.toParentMessage(
                    Message.PressedNode({
                      nodeId: node.id,
                      point: toFlowPoint(clientX, clientY),
                      isAdditive: false,
                      pointer: pointerOf(pointerId, pointerType, button),
                    }),
                  ),
                );
              },
            ),
            h.OnMount(
              Mount.mapMessage(
                MountNode({ nodeId: node.id }),
                input.toParentMessage,
              ),
            ),
          ],
          [
            cache.render(node.id, buildNodeContent, [
              node,
              isSelected,
              isDragging,
              h,
              input.toParentMessage,
              config.renderNode,
            ]),
          ],
        );
      }),
    );

    cache.sweep(nodes.map((node) => node.id));

    const connectionView = Gesture.guards.Connecting(gesture)
      ? (() => {
          const from = handleCenter(gesture.from);
          const end = Option.getOrElse(
            Option.map(gesture.maybeTarget, handleCenter),
            () => gesture.current,
          );
          return h.svg(
            [
              h.Class(classes.Connection),
              h.Attribute("width", "100%"),
              h.Attribute("height", "100%"),
              h.Style({
                position: "absolute",
                top: "0",
                left: "0",
                overflow: "visible",
                pointerEvents: "none",
              }),
              h.Attribute("aria-hidden", "true"),
            ],
            [
              h.path(
                [
                  h.Attribute("d", `M${from.x},${from.y} L${end.x},${end.y}`),
                  h.Class(classes.EdgePath),
                ],
                [],
              ),
            ],
          );
        })()
      : h.empty;

    return h.div(
      [
        h.Class(classes.Pane),
        h.DataAttribute("paneid", config.paneId),
        h.DataAttribute("node-count", String(nodes.length)),
        h.Style({
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }),
        h.OnPointerDown(
          (
            pointerType,
            button,
            _screenX,
            _screenY,
            _timeStamp,
            clientX,
            clientY,
            pointerId,
            target,
          ) => {
            // A press inside a node already produced `PressedNode`; a press
            // inside a handle or a node control must add nothing. Panning is the
            // engine's gesture, so a pane press only clears the selection.
            if (!isPrimaryButton(button)) return Option.none();
            if (
              blocksDrag(target) ||
              isHandleTarget(target) ||
              isNodeTarget(target)
            ) {
              return Option.none();
            }
            return Option.some(
              input.toParentMessage(
                Message.PressedPane({
                  point: toFlowPoint(clientX, clientY),
                  isAdditive: false,
                  pointer: pointerOf(pointerId, pointerType, button),
                }),
              ),
            );
          },
        ),
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
        connectionView,
      ],
    );
  };

  return {
    view,
    dispose: () => cache.dispose(),
    cacheSize: () => cache.count(),
  };
};
