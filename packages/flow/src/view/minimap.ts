import { Array as Arr, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { nodeBounds, nodeRect } from "../geometry/bounds.js";
import { positionIndex } from "../geometry/positions.js";
import { Message } from "../message.js";
import type { FlowNode, Model, NodeSize, Point, Rect } from "../model.js";
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
 *
 * Collapsed nodes are the exception: a hidden subtree is not drawn here either,
 * because a minimap that shows what the canvas refuses to draw is a lie about
 * where the graph is (§7 M4).
 */
const minimapNodes = (
  model: Model,
  nodes: ReadonlyArray<FlowNode<unknown>>,
  h: HtmlBuilder<any>,
): Html => {
  const positions = positionIndex(nodes);
  return h.g(
    [h.Class(classes.MiniMapNodes)],
    nodes.map((node) => {
      const rect = nodeRect(node, model.nodeSizes, positions);
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
};

/**
 * The flow point a press inside the minimap is over.
 *
 * The minimap's `viewBox` **is** flow space, so the SVG's own screen matrix is the
 * whole conversion: `getScreenCTM()` includes the viewBox mapping and the element's
 * own on-page position, and its inverse turns a client point into the flow
 * coordinates the minimap is drawing. Reading it here — rather than deriving the
 * mapping in `update` — keeps the arithmetic in the one place that owns the
 * element, and leaves `update` with a plain flow point (`M3-FINDINGS` §11.1: the
 * screen-space conversion belongs to whoever holds the element).
 */
export const miniMapFlowPoint = (
  target: EventTarget | null,
  clientX: number,
  clientY: number,
): Option.Option<Point> => {
  if (!(target instanceof Element)) return Option.none();
  const svg = target.closest("svg");
  if (svg === null) return Option.none();

  // `getScreenCTM` is null for an element that is not rendered, which is what an
  // SSR-rendered or display-none minimap reports; a press there means nothing.
  const matrix = svg.getScreenCTM();
  if (matrix === null) return Option.none();

  const point = new DOMPoint(clientX, clientY).matrixTransform(
    matrix.inverse(),
  );
  return Option.some({ x: point.x, y: point.y });
};

export type MiniMapInput = Readonly<{
  model: Model;
  nodes: ReadonlyArray<FlowNode<unknown>>;
  nodeSizes: ReadonlyArray<NodeSize>;
  /** The pane rectangle in flow space — `viewportRect`, not `visibleRegion`:
   *  culling's overscan is not a fact about what the user can see. */
  view: Rect;
  toParentMessage: (message: Message) => any;
}>;

/**
 * Display-only in M3 (§7 M4 adds click-to-centre; drag-to-pan is documented as
 * out of scope in `docs/M4-FINDINGS.md`).
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
          // A press centres the view on the point under the cursor. It is
          // `NoPan` on the container, so d3 never starts a viewport pan from the
          // same press, and the pane's own handler declines chrome (§4.6).
          h.OnPointerDown(
            (
              _pointerType: string,
              button: number,
              _screenX: number,
              _screenY: number,
              _timeStamp: number,
              clientX: number,
              clientY: number,
              _pointerId: number,
              target: EventTarget | null,
            ) =>
              button !== 0
                ? Option.none()
                : Option.map(
                    miniMapFlowPoint(target, clientX, clientY),
                    (point) =>
                      input.toParentMessage(Message.ClickedMiniMap({ point })),
                  ),
          ),
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
