import { Option, Schema } from "effect";

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
  paneId: Schema.Option(Schema.String),
  viewport: Viewport,
  nodeSizes: Schema.Array(NodeSize),
});
export type Model = typeof Model.Type;

export const defaultViewport: Viewport = { x: 0, y: 0, zoom: 1 };

export type Init = Readonly<{ model: Model }>;

export const init = (maybeViewport?: Viewport): Init => ({
  model: {
    pane: { width: 0, height: 0, left: 0, top: 0 },
    paneId: Option.none(),
    viewport: maybeViewport ?? defaultViewport,
    nodeSizes: [],
  },
});
