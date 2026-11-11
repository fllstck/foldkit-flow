import { Option } from "effect";

import type { HandleBounds, HandlePosition, HandleType } from "../model.js";
import { getHandleBounds } from "./adapter.js";

const positions: ReadonlyArray<HandlePosition> = [
  "Top",
  "Right",
  "Bottom",
  "Left",
];

/** `data-handlepos` is authored markup, not an engine value, so it is parsed
 *  against our own literals (case-insensitively, because an upstream-compatible
 *  consumer may write `left`). A missing attribute falls back to the handle
 *  type's conventional side; the alternative is dropping a measured handle
 *  because one attribute was absent. */
const parsePosition = (
  value: string | null | undefined,
  type: HandleType,
): HandlePosition =>
  positions.find(
    (position) => position.toLowerCase() === (value ?? "").toLowerCase(),
  ) ?? (type === "Source" ? "Right" : "Left");

/** `getHandleBounds` divides its offsets by the zoom in force at measure time and
 *  reads `offsetWidth`/`offsetHeight`, which CSS transforms do not affect. Both
 *  inputs scale with the transform, so the result is node-local and
 *  scale-invariant: one measurement per layout change, never one per zoom frame
 *  (§2.5.4). Deriving the scale from the element keeps Measurement independent of
 *  where the current zoom happens to live. */
const scaleOf = (element: HTMLElement, rect: DOMRect): number =>
  element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;

const readType = (
  type: HandleType,
  selector: "source" | "target",
  element: HTMLElement,
  nodeId: string,
  rect: DOMRect,
  scale: number,
): ReadonlyArray<HandleBounds> => {
  // SAFETY: the node Mount is only attached to the div the renderer builds, and
  // the engine's `getHandleBounds` only reads geometry off it.
  const node = element as HTMLDivElement;
  const measured = getHandleBounds(selector, node, rect, scale, nodeId);
  if (measured === null) return [];

  return measured.map((handle) => ({
    nodeId,
    handleId: Option.fromNullishOr(handle.id),
    type,
    // The engine types this field as its own `Position` enum but reads it
    // straight out of `data-handlepos`, so the runtime value is the authored
    // string.
    position: parsePosition(handle.position, type),
    x: handle.x,
    y: handle.y,
    width: handle.width,
    height: handle.height,
  }));
};

/** Both handle kinds for one node element. */
export const measureHandleBounds = (
  element: HTMLElement,
  nodeId: string,
): ReadonlyArray<HandleBounds> => {
  const rect = element.getBoundingClientRect();
  const scale = scaleOf(element, rect);
  return [
    ...readType("Source", "source", element, nodeId, rect, scale),
    ...readType("Target", "target", element, nodeId, rect, scale),
  ];
};

/** The node element inside a mounted pane, looked up by its data attribute. */
export const nodeElementOf = (
  paneElement: HTMLElement,
  nodeId: string,
): Option.Option<HTMLElement> =>
  Option.filter(
    Option.fromNullishOr(
      paneElement.querySelector(`[data-nodeid="${CSS.escape(nodeId)}"]`),
    ),
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
