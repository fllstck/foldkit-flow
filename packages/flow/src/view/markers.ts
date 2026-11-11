import type { Html, HtmlBuilder } from "foldkit/html";

import type { FlowEdge, MarkerEnd } from "../model.js";
import * as classes from "./classes.js";

/** The marker kinds this library draws. Our own glyphs, like the rest of the
 *  chrome (§2.4): a `<marker>` is a visual identity choice, not a ported one. */
export const markerKinds: ReadonlyArray<MarkerEnd> = ["Arrow", "ArrowClosed"];

/**
 * Ids must be unique in the document — two flows on one page must not share a
 * marker — so they are derived from the pane id.
 *
 * The encoding is **injective**, not a substitution: replacing unsafe characters
 * with `-` maps `a/b` and `a-b` to the same id, and two flows with such ids would
 * silently point at each other's marker (M4-REVIEW 5). Instead, every character
 * outside `[A-Za-z0-9-]` is escaped as `_<code point in hex>_`, and `_` itself is
 * outside that set, so an underscore in the id always introduces an escape and two
 * different pane ids cannot collide.
 */
export const encodeIdPart = (value: string): string =>
  Array.from(value)
    .map((character) =>
      /[A-Za-z0-9-]/.test(character)
        ? character
        : `_${(character.codePointAt(0) ?? 0).toString(16)}_`,
    )
    .join("");

export const markerIdOf = (paneId: string, kind: MarkerEnd): string =>
  `fflow-marker-${encodeIdPart(paneId)}-${kind}`;

const markerGeometry: Record<MarkerEnd, string> = {
  // An open chevron: two strokes meeting at the tip.
  Arrow: "M1,1 L9,5 L1,9",
  // A solid triangle, closed at the base.
  ArrowClosed: "M1,1 L9,5 L1,9 Z",
};

/**
 * One `<marker>` per kind in use.
 *
 * Two decisions worth stating, because both are easy to get wrong:
 *
 * - `markerUnits="userSpaceOnUse"` scales the glyph with the viewport, like the
 *   nodes it points at. The default (`strokeWidth`) would shrink it, because
 *   `.fflow__edge-path` carries `non-scaling-stroke` so that the line stays 1.5 px
 *   at every zoom (M3 §14).
 * - `orient="auto-start-reverse"` means one marker serves both ends: at the start
 *   it points backwards, at the end forwards.
 *
 * `refX` is the tip, so the glyph sits *behind* the endpoint rather than poking
 * past the node it lands on.
 */
const markerDef = (
  kind: MarkerEnd,
  paneId: string,
  h: HtmlBuilder<any>,
): Html =>
  h.marker(
    [
      h.Attribute("id", markerIdOf(paneId, kind)),
      h.Class(`${classes.Marker} ${classes.MarkerOf(kind)}`),
      h.Attribute("viewBox", "0 0 10 10"),
      h.Attribute("markerWidth", "10"),
      h.Attribute("markerHeight", "10"),
      h.Attribute("refX", "9"),
      h.Attribute("refY", "5"),
      h.Attribute("markerUnits", "userSpaceOnUse"),
      h.Attribute("orient", "auto-start-reverse"),
    ],
    [
      h.path(
        [h.Attribute("d", markerGeometry[kind]), h.Class(classes.MarkerPath)],
        [],
      ),
    ],
  );

/**
 * The `<defs>` for the edges layer, or `[]` when no edge asks for a marker — an
 * arrowless graph must not pay for a defs block it never uses.
 */
export const markerDefs = (
  edges: ReadonlyArray<FlowEdge<unknown>>,
  paneId: string,
  h: HtmlBuilder<any>,
): ReadonlyArray<Html> => {
  const used = new Set<MarkerEnd>();
  edges.forEach((edge) => {
    if (edge.markerStart !== undefined) used.add(edge.markerStart);
    if (edge.markerEnd !== undefined) used.add(edge.markerEnd);
  });
  if (used.size === 0) return [];

  return [
    h.defs(
      [],
      markerKinds
        .filter((kind) => used.has(kind))
        .map((kind) => markerDef(kind, paneId, h)),
    ),
  ];
};

/** The `url(#…)` reference one edge end paints with. */
export const markerReference = (paneId: string, kind: MarkerEnd): string =>
  `url(#${markerIdOf(paneId, kind)})`;
