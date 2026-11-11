import { Handle, MarkerType, Position, ReactFlow } from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import { Match } from "effect";
import { createRoot } from "react-dom/client";

import "@xyflow/react/dist/style.css";

import type { GalleryEdgeKind, GalleryFixture } from "./fixtures";
import { galleryFixture, readGalleryQuery } from "./fixtures";

/**
 * The same fixture, rendered by React Flow.
 *
 * Two deliberate choices make the comparison one of geometry rather than of
 * stylesheets:
 *
 * - Each node carries a zero-sized `Handle` on the border's midpoint — the point
 *   our library anchors to when a node has no measured handle. React Flow's Right
 *   anchor is the handle box's *outer* edge, so a normally-sized handle would put
 *   the two libraries 2–3 px apart for a reason that has nothing to do with the
 *   path geometry (§2.4: never compare our pixels to their CSS).
 * - Nothing else is styled here. The node's box comes from the fixture's explicit
 *   size, exactly as our `node.size` does.
 */
const zeroHandle = (
  position: Position.Top | Position.Bottom,
): React.CSSProperties => ({
  width: 0,
  height: 0,
  minWidth: 0,
  minHeight: 0,
  border: "none",
  background: "none",
  borderRadius: 0,
  left: "50%",
  top: position === Position.Top ? 0 : undefined,
  bottom: position === Position.Bottom ? 0 : undefined,
  transform: "none",
});

type GalleryData = { label: string };

const GalleryNode = ({ data }: NodeProps<Node<GalleryData>>) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 11,
      boxSizing: "border-box",
    }}
  >
    {data.label}
    <Handle
      type="target"
      position={Position.Top}
      style={zeroHandle(Position.Top)}
    />
    <Handle
      type="source"
      position={Position.Bottom}
      style={zeroHandle(Position.Bottom)}
    />
  </div>
);

const nodeTypes = { gallery: GalleryNode };

/** Our four kinds onto React Flow's built-in edge types. `Step` is the same
 *  `getSmoothStepPath` call with `borderRadius: 0` in both libraries. */
const reactFlowType = (kind: GalleryEdgeKind): string =>
  Match.value(kind).pipe(
    Match.when("Step", () => "step"),
    Match.when("SmoothStep", () => "smoothstep"),
    Match.when("Straight", () => "straight"),
    Match.orElse(() => "default"),
  );

const mountGallery = (fixture: GalleryFixture): void => {
  // Field by field rather than spread-with-undefined: React Flow's prop types
  // are exact, so "absent" and "present but undefined" are different things.
  const nodes: Array<Node<GalleryData>> = fixture.nodes.map((entry) => {
    const mapped: Node<GalleryData> = {
      id: entry.id,
      type: "gallery",
      position: { x: entry.x, y: entry.y },
      data: { label: entry.label },
      style: { width: entry.width, height: entry.height },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
    if (entry.parentId !== undefined) mapped.parentId = entry.parentId;
    if (entry.hidden !== undefined) mapped.hidden = entry.hidden;
    return mapped;
  });

  const edges: Array<Edge> = fixture.edges.map((edge) => {
    const mapped: Edge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: reactFlowType(edge.kind),
    };
    if (edge.label !== undefined) mapped.label = edge.label;
    if (edge.markerEnd !== undefined) {
      mapped.markerEnd = {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      };
    }
    return mapped;
  });

  const root = document.getElementById("root");
  if (root === null) return;

  const fitted = fixture.viewport === "fit";

  createRoot(root).render(
    <div
      className="gallery-root"
      data-gallery-ready="true"
      data-gallery-fixture={fixture.name}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={fitted}
        fitViewOptions={{ padding: fixture.padding ?? 0.1 }}
        {...(fixture.viewport === "fit"
          ? {}
          : { defaultViewport: fixture.viewport })}
        proOptions={{ hideAttribution: false }}
      />
    </div>,
  );
};

const { name, variant } = readGalleryQuery(window.location.search);
mountGallery(galleryFixture(name, variant));
