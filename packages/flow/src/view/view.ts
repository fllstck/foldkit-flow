import { Option } from "effect";
import { Mount } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { edgePath } from "../geometry/paths.js";
import type { EdgePathInput, EdgePathKind } from "../geometry/paths.js";
import {
  edgeAnchor,
  indexHandles,
  indexedEdgeEndpoints,
  pointerHandlePosition,
} from "../geometry/handles.js";
import type {
  EdgeAnchor,
  EdgeEndpoints,
  HandleBoundsByNode,
} from "../geometry/handles.js";
import { oppositeHandleType } from "../geometry/hitTest.js";
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
  Point,
  Pointer,
} from "../model.js";
import {
  blocksDrag,
  isEdgeEndpointTarget,
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
  /** Draw a reconnect grab ring around each edge end and dispatch
   *  `Message.StartedReconnect` when one is pressed. Off by default: it adds two
   *  hit-testable SVG elements per edge, and a parent that does not fold
   *  `OutMessage.ReconnectedEdge` has nothing to do with them. */
  reconnect?: boolean;
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

  // Measured bounds grouped by node, rebuilt only when the Model's bounds array
  // is replaced (measurement replaces it; a pan or a drag frame does not). The
  // renderer owns its caches already (§3.3), and this one keeps a viewport frame
  // off a scan of every measured bound — twice per edge (§4.5).
  let indexedBounds: Model["handleBounds"] | undefined;
  let handleIndex: HandleBoundsByNode = new Map();

  // Edge endpoints, memoized on the four inputs they read. A viewport frame
  // changes none of them — the transform lives on the wrapper — so panning and
  // dragging reuse the geometry instead of re-deriving every edge, twice per
  // edge, once per frame (§4.5).
  let geometryInputs: ReadonlyArray<unknown> | undefined;
  let endpointsByEdgeId: ReadonlyMap<
    string,
    Option.Option<EdgeEndpoints>
  > = new Map();

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
    const gesture = model.gesture;
    const draggedIds = new Set(
      Gesture.guards.DraggingNodes(gesture) ? gesture.nodeIds : [],
    );
    const delta = Gesture.guards.DraggingNodes(gesture)
      ? gesture.delta
      : zeroDelta;

    if (indexedBounds !== model.handleBounds) {
      indexedBounds = model.handleBounds;
      handleIndex = indexHandles(model.handleBounds);
    }

    const isCulling =
      config.cull === true && model.pane.width > 0 && model.pane.height > 0;

    // Culling is derived from the graph position, but a dragged node is rendered
    // at `position + delta`: a node dragged past the overscan would vanish from
    // under the pointer that owns the gesture. Active drags (and the edges they
    // carry) stay rendered for the length of the gesture.
    const visibleNodeIds: ReadonlySet<string> | undefined = isCulling
      ? new Set(visibleNodes(model, input.nodes).map((node) => node.id))
      : undefined;
    const visibleEdgeIds: ReadonlySet<string> | undefined = isCulling
      ? new Set(
          visibleEdges(model, input.edges, input.nodes).map((edge) => edge.id),
        )
      : undefined;

    const nodes =
      visibleNodeIds === undefined
        ? input.nodes
        : input.nodes.filter(
            (node) => visibleNodeIds.has(node.id) || draggedIds.has(node.id),
          );
    const edges =
      visibleEdgeIds === undefined
        ? input.edges
        : input.edges.filter(
            (edge) =>
              visibleEdgeIds.has(edge.id) ||
              draggedIds.has(edge.source) ||
              draggedIds.has(edge.target),
          );

    const nodesById = new Map(
      input.nodes.map((node) => [node.id, node] as const),
    );

    const nextGeometryInputs = [
      model.handleBounds,
      model.nodeSizes,
      input.nodes,
      input.edges,
    ];
    if (
      geometryInputs === undefined ||
      nextGeometryInputs.some(
        (value, index) => value !== geometryInputs?.[index],
      )
    ) {
      geometryInputs = nextGeometryInputs;
      endpointsByEdgeId = new Map(
        input.edges.map(
          (edge) =>
            [
              edge.id,
              indexedEdgeEndpoints(
                model.nodeSizes,
                handleIndex,
                nodesById,
                edge,
              ),
            ] as const,
        ),
      );
    }

    const pathInput = (
      source: EdgeAnchor,
      target: EdgeAnchor,
    ): EdgePathInput => ({
      sourceX: source.x,
      sourceY: source.y,
      sourcePosition: source.position,
      targetX: target.x,
      targetY: target.y,
      targetPosition: target.position,
    });

    const anchorOf = (ref: HandleRef): Option.Option<EdgeAnchor> =>
      Option.map(Option.fromNullishOr(nodesById.get(ref.nodeId)), (node) =>
        edgeAnchor(model, node, ref.type, ref.handleId),
      );

    /** Where a preview's free end is: the hovered handle's own anchor, or the
     *  pointer (entered from the side it approaches). */
    const freeEnd = (
      start: EdgeAnchor,
      maybeTarget: Option.Option<HandleRef>,
      current: Point,
    ): EdgeAnchor =>
      Option.getOrElse(Option.flatMap(maybeTarget, anchorOf), () => ({
        ...current,
        position: pointerHandlePosition(start, current),
      }));

    const connectionLine = (
      kind: EdgePathKind,
      source: EdgeAnchor,
      target: EdgeAnchor,
      h: HtmlBuilder<any>,
    ): Html =>
      h.svg(
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
              h.Attribute("d", edgePath(kind, pathInput(source, target)).d),
              h.Class(classes.EdgePath),
            ],
            [],
          ),
        ],
      );

    /** Reconnect grab handle for one edge end. It reconnects that end and
     *  nothing else: the pane handler declines `[data-edgeend]`, and `NoPan`
     *  keeps d3 from starting a viewport pan from the same press (§4.6). */
    const edgeEndpoint = (
      edgeId: string,
      end: HandleType,
      anchor: EdgeAnchor,
      h: HtmlBuilder<any>,
    ): Html =>
      h.circle(
        [
          h.Class(`${classes.EdgeEndpoint} ${classes.NoPan}`),
          h.Attribute("cx", String(anchor.x)),
          h.Attribute("cy", String(anchor.y)),
          // An annulus, not a dot: the handle at its centre keeps starting a
          // new connection, and the ring around it grabs the existing edge.
          h.Attribute("r", "10"),
          h.DataAttribute("edgeid", edgeId),
          h.DataAttribute("edgeend", end),
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
                    input.toParentMessage(
                      Message.StartedReconnect({
                        edgeId,
                        end,
                        pointer: pointerOf(pointerId, pointerType, button),
                      }),
                    ),
                  )
                : Option.none(),
          ),
        ],
        [],
      );

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
        const maybeEndpoints =
          endpointsByEdgeId.get(edge.id) ?? Option.none<EdgeEndpoints>();
        if (Option.isNone(maybeEndpoints)) return [];
        const endpoints = maybeEndpoints.value;

        const geometry = edgePath(
          edge.type ?? "Bezier",
          pathInput(endpoints.source, endpoints.target),
        );

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
              ...(config.reconnect === true
                ? [
                    edgeEndpoint(edge.id, "Source", endpoints.source, h),
                    edgeEndpoint(edge.id, "Target", endpoints.target, h),
                  ]
                : []),
            ],
          ),
        ];
      }),
    );

    const toFlowPoint = (clientX: number, clientY: number): Point =>
      screenToFlow(model, { screenX: clientX, screenY: clientY });

    const nodesView = h.div(
      [h.Class(classes.Nodes)],
      nodes.map((node) => {
        const isSelected = model.selectedNodeIds.includes(node.id);
        const isDragging = draggedIds.has(node.id);
        const position = isDragging
          ? { x: node.position.x + delta.x, y: node.position.y + delta.y }
          : node.position;

        return h.keyed("div")(
          node.id,
          [
            h.Class(
              [
                classes.Node,
                // The pane's d3 filter checks `noPanClassName` with
                // `target.closest`, so this exempts the node and everything
                // inside it (handles, controls). Without it a node press also
                // starts a pane pan and the viewport travels with the node.
                classes.NoPan,
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
                      isAdditive: model.isAdditiveModifier,
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

    const connectionView = ((): Html => {
      if (Gesture.guards.Connecting(gesture)) {
        return Option.match(anchorOf(gesture.from), {
          onNone: () => h.empty,
          onSome: (start) =>
            connectionLine(
              "Bezier",
              start,
              freeEnd(start, gesture.maybeTarget, gesture.current),
              h,
            ),
        });
      }

      if (Gesture.guards.Reconnecting(gesture)) {
        // The end that is not moving anchors the preview: the parent owns the
        // edge, so it is read from `input.edges`, not from the Model (§2.5.1).
        const edge = input.edges.find((entry) => entry.id === gesture.edgeId);
        if (edge === undefined) return h.empty;

        const stationaryType = oppositeHandleType(gesture.end);
        const stationary: HandleRef = {
          nodeId: stationaryType === "Source" ? edge.source : edge.target,
          handleId: Option.fromNullishOr(
            stationaryType === "Source" ? edge.sourceHandle : edge.targetHandle,
          ),
          type: stationaryType,
        };

        return Option.match(anchorOf(stationary), {
          onNone: () => h.empty,
          onSome: (start) =>
            connectionLine(
              "Bezier",
              start,
              freeEnd(start, gesture.maybeTarget, gesture.current),
              h,
            ),
        });
      }

      return h.empty;
    })();

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
              isNodeTarget(target) ||
              isEdgeEndpointTarget(target)
            ) {
              return Option.none();
            }
            return Option.some(
              input.toParentMessage(
                Message.PressedPane({
                  point: toFlowPoint(clientX, clientY),
                  isAdditive: model.isAdditiveModifier,
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
