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
}>;

export type FlowEdge<Data = unknown> = Readonly<{
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: "Bezier" | "Straight" | "Step" | "SmoothStep";
  label?: string;
  data?: Data;
}>;

/** The graph arrives per dispatch; the flow Model never stores it (§2.5.1). */
export type Context<NodeData = unknown, EdgeData = unknown> = Readonly<{
  nodes: ReadonlyArray<FlowNode<NodeData>>;
  edges: ReadonlyArray<FlowEdge<EdgeData>>;
}>;

export const Model = Schema.Struct({
  pane: Rect,
  // Identity of the mounted pane, set on `MountedPane`: subscriptions resolve the
  // pane's DOM root from it instead of hardcoding `document` (§2.5.8).
  paneId: Schema.Option(Schema.String),
  viewport: Viewport,
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

/** Shared zero delta: non-dragged nodes pass this exact reference to the node
 *  cache, so a drag frame only invalidates the dragged subtrees (§4.5). */
export const zeroDelta: Point = { x: 0, y: 0 };

export type Init = Readonly<{ model: Model }>;

export const init = (maybeViewport?: Viewport): Init => ({
  model: {
    pane: { width: 0, height: 0, left: 0, top: 0 },
    paneId: Option.none(),
    viewport: maybeViewport ?? defaultViewport,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    nodeSizes: [],
    handleBounds: [],
    gesture: Gesture.Idle(),
    isAdditiveModifier: false,
  },
});
