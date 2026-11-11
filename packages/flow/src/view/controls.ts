import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../message.js";
import * as classes from "./classes.js";

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
    message: Message.ClickedFitView(),
  },
];

/**
 * Zoom in, zoom out, fit (§7 M3). The buttons are the library's, so they
 * dispatch library Messages; `update` routes each one to `zoomBy`/`setViewport`
 * and therefore to the Model's own zoom bounds.
 *
 * Every press here is a press inside the pane, which the pane's d3 filter would
 * otherwise read as the start of a pan: the container carries `NoPan`, and
 * `data-fflow-chrome` is what the pane's own pointer handler declines so the
 * press cannot clear the selection either (§4.6).
 */
export const controlsView = (
  toParentMessage: (message: Message) => any,
  h: HtmlBuilder<any>,
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
          h.OnClick(toParentMessage(control.message)),
        ],
        [control.glyph],
      ),
    ),
  );
