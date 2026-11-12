import { Option, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number });
export type Point = typeof Point.Type;

export const Size = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
});
export type Size = typeof Size.Type;

export const Rect = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  left: Schema.Number,
  top: Schema.Number,
});
export type Rect = typeof Rect.Type;

export const Viewport = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  zoom: Schema.Number,
});
export type Viewport = typeof Viewport.Type;

export const NodeSize = Schema.Struct({
  nodeId: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
});
export type NodeSize = typeof NodeSize.Type;

/** Grid a drag or a resize snaps to, in flow units (§7 M4). `{ x: 20, y: 20 }`
 *  means the moved box lands on multiples of twenty. It travels with the gesture
 *  rather than living in the Model: the drag is snapped per pointer event, and
 *  the grid is a property of the interaction the renderer configured, the same
 *  way `isAdditiveModifier` is stamped onto a press. */
export const SnapGrid = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});
export type SnapGrid = typeof SnapGrid.Type;

/** The eight controls a node is resized from (§7 M4). */
export const resizeControls = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
] as const;
export type ResizeControl = (typeof resizeControls)[number];
export const ResizeControl = Schema.Literals(resizeControls);

/** The controls the renderer draws: the four corners only.
 *
 *  The four edge midpoints are exactly where a port handle sits — this library's
 *  own stylesheet puts `.fflow__handle.source` at `right: 50%` and the target at
 *  `left: 50%` — so an edge resize control there swallows the press that starts a
 *  connection (Playwright proof 17 caught it: the gesture never left `Idle`).
 *  `geometry/resize.ts` still computes all eight, so a parent that draws its own
 *  edge handles gets the same arithmetic. */
export const rendererResizeControls = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
] as const satisfies ReadonlyArray<ResizeControl>;

export const HandlePosition = Schema.Literals([
  "Top",
  "Right",
  "Bottom",
  "Left",
]);
export type HandlePosition = typeof HandlePosition.Type;

export const HandleType = Schema.Literals(["Source", "Target"]);
export type HandleType = typeof HandleType.Type;

export const HandleRef = Schema.Struct({
  nodeId: Schema.String,
  handleId: Schema.Option(Schema.String),
  type: HandleType,
});
export type HandleRef = typeof HandleRef.Type;

/** Node-local, zoom-normalized handle geometry: measured once per handle change,
 *  then hit-tested and used for edge endpoints without touching the DOM. */
