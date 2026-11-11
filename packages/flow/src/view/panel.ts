import type { Html, HtmlBuilder } from "foldkit/html";

import * as classes from "./classes.js";

export type PanelPosition =
  "TopLeft" | "TopRight" | "BottomLeft" | "BottomRight";

const positionClass: Record<PanelPosition, string> = {
  TopLeft: "fflow__panel--top-left",
  TopRight: "fflow__panel--top-right",
  BottomLeft: "fflow__panel--bottom-left",
  BottomRight: "fflow__panel--bottom-right",
};

export type PanelConfig = Readonly<{
  position: PanelPosition;
  /** Accessible name for the panel's `role="group"`. */
  label?: string;
}>;

/**
 * A positioned container for consumer chrome (§7 M3). The parent builds the
 * contents and threads the result through `ViewInput.panel`, which is the same
 * boundary `renderNode` uses: the markup stays in the parent's boundary, so its
 * buttons dispatch parent Messages with no wrapper.
 *
 * A panel lives inside the pane, which means its presses reach the pane's d3
 * filter and the pane's own pointer handler. It therefore carries the same two
 * opt-outs every other piece of chrome carries: `NoPan`, and
 * `data-fflow-chrome` for the selection-clearing guard.
 */
export const panel = (
  config: PanelConfig,
  children: ReadonlyArray<Html>,
  h: HtmlBuilder<any>,
): Html =>
  h.div(
    [
      h.Class(
        `${classes.Panel} ${positionClass[config.position]} ${classes.NoPan}`,
      ),
      h.DataAttribute(classes.ChromeAttribute, ""),
      h.DataAttribute("fflow-panel", config.position),
      h.Attribute("role", "group"),
      ...(config.label === undefined ? [] : [h.AriaLabel(config.label)]),
    ],
    children,
  );
