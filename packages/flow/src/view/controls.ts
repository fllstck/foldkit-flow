import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../message.js";
import * as classes from "./classes.js";

/** The fit button's defaults (§7 M4). A `nodes` filter is deliberately absent:
 *  it is a graph decision the parent makes by calling `Flow.fitViewport` itself,
 *  not something the library's button can know. */
export type FitViewConfig = Readonly<{
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Milliseconds of animation. Absent jumps, which is what M3 did. */
  duration?: number;
}>;

type ControlSpec = Readonly<{
  kind: "ZoomIn" | "ZoomOut" | "FitView";
  label: string;
  glyph: string;
  message: Message;
}>;

const controls: ReadonlyArray<ControlSpec> = [
  {
    kind: "ZoomIn",
    label: "Zoom in",
    glyph: "+",
    message: Message.ClickedZoomIn(),
  },
  {
    kind: "ZoomOut",
    label: "Zoom out",
    glyph: "\u2212",
    message: Message.ClickedZoomOut(),
  },
  {
    kind: "FitView",
    label: "Fit view",
    glyph: "\u2317",
    message: Message.ClickedFitView({
      padding: Option.none(),
      minZoom: Option.none(),
      maxZoom: Option.none(),
      duration: Option.none(),
    }),
  },
];

/** The fit button's Message, carrying the configured options. Every field is an
 *  `Option` so "not configured" is a value rather than an absent property — which
 *  is what lets the Message be built without a conditional spread. */
const fitViewMessage = (config: FitViewConfig | undefined): Message =>
  Message.ClickedFitView({
    padding: Option.fromNullishOr(config?.padding),
    minZoom: Option.fromNullishOr(config?.minZoom),
    maxZoom: Option.fromNullishOr(config?.maxZoom),
    duration: Option.fromNullishOr(config?.duration),
  });

/**
 * Zoom in, zoom out, fit (§7 M3). The buttons are the library's, so they
 * dispatch library Messages; `update` routes each one to `zoomBy`/`setViewport`
 * and therefore to the Model's own zoom bounds.
 *
 * Every press here is a press inside the pane, which the pane's d3 filter would
 * otherwise read as the start of a pan: the container carries `NoPan`, and
 * `data-fflow-chrome` is what the pane's own pointer handler declines so the
 * press cannot clear the selection either (§4.6).
 *
 * The `FitView` entry in `controls` is only a placeholder carrying the tag: the
 * real Message is built by `fitViewMessage` with the renderer's options.
 */
export const controlsView = (
  toParentMessage: (message: Message) => any,
  h: HtmlBuilder<any>,
  fitView?: FitViewConfig,
): Html =>
  h.div(
    [
      h.Class(`${classes.Controls} ${classes.NoPan}`),
      h.DataAttribute(classes.ChromeAttribute, ""),
      h.DataAttribute("fflow-controls", ""),
      h.Attribute("role", "group"),
      h.AriaLabel("Viewport controls"),
    ],
    controls.map((control) =>
      h.button(
        [
          h.Class(classes.ControlButton),
          h.DataAttribute("fflow-control", control.kind),
          h.Attribute("type", "button"),
          h.AriaLabel(control.label),
          h.Title(control.label),
          h.OnClick(
            toParentMessage(
              control.kind === "FitView"
                ? fitViewMessage(fitView)
                : control.message,
            ),
          ),
        ],
        [control.glyph],
      ),
    ),
  );
