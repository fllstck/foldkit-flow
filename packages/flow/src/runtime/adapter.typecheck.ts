/**
 * Compile-time negative tests for the adapter. Every `@ts-expect-error` below
 * fails the build if the pinned engine ever starts accepting the call: the
 * design's assumptions are checked, not just documented.
 */
import type { OnPanZoom, PanZoomInstance, Viewport } from "./adapter.js";
import { getBezierPath, getHandleBounds } from "./adapter.js";

// @ts-expect-error a viewport-first callback is not `OnPanZoom(event, viewport)`
const _viewportFirst: OnPanZoom = (_viewport: Viewport) => {};

declare const panZoom: PanZoomInstance;
declare const nodeElement: HTMLDivElement;
declare const nodeBounds: DOMRect;

export const checks = () => {
  // @ts-expect-error `setViewport` takes an options object, never a bare duration
  void panZoom.setViewport({ x: 0, y: 0, zoom: 1 }, 300);

  // @ts-expect-error `syncViewport(viewport)` takes no options
  panZoom.syncViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 });

  // @ts-expect-error handle type is narrowed to 'source' | 'target'
  getHandleBounds("both", nodeElement, nodeBounds, 1, "node-a");

  const path = getBezierPath({
    sourceX: 0,
    sourceY: 0,
    targetX: 1,
    targetY: 1,
  });
  // @ts-expect-error the path helper returns a five-element tuple
  const _sixth: number = path[5];

  return [_viewportFirst, _sixth];
};
