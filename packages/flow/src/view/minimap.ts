import { Array as Arr } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { nodeBounds, nodeRect } from "../geometry/bounds.js";
import type { FlowNode, Model, NodeSize, Rect } from "../model.js";
import * as classes from "./classes.js";
import type { ViewMemo } from "./viewMemo.js";

/** Fraction of the graph's own size left around it inside the minimap box. */
export const minimapPadding = 0.05;

/** The `viewBox` the minimap draws the graph in: the nodes' bounding box, padded,
 *  with a 1×1 floor so an empty graph still renders a legal viewBox. */
export const miniMapViewBox = (
  model: Model,
  nodes: ReadonlyArray<FlowNode<unknown>>,
): string => {
  if (Arr.isReadonlyArrayEmpty(nodes)) return "0 0 1 1";

  const bounds = nodeBounds(model, nodes);
  const padX = Math.max(bounds.width * minimapPadding, 1);
  const padY = Math.max(bounds.height * minimapPadding, 1);
  return `${bounds.left - padX} ${bounds.top - padY} ${bounds.width + padX * 2} ${bounds.height + padY * 2}`;
};

/**
 * The node rectangles as one `<g>`, memoized on `nodes` and `nodeSizes` (§7 M3).
 *
 * A minimap is only useful if it shows the whole graph, so it draws every node —
 * culled or not — which is exactly why it is opt-in and memoized: at 1k nodes
 * this is 1k `<rect>`s, and rebuilding them per viewport frame would be a
 * measurable cost for a layer whose content does not change while panning.
 */
const minimapNodes = (
  model: Model,
  nodes: ReadonlyArray<FlowNode<unknown>>,
  h: HtmlBuilder<any>,
): Html =>
  h.g(
    [h.Class(classes.MiniMapNodes)],
    nodes.map((node) => {
      const rect = nodeRect(node, model.nodeSizes);
      return h.keyed("rect")(
        node.id,
        [
          h.Class(classes.MiniMapNode),
          h.DataAttribute("nodeid", node.id),
          h.Attribute("x", String(rect.left)),
          h.Attribute("y", String(rect.top)),
          h.Attribute("width", String(rect.width)),
          h.Attribute("height", String(rect.height)),
          h.Attribute("rx", "2"),
        ],
        [],
      );
    }),
  );

export type MiniMapInput = Readonly<{
  model: Model;
  nodes: ReadonlyArray<FlowNode<unknown>>;
  nodeSizes: ReadonlyArray<NodeSize>;
  /** The pane rectangle in flow space — `viewportRect`, not `visibleRegion`:
   *  culling's overscan is not a fact about what the user can see. */
  view: Rect;
}>;

/**
 * Display-only in M3 (§7 M3): click-to-centre and drag-to-pan are a new gesture
 * surface with their own pointer identity, so they are named as M4 rather than
 * half-built here.
 *
 * `aria-hidden` because this is a picture of what the description region already
 * says in words; announcing 1k rectangles to a screen reader is worse than
 * saying nothing.
 */
export const miniMapView = (
  input: MiniMapInput,
  memo: ViewMemo,
  h: HtmlBuilder<any>,
): Html => {
  const { model, nodes, view } = input;

  return h.div(
    [
      h.Class(`${classes.MiniMap} ${classes.NoPan}`),
      h.DataAttribute(classes.ChromeAttribute, ""),
      h.DataAttribute("fflow-minimap", ""),
      h.Attribute("aria-hidden", "true"),
    ],
    [
      h.svg(
        [
          h.Class(classes.MiniMapSvg),
          h.Attribute("viewBox", miniMapViewBox(model, nodes)),
          h.Attribute("preserveAspectRatio", "xMidYMid meet"),
        ],
        [
          memo.on([nodes, input.nodeSizes, h], () =>
            minimapNodes(model, nodes, h),
          ),
          h.rect(
            [
              h.Class(classes.MiniMapViewport),
              h.DataAttribute("fflow-minimap-viewport", ""),
              h.Attribute("x", String(view.left)),
              h.Attribute("y", String(view.top)),
              h.Attribute("width", String(view.width)),
              h.Attribute("height", String(view.height)),
            ],
            [],
          ),
        ],
      ),
    ],
  );
};