export const HandleBounds = Schema.Struct({
  nodeId: Schema.String,
  handleId: Schema.Option(Schema.String),
  type: HandleType,
  position: HandlePosition,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type HandleBounds = typeof HandleBounds.Type;

/** Identity of the pointer that owns the current gesture. Events carrying a
 *  different `pointerId` are ignored (§2.5.8). */
export const Pointer = Schema.Struct({
  pointerId: Schema.Number,
  pointerType: Schema.String,
  button: Schema.Number,
});
export type Pointer = typeof Pointer.Type;

export const Gesture = defineTaggedUnion({
  Idle: {},
  // No `Panning` variant: pan/zoom (including pinch) belongs to XYPanZoom, so a
  // viewport gesture never enters Flow's gesture state machine.
  DraggingNodes: {
    pointer: Pointer,
    nodeIds: Schema.Array(Schema.String),
    origin: Point,
    anchor: Point,
    snapGrid: Schema.Option(SnapGrid),
    delta: Point,
    hasMoved: Schema.Boolean,
  },
  Connecting: {
    pointer: Pointer,
    from: HandleRef,
    current: Point,
    maybeTarget: Schema.Option(HandleRef),
  },
  // Dragging one end of an existing edge onto another handle. `end` is the end
  // that moves; the other one stays anchored where the edge already drew it, so
  // the preview starts there. `edgeId` names a parent-owned edge — the flow
  // never stores the edge itself (§2.5.1).
  Reconnecting: {
    pointer: Pointer,
    edgeId: Schema.String,
    end: HandleType,
    current: Point,
    maybeTarget: Schema.Option(HandleRef),
  },
  // Growing or shrinking one node from one of its eight controls. Like a drag,
  // this is a pointer gesture with an owner pointer and a cancel path, so it
  // lives here rather than in the DOM: the renderer reports the press, `update`
  // runs `geometry/resize.ts` per pointer event, and the parent is told the box on
  // release. `start` is the absolute box the gesture began with, so no per-frame
  // read of the graph is needed.
  Resizing: {
    pointer: Pointer,
    nodeId: Schema.String,
    control: ResizeControl,
    start: Rect,
    current: Rect,
    snapGrid: Schema.Option(SnapGrid),
  },
  // Dragging inside the minimap (§7 M6). The minimap's own screen matrix is read
  // once, at press (`view/minimap.ts`), and the *flow point* it yields plus the
  // *scale* (flow units per screen pixel) travel in the gesture — so no frame of
  // the drag reads the DOM, and the pan is `viewportCentredOn(anchorFlow)` shifted
  // by the pointer's delta times that scale.
  MiniMapPanning: {
    pointer: Pointer,
    anchorScreen: Point,
    anchorFlow: Point,
    scale: Schema.Number,
  },
});
export type Gesture = typeof Gesture.Type;

export type FlowNode<Data = unknown> = Readonly<{
  id: string;
  type?: string | undefined;
  position: Point;
  data: Data;
  /** Size hint, used for edge paths before the node Mount has measured it. When
   *  `RendererConfig.resize` is on it is also the box the flow draws. */
  size?: Size | undefined;
  draggable?: boolean | undefined;
  selectable?: boolean | undefined;
  /** The node this one is positioned inside: `position` is relative to it (§7 M4). */
  parentId?: string | undefined;
  /** Collapsed: this node, its descendants, their edges and their measurement
   *  are all removed (§7 M4). `undefined` is "shown". */
  hidden?: boolean | undefined;
}>;

/** The arrowhead glyphs we draw. Ours by design, like the rest of the chrome
 *  (§2.4): a `<marker>` is a visual identity choice, not a ported component. */
export type MarkerEnd = "Arrow" | "ArrowClosed";

export type FlowEdge<Data = unknown> = Readonly<{
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | undefined;
  targetHandle?: string | undefined;
  type?: "Bezier" | "Straight" | "Step" | "SmoothStep" | undefined;
  /** Text at the path's label point. Rendered by the library; a configured
   *  `renderEdgeLabel` replaces the content, not the position (§7 M4). */
  label?: string | undefined;
  markerStart?: MarkerEnd | undefined;
  markerEnd?: MarkerEnd | undefined;
  data?: Data;
}>;

/** What the parent's `isValidConnection` predicate is asked about: the node and
 *  handle ids a connection would join, in the shape its own graph stores. */
export type Connection = Readonly<{
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}>;

/** What a resize policy is asked, per pointer event (§7 M7). `start` is the box
 *  the gesture began with, `next` the box this event proposes, and `modifier` is
 *  the Model's additive modifier — the same flag that holds the aspect ratio, so a
 *  policy can tell a plain resize from a proportional one. */
export type ResizeAttempt<NodeData = unknown> = Readonly<{
  node: FlowNode<NodeData>;
  start: Rect;
  next: Rect;
  modifier: boolean;
}>;

/** The graph arrives per dispatch; the flow Model never stores it (§2.5.1). */
export type Context<NodeData = unknown, EdgeData = unknown> = Readonly<{
  nodes: ReadonlyArray<FlowNode<NodeData>>;
  edges: ReadonlyArray<FlowEdge<EdgeData>>;
  /** Rejects a connection or a reconnect before it becomes an OutMessage (§7
   *  M2). Evaluated in `update` at release, against the graph the parent owns;
   *  absent means "accept everything". */
  isValidConnection?: (connection: Connection) => boolean;
  /** Rejects one resize frame (§7 M7). Asked per pointer event with the box the
   *  gesture began at and the box this event proposes; `false` keeps the **last
   *  accepted** box, so a gesture can leave a forbidden box without snapping back
   *  to where it started. A **veto only**: it cannot return a replacement box,
   *  because a predicate that can rewrite the box owns the gesture. Absent means
   *  "accept every frame"; a gesture the policy rejects from the first frame
   *  reports nothing on release, since its box never changed. */
  canResize?: (attempt: ResizeAttempt<NodeData>) => boolean;
}>;
export const Model = Schema.Struct({
  pane: Rect,
  // Identity of the mounted pane, set on `MountedPane`: subscriptions resolve the
  // pane's DOM root from it instead of hardcoding `document` (§2.5.8).
  paneId: Schema.Option(Schema.String),
  viewport: Viewport,
  // Zoom bounds live in the Model because three places need the same numbers:
  // `MountPane`'s args (the engine's `scaleExtent`), `setViewport`'s clamp, and
  // `fitViewport`. `RendererConfig.minZoom`/`maxZoom` were declared and never
  // read (§3.3), so they are gone rather than kept as a second source.
  minZoom: Schema.Number,
  maxZoom: Schema.Number,
  // Nodes and edges stay separate: one string array cannot say which kind an id
  // is, and `SelectedElements` / `DeletedElements` need that distinction.
  selectedNodeIds: Schema.Array(Schema.String),
  selectedEdgeIds: Schema.Array(Schema.String),
  nodeSizes: Schema.Array(NodeSize),
  handleBounds: Schema.Array(HandleBounds),
  gesture: Gesture,
  // True while a multi-select modifier (Shift, Meta, or Control) is held. It
  // lives in the Model because a press stamps it onto `PressedNode` /
  // `PressedPane`, and Foldkit's pointer attributes carry no modifier state.
  isAdditiveModifier: Schema.Boolean,
});
export type Model = typeof Model.Type;

export const defaultViewport: Viewport = { x: 0, y: 0, zoom: 1 };

/** The engine's bounds unless the parent says otherwise (§4.1). */
export const defaultMinZoom = 0.1;
export const defaultMaxZoom = 2;

export type ZoomLimits = Readonly<{ minZoom: number; maxZoom: number }>;

/** The one clamp: `setViewport`, `zoomBy`, and `fitViewport` all pass through it,
 *  and `XYPanZoom` enforces the same numbers from the same Model fields. */
export const clampZoom = (zoom: number, model: Model): number =>
  Math.min(Math.max(zoom, model.minZoom), model.maxZoom);

/** Shared zero delta: non-dragged nodes pass this exact reference to the node
 *  cache, so a drag frame only invalidates the dragged subtrees (§4.5). */
export const zeroDelta: Point = { x: 0, y: 0 };

export type Init = Readonly<{ model: Model }>;

export const init = (
  maybeViewport?: Viewport,
  maybeZoomLimits?: Partial<ZoomLimits>,
): Init => ({
  model: {
    pane: { width: 0, height: 0, left: 0, top: 0 },
    paneId: Option.none(),
    viewport: maybeViewport ?? defaultViewport,
    minZoom: maybeZoomLimits?.minZoom ?? defaultMinZoom,
    maxZoom: maybeZoomLimits?.maxZoom ?? defaultMaxZoom,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    nodeSizes: [],
    handleBounds: [],
    gesture: Gesture.Idle(),
    isAdditiveModifier: false,
  },
});
