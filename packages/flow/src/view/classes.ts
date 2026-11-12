export const Pane = "fflow__pane";
export const Viewport = "fflow__viewport";
export const Edges = "fflow__edges";
export const Edge = "fflow__edge";
export const EdgePath = "fflow__edge-path";
/** The invisible, wider copy of an edge's path that a press lands on when the
 *  renderer draws edges as selectable (§7 M6). It carries no `data-edgeid`: the
 *  proofs count edges with `[data-edgeid]`, and a second element with that
 *  attribute would silently double the count (`docs/M6-FINDINGS.md` §5). */
export const EdgeInteraction = "fflow__edge-interaction";
export const IsSelectedEdge = "fflow__edge--selected";
export const EdgeEndpoint = "fflow__edge-endpoint";
export const Marker = "fflow__marker";
export const MarkerPath = "fflow__marker-path";
/** `fflow__marker--arrow` / `--arrow-closed`, from the kind's name. */
export const MarkerOf = (kind: string): string =>
  `fflow__marker--${kind.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
export const EdgeLabel = "fflow__edge-label";
export const Nodes = "fflow__nodes";
export const Node = "fflow__node";
export const NodeLabel = "fflow__node-label";
export const Handle = "fflow__handle";
export const SourceHandle = "source";
export const TargetHandle = "target";
export const Connection = "fflow__connection";
export const NoDrag = "fflow__nodrag";
export const NoPan = "fflow__nopan";
export const NoWheel = "fflow__nowheel";
export const NoKey = "fflow__nokey";
export const IsSelected = "fflow__node--selected";
export const IsDragging = "fflow__node--dragging";
export const ResizeHandle = "fflow__resize";
/** `fflow__resize--bottom-right`, one per control. */
export const ResizeHandleOf = (control: string): string =>
  `fflow__resize--${control}`;

// Chrome (§7 M3). Every piece of chrome is a press target inside the pane, so it
// carries `NoPan` — `target.closest` exempts its children too, which is the M1 §8
// lesson applied to buttons — and the attribute below, which is what the pane's
// own pointer handler declines so a control press never clears the selection.
export const ChromeAttribute = "fflow-chrome";
export const Background = "fflow__background";
export const Controls = "fflow__controls";
export const ControlButton = "fflow__controls-button";
export const MiniMap = "fflow__minimap";
export const MiniMapSvg = "fflow__minimap-svg";
export const MiniMapNode = "fflow__minimap-node";
export const MiniMapNodes = "fflow__minimap-nodes";
export const MiniMapViewport = "fflow__minimap-viewport";
export const Panel = "fflow__panel";
export const Description = "fflow__description";
