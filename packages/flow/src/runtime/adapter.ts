import {
  XYPanZoom as upstreamXYPanZoom,
  getBezierPath as upstreamGetBezierPath,
  getHandleBounds as upstreamGetHandleBounds,
  getSmoothStepPath as upstreamGetSmoothStepPath,
  getStraightPath as upstreamGetStraightPath,
  getViewportForBounds as upstreamGetViewportForBounds,
  infiniteExtent as upstreamInfiniteExtent,
  PanOnScrollMode as UpstreamPanOnScrollMode,
  Position as UpstreamPosition,
  snapPosition as upstreamSnapPosition,
} from "@xyflow/system";

import type { HandlePosition } from "../model.js";

/**
 * The only module that imports `@xyflow/system`.
 *
 * Everything below is an assignment, not a re-export: if the pinned engine moves
 * a parameter, flips the `(event, viewport)` callback order, or changes an
 * option object, that assignment becomes a type error here. The design depends
 * on these signatures; a runtime surprise is not an acceptable way to find out.
 */

export type Upstream = typeof import("@xyflow/system");

/** `OnPanZoom = (event, viewport) => void` for all three callbacks. Event first. */
export type OnPanZoom = (
  event: MouseEvent | TouchEvent | null,
  viewport: Viewport,
) => void;

export type OnDraggingChange = (dragging: boolean) => void;

export type Viewport = Readonly<{ x: number; y: number; zoom: number }>;

export type CoordinateExtent = [[number, number], [number, number]];

/** The subset of `PanZoomParams` the Mount supplies, with the callback order
 *  stated locally. Assigning `upstreamXYPanZoom` to this signature is the check. */
export type PanZoomParams = Readonly<{
  domNode: Element;
  minZoom: number;
  maxZoom: number;
  viewport: Viewport;
  translateExtent: CoordinateExtent;
  onDraggingChange: OnDraggingChange;
  onPanZoomStart?: OnPanZoom;
  onPanZoom?: OnPanZoom;
  onPanZoomEnd?: OnPanZoom;
}>;

export type PanZoomTransformOptions = Readonly<{
  duration?: number;
  ease?: (t: number) => number;
  interpolate?: "smooth" | "linear";
}>;

export type ZoomTransformLike = Readonly<{
  x: number;
  y: number;
  k: number;
}>;

export type PanZoomInstance = Readonly<{
  getViewport: () => Viewport;
  setViewport: (
    viewport: Viewport,
    options?: PanZoomTransformOptions,
  ) => Promise<ZoomTransformLike | undefined>;
  setViewportConstrained: (
    viewport: Viewport,
    extent: CoordinateExtent,
    translateExtent: CoordinateExtent,
  ) => Promise<ZoomTransformLike | undefined>;
  syncViewport: (viewport: Viewport) => void;
  update: (params: PanZoomUpdate) => void;
  destroy: () => void;
}>;

/** `update(...)` is the call that wires d3's gesture handlers. The plan's M0
 *  sketch omitted it; without it no engine callback is ever registered. */
export type PanZoomUpdate = Readonly<{
  noWheelClassName: string;
  noPanClassName: string;
  onPaneContextMenu?: (event: MouseEvent) => void;
  preventScrolling: boolean;
  panActivationKeyPressed?: boolean;
  panOnScroll: boolean;
  panOnDrag: boolean | number[];
  panOnScrollMode: UpstreamPanOnScrollMode;
  panOnScrollSpeed: number;
  userSelectionActive: boolean;
  zoomOnPinch: boolean;
  zoomOnScroll: boolean;
  zoomOnDoubleClick: boolean;
  zoomActivationKeyPressed: boolean;
  lib: string;
  onTransformChange: (transform: [number, number, number]) => void;
  connectionInProgress: boolean;
  paneClickDistance: number;
  selectionOnDrag?: boolean;
}>;

export const createPanZoom: (params: PanZoomParams) => PanZoomInstance =
  upstreamXYPanZoom;

export const panOnScrollModeFree: UpstreamPanOnScrollMode =
  UpstreamPanOnScrollMode.Free;

export const infiniteExtent: CoordinateExtent = upstreamInfiniteExtent;

export type RawHandle = Readonly<{
  id?: string | null;
  nodeId: string;
  x: number;
  y: number;
  position: UpstreamPosition;
  type: "source" | "target";
  width: number;
  height: number;
}>;

export type MeasureHandleBounds = (
  type: "source" | "target",
  nodeElement: HTMLDivElement,
  nodeBounds: DOMRect,
  zoom: number,
  nodeId: string,
) => ReadonlyArray<RawHandle> | null;

export const getHandleBounds: MeasureHandleBounds = upstreamGetHandleBounds;

export type GetBezierPath = typeof upstreamGetBezierPath;
export type GetSmoothStepPath = typeof upstreamGetSmoothStepPath;
export type GetStraightPath = typeof upstreamGetStraightPath;
export type GetViewportForBounds = typeof upstreamGetViewportForBounds;

export const getBezierPath: GetBezierPath = upstreamGetBezierPath;
export const getSmoothStepPath: GetSmoothStepPath = upstreamGetSmoothStepPath;
export const getStraightPath: GetStraightPath = upstreamGetStraightPath;
export const getViewportForBounds: GetViewportForBounds =
  upstreamGetViewportForBounds;

/** `snapPosition(position, snapGrid)` rounds each axis to the nearest multiple of
 *  the grid; the tuple is the engine's shape, so the Model's `{ x, y }` grid is
 *  widened here and nowhere else. */
export type SnapPosition = (
  position: Readonly<{ x: number; y: number }>,
  snapGrid?: [number, number],
) => Readonly<{ x: number; y: number }>;

export const snapPosition: SnapPosition = upstreamSnapPosition;

export const toUpstreamPosition = (
  position: HandlePosition,
): UpstreamPosition => UpstreamPosition[position];

const handlePositionByUpstream: Record<UpstreamPosition, HandlePosition> = {
  [UpstreamPosition.Top]: "Top",
  [UpstreamPosition.Right]: "Right",
  [UpstreamPosition.Bottom]: "Bottom",
  [UpstreamPosition.Left]: "Left",
};

export const fromUpstreamPosition = (
  position: UpstreamPosition,
): HandlePosition => handlePositionByUpstream[position];
