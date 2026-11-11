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
import { hiddenIds, shownEdges, shownNodes } from "../geometry/hidden.js";
import { screenToFlow } from "../geometry/screen.js";
import {
  positionIndex,
  positionOf,
  withDescendants,
} from "../geometry/positions.js";
import {
  viewportRect,
  visibleEdges,
  visibleNodes,
} from "../geometry/visible.js";
import { Message } from "../message.js";
import { Gesture, rendererResizeControls, zeroDelta } from "../model.js";
import type {
  FlowEdge,
  FlowNode,
  HandlePosition,
  HandleRef,
  HandleType,
  Model,
  Point,
  Pointer,
  Size,
  SnapGrid,
} from "../model.js";
import {
  blocksDrag,
  isChromeTarget,
  isEdgeEndpointTarget,
  isHandleTarget,
  isNodeTarget,
} from "../runtime/domTarget.js";
import { MountNode } from "../runtime/mountNode.js";
import {
  MountPane,
  svgTransformOf,
  transformOf,
} from "../runtime/mountPane.js";
import { backgroundView } from "./background.js";
import type { BackgroundConfig } from "./background.js";
import * as classes from "./classes.js";
import { controlsView } from "./controls.js";
import type { FitViewConfig } from "./controls.js";
import { descriptionView } from "./description.js";
import { miniMapView } from "./minimap.js";
import { markerDefs, markerReference } from "./markers.js";
import { createNodeCache } from "./nodeCache.js";
import type { NodeCache } from "./nodeCache.js";
import { createViewMemo } from "./viewMemo.js";

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
  /** The box the flow is drawing for this node **right now**: the live resize
   *  while one runs, otherwise the node's declared `size` when `resize` is on.
   *  `undefined` means "sized by its content".
   *
   *  It is here because a resize has to be visible *during* the gesture, not on
   *  release: a node whose content does not fill the box the flow draws grows an
   *  invisible wrapper and appears to snap only when the parent persists the size
   *  (reported by hand after M4). The wrapper carries `data-boxed` as well, so a
   *  stylesheet can key on it without any markup change. */
  size: Size | undefined;
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
  /** The grid a drag or a resize snaps to, in flow units (§7 M4). It lives here
   *  rather than in the Model because nothing in `update` needs it outside a
   *  gesture: the renderer stamps it onto the press it produces, the gesture
   *  carries it, and the snap happens once per pointer event. Absent means no
   *  snapping, and no code path runs. */
  snapGrid?: SnapGrid;
  /** Eight grab handles per node, each reporting `StartedResize`. Off by
   *  default: it is eight extra press targets per node, and a parent that does
   *  not fold `OutMessage.ResizedNodes` has nothing to do with them (§7 M4).
   *  Turning it on also makes the flow draw each node's declared `size` as its
   *  box, which is how a persisted resize survives the next render. */
  resize?: boolean;
  /** Render only what the viewport can see, plus one screen of overscan. Off by
   *  default: culling trades a per-frame scan for unmount/remeasure churn at the
   *  edges of the viewport, so it is an explicit choice (§4.5). */
  cull?: boolean;
  /** Draw a reconnect grab ring around each edge end and dispatch
   *  `Message.StartedReconnect` when one is pressed. Off by default: it adds two
   *  hit-testable SVG elements per edge, and a parent that does not fold
   *  `OutMessage.ReconnectedEdge` has nothing to do with them. */
  reconnect?: boolean;
  /** The background pattern, drawn behind the viewport. Off by default: it is a
   *  visual identity choice, not a behaviour, and the benchmark pages measure the
   *  minimal DOM (§4.5). */
  background?: BackgroundConfig;
  /** Library-rendered zoom in/out/fit buttons. Off by default for the same
   *  reason: chrome a parent does not want in its DOM is a cost it should not
   *  pay (§7 M3). */
  controls?: boolean;
  /** What the `Controls` fit button fits with (§7 M4): padding, a per-fit zoom
   *  clamp, and a duration. Absent keeps M3's behaviour — no padding override,
   *  no clamp, an instant jump. A `nodes` filter is not offered here; a parent
   *  that wants "fit the selection" calls `Flow.fitViewport` from its own
   *  update. */
  fitView?: FitViewConfig;
  /** The minimap. Off by default and memoized when on: the 1k gate measures the
   *  frame distribution, and a per-frame rebuild of 1k rectangles would show up
   *  in it (§7 M3). */
  minimap?: boolean;
  /** A node's accessible name, which a screen reader reads in the tab order and
   *  the description region repeats. The flow cannot read `node.data` — the data
   *  is the parent's — so without this hook a node is announced by its id. */
  accessibleName?: (node: FlowNode<NodeData>) => string;
}>;

