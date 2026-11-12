import type { ExampleSpec } from "../spec";

/**
 * A resize that the content follows.
 *
 * `resize: true` does two things: it draws each node's declared `size` as its box,
 * and it puts four corner controls on it. A release reports `ResizedNodes`, which
 * the harness folds back into the graph — so the size survives the next render.
 *
 * The one thing the library does not do is stretch your markup: a container wants
 * a frame, a leaf wants a filled box, and only you know which. The rule is one
 * line of CSS, shown in the `examples.css` tab.
 *
 * `edgeSelection` is on here too, so this page is a second consumer of it: press
 * the edge to select it, or Tab to it and press Enter. The whole feature is the
 * one option — the library draws the wider hit path, names the edge from
 * `accessibleName`, and reports `SelectedElements` like any other selection.
 *
 * `edgeOverlay` puts a button on the edge's label point. The library anchors it,
 * cancels the zoom and declines the pane's press; the button and its Message are
 * the harness's. Press it: it neither pans nor clears the selection.
 */
const example: ExampleSpec = {
  name: "resizing",
  category: "Nodes",
  title: "Resizing",
  description:
    "Drag a corner: the box is the flow's, the filling is one line of your CSS, and the parent persists the size it is told about. Shift holds the ratio; the edge is a press target and a tab stop.",
  nodes: [
    {
      id: "panel",
      x: 0,
      y: 0,
      width: 420,
      height: 240,
      title: "Resizable panel",
      subtitle: "drag the bottom-right corner",
      status: "ready",
    },
    {
      id: "leaf",
      x: 520,
      y: 80,
      width: 240,
      height: 92,
      title: "Leaf",
      subtitle: "resizes too",
      status: "running",
    },
  ],
  edges: [
    { id: "e-panel-leaf", source: "panel", target: "leaf", markerEnd: "Arrow" },
  ],
  viewport: { x: 80, y: 100, zoom: 1 },
  renderer: {
    resize: true,
    edgeSelection: true,
    edgeOverlay: true,
    snapGrid: { x: 10, y: 10 },
  },
};

export default example;
