/**
 * The fixture gallery's graphs (M5).
 *
 * One definition, rendered by React Flow (`reactPage.tsx`) and by
 * `@fllstck/foldkit-flow` (`foldkitPage.ts`), so `tests/gallery.spec.ts` can put
 * the two libraries' output side by side on the *same* input. Positions and sizes
 * are explicit in every fixture: a graph whose geometry one library measured and
 * the other inferred would compare measurement, not geometry.
 *
 * Anchors. Both libraries put an edge end at the node border unless a handle says
 * otherwise — ours on the border's midpoint (source bottom, target top), React
 * Flow at the handle box's outer edge — so the React page renders zero-sized
 * handles *on* those midpoints and the two agree on the input rather than on a
 * stylesheet (`docs/PLAN.md` §2.4).
 *
 * Variants. `variant: "off"` is the same graph with the feature under test removed
 * and nothing else changed, which is what the paint comparison needs: two states
 * differing only in the thing being proved (M3 §14).
 */
export type GalleryNode = Readonly<{
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  parentId?: string;
  hidden?: boolean;
}>;

export type GalleryEdgeKind = "Bezier" | "Straight" | "Step" | "SmoothStep";

export type GalleryEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  kind: GalleryEdgeKind;
  label?: string;
  markerEnd?: "Arrow" | "ArrowClosed";
}>;

export type GalleryFixture = Readonly<{
  name: string;
  description: string;
  nodes: ReadonlyArray<GalleryNode>;
  edges: ReadonlyArray<GalleryEdge>;
  /** An explicit viewport, or `"fit"` — both libraries then fit the same bounds
   *  with the same padding, and the comparison is of the fit. */
  viewport: Readonly<{ x: number; y: number; zoom: number }> | "fit";
  padding?: number;
  /** Draw the node's declared size as its box (§7 M4 `resize`), which is what a
   *  persisted resize looks like in both libraries. */
  resize?: boolean;
  /** What `variant: "off"` removes, for the report's benefit. */
  feature: string;
}>;

const node = (
  id: string,
  x: number,
  y: number,
  label: string,
  width = 140,
  height = 60,
  extra?: Readonly<{ parentId?: string; hidden?: boolean }>,
): GalleryNode => ({ id, x, y, width, height, label, ...extra });

