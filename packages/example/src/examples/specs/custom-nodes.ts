import type { ExampleSpec } from "../spec";

/**
 * Your markup, not the library's.
 *
 * `renderNode` is a Foldkit view function: it receives the node, a `tools` handle
 * (handles and the live box size) and the builder. Handles come from
 * `tools.handle`, because their geometry is measured off the real DOM — a
 * `<div class="handle">` the library guessed at would be a lie the first time a
 * stylesheet moved it (`PLAN.md` §2.5.3).
 */
const example: ExampleSpec = {
  name: "custom-nodes",
  category: "Nodes",
  title: "Custom nodes",
  description:
    "A node is whatever `renderNode` returns. Here a card with a status pill, a title and a detail line, and handles placed by the consumer.",
  nodes: [
    {
      id: "ingest",
      x: 0,
      y: 60,
      width: 220,
      height: 92,
      title: "Ingest",
      subtitle: "S3 · 4 files",
      status: "ready",
    },
    {
      id: "enrich",
      x: 300,
      y: 0,
      width: 220,
      height: 92,
      title: "Enrich",
      subtitle: "12 040 rows",
      status: "running",
    },
    {
      id: "publish",
      x: 300,
      y: 180,
      width: 220,
      height: 92,
      title: "Publish",
      subtitle: "blocked",
      status: "failing",
    },
    {
      id: "notify",
      x: 600,
      y: 90,
      width: 220,
      height: 92,
      title: "Notify",
      subtitle: "slack #data",
      status: "ready",
    },
  ],
  edges: [
    {
      id: "e-ingest-enrich",
      source: "ingest",
      target: "enrich",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-ingest-publish",
      source: "ingest",
      target: "publish",
      markerEnd: "ArrowClosed",
    },
    {
      id: "e-enrich-notify",
      source: "enrich",
      target: "notify",
      label: "on pass",
      markerEnd: "ArrowClosed",
    },
  ],
  viewport: { x: 60, y: 60, zoom: 0.9 },
  // The consumer's markup. The only rule the library has about it is that
  // handles are rendered through `tools`, so their geometry is measured.
  renderNode: (node, tools, h) =>
    h.div(
      [h.Class("ex2-card")],
      [
        h.div(
          [h.Class("ex2-card-row")],
          [
            h.span(
              [h.Class(`ex2-pill ${node.data.status}`)],
              [node.data.status],
            ),
            h.span([h.Class("ex2-card-title")], [node.data.title]),
          ],
        ),
        h.span([h.Class("ex2-card-detail")], [node.data.subtitle]),
        tools.handle({ id: "in", type: "Target", position: "Top" }),
        tools.handle({ id: "out", type: "Source", position: "Bottom" }),
      ],
    ),
};

export default example;