export type ViewInput<ParentMessage, NodeData, EdgeData> = Readonly<{
  model: Model;
  nodes: ReadonlyArray<FlowNode<NodeData>>;
  edges: ReadonlyArray<FlowEdge<EdgeData>>;
  /** Must be referentially stable across renders: every node slot compares it. */
  toParentMessage: (message: Message) => ParentMessage;
  /** Consumer chrome to render inside the pane, above the viewport — compose it
   *  with `panel(...)`. The markup stays in the parent's boundary (the same one
   *  `renderNode` runs in), so its controls dispatch parent Messages. */
  panel?: Html;
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

/** The node wrapper's box: always positioned, sized only when the flow draws a
 *  box for it (`resize` on, and either a declared size or a live gesture). */
type NodeStyle = Readonly<{
  position: "absolute";
  top: string;
  left: string;
  transform: string;
  width?: string;
  height?: string;
}>;

const nodeStyle = (position: Point, box: Size | undefined): NodeStyle => {
  const style: NodeStyle = {
    position: "absolute",
    top: "0",
    left: "0",
    transform: `translate(${position.x}px, ${position.y}px)`,
  };
  return box === undefined
    ? style
    : { ...style, width: `${box.width}px`, height: `${box.height}px` };
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

  // Chrome memos (§7 M3): the minimap's node rectangles and the description text
  // depend on the graph, not on the viewport, so a viewport frame reuses them.
  const minimapMemo = createViewMemo();
  const descriptionMemo = createViewMemo();

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
    box: Size | undefined,
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
        size: box,
      },
      h,
    );

  const resizeHandles = (
    nodeId: string,
    h: HtmlBuilder<any>,
    toParentMessage: (message: Message) => any,
  ): ReadonlyArray<Html> =>
    config.resize !== true
      ? []
      : rendererResizeControls.map((control) =>
          h.div(
            [
              // Chrome by §4.6's definition: `NoPan` keeps d3 from starting a
              // viewport pan, `NoDrag` keeps the node wrapper from arming a node
              // drag, and the pane's own handler declines the press because it is
              // inside a node. The handle below the pointer is the only thing
              // that reacts to it.
              h.Class(
                `${classes.ResizeHandle} ${classes.ResizeHandleOf(control)} ${classes.NoPan} ${classes.NoDrag}`,
              ),
              h.DataAttribute("resize", control),
              h.DataAttribute("nodeid", nodeId),
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
                          Message.StartedResize(
                            config.snapGrid === undefined
                              ? {
                                  nodeId,
                                  control,
                                  pointer: pointerOf(
                                    pointerId,
                                    pointerType,
                                    button,
                                  ),
                                }
                              : {
                                  nodeId,
                                  control,
                                  pointer: pointerOf(
                                    pointerId,
                                    pointerType,
                                    button,
                                  ),
                                  snapGrid: config.snapGrid,
                                },
                          ),
                        ),
                      )
                    : Option.none(),
              ),
            ],
            [],
          ),
        );

  /** The one accessible name for a node, shared by the tab order and the
   *  description region so they cannot disagree (§7 M3). */
  const accessibleNameOf = (node: FlowNode<NodeData>): string =>
    config.accessibleName === undefined ? node.id : config.accessibleName(node);

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

    // Absolute positions, resolved once per graph change (memoized on the nodes
    // array) and read by every position-derived thing below (§7 M4).
    const positions = positionIndex(input.nodes);
    const hidden = hiddenIds(input.nodes);
    // A drag moves the pressed nodes *and their subtrees*: a child is drawn at
    // its parent's absolute position, so it follows without being dragged.
    const movingIds = withDescendants(draggedIds, input.nodes);

    // A resize carries its own box: the shift during the gesture is
    // `current − start`, and the box itself is `current`. The transform needs the
    // shift for the node, and the edges attached to it need the same number
    // (§4.5's overlay rule, applied to a box instead of a delta).
    const resize = Gesture.guards.Resizing(gesture) ? gesture : undefined;
    const shiftById = new Map<string, Point>();
    movingIds.forEach((nodeId) => shiftById.set(nodeId, delta));
    if (resize !== undefined) {
      shiftById.set(resize.nodeId, {
        x: resize.current.left - resize.start.left,
        y: resize.current.top - resize.start.top,
      });
    }
    const shiftOf = (nodeId: string): Point =>
      shiftById.get(nodeId) ?? zeroDelta;

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

    const nodes = input.nodes.filter(
      (node) =>
        !hidden.has(node.id) &&
        (visibleNodeIds === undefined ||
          visibleNodeIds.has(node.id) ||
          movingIds.has(node.id)),
    );
    const edges = input.edges.filter(
      (edge) =>
        !hidden.has(edge.source) &&
        !hidden.has(edge.target) &&
        (visibleEdgeIds === undefined ||
          visibleEdgeIds.has(edge.id) ||
          movingIds.has(edge.source) ||
          movingIds.has(edge.target)),
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
                positions,
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
        edgeAnchor(model, node, ref.type, ref.handleId, positions),
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

    /**
     * The preview is geometry in flow space — the anchors and the pointer are both
     * flow points — but this layer is a sibling of `.fflow__viewport`, not a child
     * of it, so the transform has to be applied here. Without the `<g>` the line
     * is drawn at raw flow coordinates and lands wherever the viewport has been
     * panned or zoomed away from, which at the demo's `y: 200` is two hundred
     * pixels above the pointer (Playwright proof 32).
     *
     * `non-scaling-stroke` on `.fflow__edge-path` keeps the stroke 1.5px through
     * the scale, so the preview looks the same at every zoom, as the committed
     * edges do.
     */
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
          h.g(
            [h.Attribute("transform", svgTransformOf(model.viewport))],
            [
              h.path(
                [
                  h.Attribute("d", edgePath(kind, pathInput(source, target)).d),
                  h.Class(classes.EdgePath),
                ],
                [],
              ),
            ],
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

    /** The live drag offset for one edge end, or the anchor unchanged. */
    const shiftForDrag = (anchor: EdgeAnchor, nodeId: string): EdgeAnchor => {
      const shift = shiftOf(nodeId);
      return shift === zeroDelta
        ? anchor
        : { ...anchor, x: anchor.x + shift.x, y: anchor.y + shift.y };
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
      [
        ...markerDefs(edges, config.paneId, h),
        ...edges.flatMap((edge) => {
          const maybeEndpoints =
            endpointsByEdgeId.get(edge.id) ?? Option.none<EdgeEndpoints>();
          if (Option.isNone(maybeEndpoints)) return [];
          const base = maybeEndpoints.value;

          // A node being dragged is drawn at `position + delta`, and the parent's
          // positions are not touched until release (§4.5). An edge attached to it
          // has to follow the same overlay or it hangs behind the node for the
          // length of the gesture. Only the anchors of dragged nodes move, so the
          // memoized geometry above is still reused as-is.
          const endpoints: EdgeEndpoints = {
            source: shiftForDrag(base.source, edge.source),
            target: shiftForDrag(base.target, edge.target),
          };

          const geometry = edgePath(
            edge.type ?? "Bezier",
            pathInput(endpoints.source, endpoints.target),
          );

          // The label is drawn by the library with the consumer's markup when one
          // is configured, at the path's own label point. The halo is a stroke in
          // the pane's background colour (see `flow.css`), so a label needs no
          // measured box to be readable over the edge it sits on.
          const label =
            edge.label !== undefined
              ? [
                  h.text(
                    [
                      h.Attribute("x", String(geometry.labelX)),
                      h.Attribute("y", String(geometry.labelY)),
                      h.Attribute("text-anchor", "middle"),
                      h.Attribute("dominant-baseline", "middle"),
                      h.Class(classes.EdgeLabel),
                    ],
                    [
                      config.renderEdgeLabel === undefined
                        ? edge.label
                        : config.renderEdgeLabel(edge, h),
                    ],
                  ),
                ]
              : [];

          return [
            h.keyed("g")(
              edge.id,
              [h.Class(classes.Edge), h.DataAttribute("edgeid", edge.id)],
              [
                h.path([
                  h.Attribute("d", geometry.d),
                  h.Class(classes.EdgePath),
                  ...(edge.markerStart === undefined
                    ? []
                    : [
                        h.Attribute(
                          "marker-start",
                          markerReference(config.paneId, edge.markerStart),
                        ),
                      ]),
                  ...(edge.markerEnd === undefined
                    ? []
                    : [
                        h.Attribute(
                          "marker-end",
                          markerReference(config.paneId, edge.markerEnd),
                        ),
                      ]),
                ]),
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
      ],
    );

    const toFlowPoint = (clientX: number, clientY: number): Point =>
      screenToFlow(model, { screenX: clientX, screenY: clientY });

    const nodesView = h.div(
      [h.Class(classes.Nodes)],
      nodes.map((node) => {
        const isSelected = model.selectedNodeIds.includes(node.id);
        const isDragging = movingIds.has(node.id);
        const isResizing = resize !== undefined && resize.nodeId === node.id;
        const origin = positionOf(node, positions);
        const shift = shiftOf(node.id);
        const position =
          shift === zeroDelta
            ? origin
            : { x: origin.x + shift.x, y: origin.y + shift.y };
        // The box the flow draws: the live gesture while one runs, else the size
        // the parent gave the node. Without the second half a resize would snap
        // back the moment the parent's graph did not carry the box in markup.
        const box = isResizing
          ? { width: resize.current.width, height: resize.current.height }
          : config.resize === true
            ? node.size
            : undefined;

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
            // Present exactly while the flow draws the node's box, so a stylesheet
            // can stretch the content (`[data-boxed] > *` in the consumer's CSS) and
            // a proof can see that the box is live rather than committed.
            ...(box === undefined ? [] : [h.DataAttribute("boxed", "")]),
            // Focusable and named (§7 M3): a node is a toggle button in the
            // accessibility tree — pressing it selects it — so `aria-pressed`
            // says what the selection ring says, and `aria-label` comes from the
            // consumer's hook because `node.data` is theirs, not ours.
            h.Tabindex(0),
            h.Role("button"),
            h.AriaLabel(accessibleNameOf(node)),
            h.AriaPressed(isSelected ? "true" : "false"),
            h.Style(nodeStyle(position, box)),
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
                    Message.PressedNode(
                      config.snapGrid === undefined
                        ? {
                            nodeId: node.id,
                            point: toFlowPoint(clientX, clientY),
                            isAdditive: model.isAdditiveModifier,
                            pointer: pointerOf(pointerId, pointerType, button),
                          }
                        : {
                            nodeId: node.id,
                            point: toFlowPoint(clientX, clientY),
                            isAdditive: model.isAdditiveModifier,
                            pointer: pointerOf(pointerId, pointerType, button),
                            snapGrid: config.snapGrid,
                          },
                    ),
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
              // The box is a cache input because the content is told about it: a
              // resize frame is a new box, so the resized node's own slot is the
              // one that re-renders, and `tools.size` is never stale.
              box,
              h,
              input.toParentMessage,
              config.renderNode,
            ]),
            ...resizeHandles(node.id, h, input.toParentMessage),
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
              isEdgeEndpointTarget(target) ||
              // Chrome is a press target inside the pane: the buttons keep their
              // own Messages and the panel keeps the parent's, but none of them
              // may clear the selection (§4.6). `NoPan` on the same elements
              // keeps d3 from starting a pan from the same press.
              isChromeTarget(target)
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
            MountPane({
              paneId: config.paneId,
              viewport: model.viewport,
              minZoom: model.minZoom,
              maxZoom: model.maxZoom,
            }),
            input.toParentMessage,
          ),
        ),
      ],
      [
        config.background === undefined
          ? h.empty
          : backgroundView(config.background, model.viewport, h),
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
        config.controls === true
          ? controlsView(input.toParentMessage, h, config.fitView)
          : h.empty,
        config.minimap === true
          ? miniMapView(
              {
                model,
                nodes: shownNodes(input.nodes),
                nodeSizes: model.nodeSizes,
                view: viewportRect(model),
                toParentMessage: input.toParentMessage,
              },
              minimapMemo,
              h,
            )
          : h.empty,
        input.panel ?? h.empty,
        descriptionMemo.on(
          [input.nodes, input.edges, accessibleNameOf, config.paneId],
          () =>
            descriptionView(
              config.paneId,
              {
                nodes: shownNodes(input.nodes),
                // The same rule as the canvas: an edge into a collapsed subtree
                // is not described, so the description and the picture cannot
                // disagree (M4-REVIEW 3).
                edges: shownEdges(input.nodes, input.edges),
                accessibleName: accessibleNameOf,
              },
              h,
            ),
        ),
      ],
    );
  };

  return {
    view,
    /**
     * Every renderer-owned cache, not only the node slots. The docblock promises
     * "returns the renderer to its initial state", and a module-scope renderer (the
     * documented usage) keeps that state for the life of the page or, under SSR,
     * the life of the process: the node slots, the flattened handle index, the
     * memoized edge endpoints, and both chrome memos (implicit-state audit,
     * finding 1).
     */
    dispose: () => {
      cache.dispose();
      indexedBounds = undefined;
      handleIndex = new Map();
      geometryInputs = undefined;
      endpointsByEdgeId = new Map();
      minimapMemo.dispose();
      descriptionMemo.dispose();
    },
    cacheSize: () => cache.count(),
  };
};
