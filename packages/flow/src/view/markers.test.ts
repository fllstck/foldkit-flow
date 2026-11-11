import { Effect } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import { Message } from "../message.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode, MarkerEnd } from "../model.js";
import { markerIdOf } from "./markers.js";
import { createRenderer } from "./view.js";

const nodes: ReadonlyArray<FlowNode<null>> = [
  {
    id: "a",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
    data: null,
  },
  {
    id: "b",
    position: { x: 300, y: 0 },
    size: { width: 100, height: 40 },
    data: null,
  },
];

const model = init().model;

const render = (
  edges: ReadonlyArray<FlowEdge>,
  label?: (edge: FlowEdge, h: any) => any,
) => {
  const renderer = createRenderer<null, unknown>({
    paneId: "pane-markers",
    renderNode: (_node, _tools, h) => h.div([], []),
    ...(label === undefined ? {} : { renderEdgeLabel: label }),
  });

  return Effect.runPromise(
    Server.renderToString(
      {
        init: () => ({ model }),
        view: (state, h) => ({
          title: "markers",
          body: renderer.view(
            {
              model: state,
              nodes,
              edges,
              toParentMessage: (message: Message) => message,
            },
            h,
          ),
        }),
      },
      { isHydratable: false },
    ),
  );
};

const plain: FlowEdge = { id: "e1", source: "a", target: "b" };

describe("marker ids (M4-REVIEW 5)", () => {
  test("different pane ids never share a marker id", () => {
    // The substitution this replaces mapped both of these to `fflow-marker-a-b-…`,
    // so two flows on one page could paint each other's arrowhead.
    expect(markerIdOf("a/b", "Arrow")).not.toBe(markerIdOf("a-b", "Arrow"));
    expect(markerIdOf("a b", "Arrow")).not.toBe(markerIdOf("a_b", "Arrow"));
    expect(markerIdOf("a_2f_", "Arrow")).not.toBe(markerIdOf("a/", "Arrow"));
  });

  test("safe characters are kept, so the common id is still readable", () => {
    expect(markerIdOf("main-flow", "ArrowClosed")).toBe(
      "fflow-marker-main-flow-ArrowClosed",
    );
  });

  test("the encoding is injective on the characters it escapes", () => {
    const sample = ["a/b", "a-b", "a b", "a_b", "a%2Fb", "a//b", "a/b/c"];
    const encoded = sample.map((value) =>
      markerIdOf(value, "Arrow").replace(/-Arrow$/, ""),
    );
    expect(new Set(encoded).size).toBe(sample.length);
  });
});

describe("edge markers (§7 M4)", () => {
  test("an edge with no marker pays for no defs block", async () => {
    const rendered = await render([plain]);
    expect(rendered.html).not.toContain("<defs");
  });

  test("a marker end draws one defs entry and references it from the path", async () => {
    const rendered = await render([{ ...plain, markerEnd: "ArrowClosed" }]);

    // The marker exists once, with the id the path points at.
    expect(rendered.html).toContain(
      `id="${markerIdOf("pane-markers", "ArrowClosed")}"`,
    );
    expect(rendered.html).toContain(
      `marker-end="url(#${markerIdOf("pane-markers", "ArrowClosed")})"`,
    );
    // A start marker on no edge means no start marker in the document.
    expect(rendered.html).not.toContain(
      `id="${markerIdOf("pane-markers", "Arrow")}"`,
    );
  });

  test("both ends and both kinds can share one edges layer", async () => {
    const rendered = await render([
      { ...plain, markerStart: "Arrow", markerEnd: "Arrow" },
      { id: "e2", source: "b", target: "a", markerEnd: "ArrowClosed" },
    ]);

    (["Arrow", "ArrowClosed"] as ReadonlyArray<MarkerEnd>).forEach((kind) => {
      expect(rendered.html).toContain(
        `id="${markerIdOf("pane-markers", kind)}"`,
      );
    });
    expect(rendered.html).toContain(
      `marker-start="url(#${markerIdOf("pane-markers", "Arrow")})"`,
    );
  });

  test("the marker is a viewport-scaled glyph, not a stroke-width one", async () => {
    // `markerUnits="strokeWidth"` would shrink the arrow to nothing once
    // `non-scaling-stroke` keeps the line at 1.5px across a large zoom.
    const rendered = await render([{ ...plain, markerEnd: "Arrow" }]);
    expect(rendered.html).toContain('markerUnits="userSpaceOnUse"');
    expect(rendered.html).toContain('orient="auto-start-reverse"');
  });
});

describe("edge labels (§7 M4)", () => {
  test("a label renders as text at the path's label point, with a halo class", async () => {
    const rendered = await render([{ ...plain, label: "yes" }]);
    expect(rendered.html).toContain('class="fflow__edge-label"');
    expect(rendered.html).toContain(">yes<");
    // A11y: the label is inside the aria-hidden edges layer like the rest of it.
    expect(rendered.html).toContain('aria-hidden="true"');
  });

  test("an edge with no label renders no label element", async () => {
    const rendered = await render([plain]);
    expect(rendered.html).not.toContain("fflow__edge-label");
  });

  test("renderEdgeLabel replaces the label's content, not its position", async () => {
    const rendered = await render([{ ...plain, label: "yes" }], (edge, h) =>
      h.tspan([], [`${edge.id}: rendered`]),
    );
    expect(rendered.html).toContain("e1: rendered");
    expect(rendered.html).not.toContain(">yes<");
  });
});
