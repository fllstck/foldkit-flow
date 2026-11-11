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
});
export type Gesture = typeof Gesture.Type;

export type FlowNode<Data = unknown> = Readonly<{
  id: string;
  type?: string;
  position: Point;
  data: Data;
  /** Size hint, used for edge paths before the node Mount has measured it. */
  size?: Size;
  draggable?: boolean;
  selectable?: boolean;
  parentId?: string;
  hidden?: boolean;
}>;

/** The arrowhead glyphs we draw. Ours by design, like the rest of the chrome
 *  (§2.4): a `<marker>` is a visual identity choice, not a ported component. */
export type MarkerEnd = "Arrow" | "ArrowClosed";

export type FlowEdge<Data = unknown> = Readonly<{
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: "Bezier" | "Straight" | "Step" | "SmoothStep";
  label?: string;
  markerStart?: MarkerEnd;
  markerEnd?: MarkerEnd;
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

/** The graph arrives per dispatch; the flow Model never stores it (§2.5.1). */
export type Context<NodeData = unknown, EdgeData = unknown> = Readonly<{
  nodes: ReadonlyArray<FlowNode<NodeData>>;
  edges: ReadonlyArray<FlowEdge<EdgeData>>;
  /** Rejects a connection or a reconnect before it becomes an OutMessage (§7
   *  M2). Evaluated in `update` at release, against the graph the parent owns;
   *  absent means "accept everything". */
  isValidConnection?: (connection: Connection) => boolean;
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