/** The gallery's fixtures, keyed by the `?fixture=` value both pages read. */
export const galleryFixtures = {
  "edge-types": {
    name: "edge-types",
    feature: "edge types",
    description:
      "Three edge types from one source: Step, SmoothStep, Bezier. The off variant is the same three edges all Bezier.",
    nodes: [
      node("s", 80, 120, "source"),
      node("a", 380, 40, "a"),
      node("b", 380, 240, "b"),
      node("c", 700, 120, "c"),
    ],
    edges: [
      { id: "e-step", source: "s", target: "a", kind: "Step" },
      { id: "e-smooth", source: "s", target: "b", kind: "SmoothStep" },
      { id: "e-bezier", source: "s", target: "c", kind: "Bezier" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  labels: {
    name: "labels",
    feature: "edge labels",
    description: "One edge with a label at the path's midpoint.",
    nodes: [node("l1", 80, 160, "l1"), node("l2", 440, 160, "l2")],
    edges: [
      {
        id: "e-label",
        source: "l1",
        target: "l2",
        kind: "Bezier",
        label: "yes",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  markers: {
    name: "markers",
    feature: "edge markers",
    description: "One edge with a closed arrow at its target end.",
    nodes: [node("m1", 80, 160, "m1"), node("m2", 440, 160, "m2")],
    edges: [
      {
        id: "e-marker",
        source: "m1",
        target: "m2",
        kind: "Bezier",
        markerEnd: "ArrowClosed",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  subflow: {
    name: "subflow",
    feature: "sub-flows",
    description:
      "Two 420×300 containers with children at parent-relative positions, and an edge from a child in one container to a child in the other.",
    nodes: [
      node("p1", 100, 100, "Parent 1", 420, 300),
      node("c1", 20, 60, "Child 1", 140, 50, { parentId: "p1" }),
      node("c2", 240, 60, "Child 2", 140, 50, { parentId: "p1" }),
      node("p2", 700, 100, "Parent 2", 420, 300),
      node("d1", 20, 60, "Child 3", 140, 50, { parentId: "p2" }),
      node("loose", 100, 520, "Loose", 140, 50),
    ],
    edges: [
      { id: "e-child", source: "c2", target: "d1", kind: "Bezier" },
      { id: "e-loose", source: "p2", target: "loose", kind: "Bezier" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  hidden: {
    name: "hidden",
    feature: "hidden (collapsed) subtrees",
    description:
      "A container with two children and an edge from a child to a loose node. The on variant collapses the container; the off variant draws it.",
    nodes: [
      node("box", 100, 100, "Box", 420, 300, { hidden: true }),
      node("h1", 20, 60, "h1", 140, 50, { parentId: "box" }),
      node("h2", 240, 60, "h2", 140, 50, { parentId: "box" }),
      node("loose", 100, 520, "Loose", 140, 50),
    ],
    edges: [{ id: "e-child", source: "h1", target: "loose", kind: "Bezier" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  resize: {
    name: "resize",
    feature: "a drawn node box (a persisted resize)",
    description:
      "A 320×180 node and a 140×60 one: the box the flow draws from `node.size`, with our four resize controls on the larger one. React Flow has no equivalent control without its NodeResizer component, so only the box is compared (see the report's `notShipped`).",
    nodes: [
      node("big", 80, 120, "resized", 320, 180),
      node("small", 520, 120, "small"),
    ],
    edges: [{ id: "e-box", source: "big", target: "small", kind: "Bezier" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    resize: true,
  },
  fitview: {
    name: "fitview",
    feature: "fitView",
    description:
      "A sparse 1200×800 graph, fitted into the pane by both libraries with padding 0.1 rather than given a viewport.",
    nodes: [
      node("f1", 0, 0, "f1"),
      node("f2", 600, 300, "f2"),
      node("f3", 1060, 740, "f3"),
    ],
    edges: [{ id: "e-fit", source: "f1", target: "f3", kind: "Bezier" }],
    viewport: "fit",
    padding: 0.1,
  },
} satisfies Record<string, GalleryFixture>;

export type GalleryFixtureName = keyof typeof galleryFixtures;

// SAFETY: `Object.keys` of an object literal returns exactly its own keys, so
// every entry is a `GalleryFixtureName` by construction.
export const galleryFixtureNames = Object.keys(
  galleryFixtures,
) as ReadonlyArray<GalleryFixtureName>;

export type GalleryVariant = "on" | "off";

/** The `off` variant: the same graph with labels, markers, edge types and
 *  collapsing removed, and no other change. */
export const galleryFixture = (
  name: GalleryFixtureName,
  variant: GalleryVariant,
): GalleryFixture => {
  const fixture = galleryFixtures[name];
  if (variant === "on") return fixture;

  return {
    ...fixture,
    nodes: fixture.nodes.map((entry) => {
      const { hidden: _hidden, ...rest } = entry;
      return rest;
    }),
    edges: fixture.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: "Bezier",
    })),
  };
};

/**
 * The query string both gallery pages read. An unknown `?fixture=` falls back to
 * the first fixture rather than blanking the page: a gallery page with no graph
 * is a worse diagnostic than a gallery page with the wrong one.
 */
export const readGalleryQuery = (search: string) => {
  const params = new URLSearchParams(search);
  const requested = params.get("fixture") ?? "edge-types";
  // SAFETY: the `includes` check is the guard — after it, `requested` is one of
  // the keys exactly when the cast says it is.
  const name: GalleryFixtureName = galleryFixtureNames.includes(
    requested as GalleryFixtureName,
  )
    ? (requested as GalleryFixtureName)
    : "edge-types";
  const variant: GalleryVariant =
    params.get("variant") === "off" ? "off" : "on";
  return { name, variant };
};
