import type { Html, HtmlBuilder } from "foldkit/html";

import type { Viewport } from "../model.js";
import * as classes from "./classes.js";

/** Our own two patterns. There is no upstream variant list to mirror, and no
 *  upstream CSS to inherit: this is the visual identity §2.4 asks for. */
export type BackgroundVariant = "dots" | "lines";

export type BackgroundConfig = Readonly<{
  variant?: BackgroundVariant;
  /** Distance between pattern lines in flow units, so it scales with zoom. */
  gap?: number;
}>;

export const defaultBackgroundGap = 20;

/**
 * The pattern is one CSS background, not one element per dot (§7 M3): a
 * `background-image` with the viewport's own translate as `background-position`
 * and the gap times the zoom as `background-size`. Two style properties change
 * per viewport frame, the diff stays one element, and — because the layer sits
 * outside `.fflow__viewport` — the pattern does not scale with the content.
 *
 * The dot radius stays 1px at every zoom on purpose: a dot grid that grew with
 * the zoom would turn into blobs at 2x, and shrinking it would make the pattern
 * disappear at 0.2x. The pitch carries the zoom.
 */
export const backgroundView = (
  config: BackgroundConfig,
  viewport: Viewport,
  h: HtmlBuilder<any>,
): Html => {
  const variant = config.variant ?? "dots";
  const pitch = (config.gap ?? defaultBackgroundGap) * viewport.zoom;

  const image =
    variant === "dots"
      ? "radial-gradient(circle, var(--fflow-background-dot, #2a2f3a) 1px, transparent 1px)"
      : "linear-gradient(to right, var(--fflow-background-line, #20242c) 1px, transparent 1px), linear-gradient(to bottom, var(--fflow-background-line, #20242c) 1px, transparent 1px)";

  return h.div(
    [
      h.Class(classes.Background),
      h.DataAttribute("fflow-background", variant),
      h.Attribute("aria-hidden", "true"),
      h.Style({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        backgroundImage: image,
        backgroundSize: `${pitch}px ${pitch}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }),
    ],
    [],
  );
};
