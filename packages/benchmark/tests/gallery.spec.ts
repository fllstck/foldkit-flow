import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The fixture gallery (M5): the same graph rendered by React Flow and by
 * `@fllstck/foldkit-flow`, compared on the two things that can be compared
 * honestly.
 *
 * 1. **Geometry** — the path `d` strings and the node boxes, on one input. Numbers
 *    are rounded before comparison so a float that differs in the last bit is not
 *    a failure; anything larger is.
 * 2. **Each library's own paint** — two screenshots of the *same* library differing
 *    only in the feature (labels off/on, markers off/on, edge types off/on,
 *    collapsed/expanded). Never our pixels against their stylesheet (§2.4): their
 *    node borders, handle CSS and attribution are theirs, and comparing them would
 *    prove nothing about either library's geometry.
 *
 * Its own file, so the three gate legs in `bench.spec.ts` keep their runtime and
 * the DOM they have always measured.
 */
const FIXTURES = [
  "edge-types",
  "labels",
  "markers",
  "subflow",
  "resize",
  "fitview",
] as const;

type Side = "foldkit" | "react";

type Geometry = Readonly<{
  edges: Readonly<Record<string, string>>;
  nodes: Readonly<Record<string, string>>;
  viewport: string;
}>;

const roundNumbers = (value: string, digits: number): string =>
  value.replace(/-?\d+(?:\.\d+)?/g, (match) => {
    const rounded = Number(Number(match).toFixed(digits));
    return String(rounded);
  });

/** Both pages expose the same shape: an edge id → `d`, a node id → its screen
 *  box. The selectors are each library's own — that is the whole point of a
 *  gallery — but nothing in here compares one library's styling to the other's. */
const readGeometry = async (page: Page, side: Side): Promise<Geometry> =>
  page.evaluate((which) => {
    const edges: Record<string, string> = {};
    const nodes: Record<string, string> = {};

    if (which === "foldkit") {
      document.querySelectorAll("[data-edgeid]").forEach((element) => {
        const id = element.getAttribute("data-edgeid") ?? "?";
        const path = element.querySelector("path");
        edges[id] = path?.getAttribute("d") ?? "";
      });
      document
        .querySelectorAll(".fflow__node[data-nodeid]")
        .forEach((element) => {
          const id = element.getAttribute("data-nodeid") ?? "?";
          const rect = element.getBoundingClientRect();
          nodes[id] = `${rect.x},${rect.y},${rect.width},${rect.height}`;
        });
    } else {
      document
        .querySelectorAll(".react-flow__edge[data-id]")
        .forEach((element) => {
          const id = element.getAttribute("data-id") ?? "?";
          const path = element.querySelector("path.react-flow__edge-path");
          edges[id] = path?.getAttribute("d") ?? "";
        });
      document
        .querySelectorAll(".react-flow__node[data-id]")
        .forEach((element) => {
          const id = element.getAttribute("data-id") ?? "?";
          const rect = element.getBoundingClientRect();
          nodes[id] = `${rect.x},${rect.y},${rect.width},${rect.height}`;
        });
    }

    return {
      edges,
      nodes,
      viewport:
        document
          .querySelector("[data-fflow-viewport]")
          ?.getAttribute("style") ??
        document
          .querySelector(".react-flow__viewport")
          ?.getAttribute("style") ??
        "",
    };
  }, side);

const open = async (page: Page, side: Side, name: string, variant = "on") => {
  await page.goto(`/gallery-${side}.html?fixture=${name}&variant=${variant}`);
  await page.waitForSelector('[data-gallery-ready="true"]', {
    timeout: 20_000,
  });
  await page.waitForFunction(
    (which) =>
      document.querySelectorAll(
        which === "foldkit" ? ".fflow__node" : ".react-flow__node",
      ).length > 0,
    side,
    { timeout: 20_000 },
  );
  // A fitted page settles one Message later (`ResizedPane` → `setViewport`), and
  // a measured page one observer later.
  if (side === "foldkit" && name === "fitview") {
    await page.waitForSelector('[data-gallery-fitted="true"]', {
      timeout: 20_000,
    });
  }
  await page.waitForTimeout(300);
};

const countOf = async (page: Page, side: Side, what: "labels" | "markers") =>
  page.evaluate(
    ({ which, kind }) => {
      if (which === "foldkit") {
        return kind === "labels"
          ? document.querySelectorAll(".fflow__edge-label").length
          : document.querySelectorAll(
              ".fflow__edge-path[marker-end], .fflow__edge-path[marker-start]",
            ).length;
      }
      return kind === "labels"
        ? document.querySelectorAll(
            ".react-flow__edgelabel-renderer text, .react-flow__edge text",
          ).length
        : document.querySelectorAll(
            ".react-flow__edge-path[marker-end], .react-flow__edge-path[marker-start]",
          ).length;
    },
    { which: side, kind: what },
  );

const screenshotOf = async (page: Page, side: Side) => {
  const box = await page
    .locator(side === "foldkit" ? ".fflow__pane" : ".react-flow")
    .boundingBox();
  if (box === null) throw new Error(`no pane on the ${side} page`);
  return page.screenshot({ clip: box });
};

test("the gallery: React Flow and Foldkit on the same fixture", async ({
  browser,
}) => {
  test.setTimeout(600_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  const report: Record<string, unknown> = {
    note: "M5 fixture gallery. Geometry is compared as path `d` strings (numbers rounded to 1e-3) and node screen boxes (rounded to 1e-1); paint is compared within each library, never across stylesheets (PLAN §2.4).",
    fixtures: {},
    notShipped: [
      "The resize gesture: React Flow's equivalent is its NodeResizer component, a different seam with its own DOM contract. Both libraries' *boxes* are compared here (the `resize` fixture); the gesture itself is proved in `tests/m4.spec.ts` (proof 44) and is not a cross-library comparison.",
      "Minimap, controls and the description region: chrome in both libraries is optional and styled by each project. Proved in `tests/chrome.spec.ts` on our side.",
      "Edge selection, minimap drag, `nodeOrigin`, multi-node resize and interactive edge labels: not shipped in v1.0 (M4-FINDINGS §8) and out of scope for M5.",
    ],
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
  };

  // 1. Geometry, fixture by fixture, on the same input.
  const geometry: Record<string, unknown> = {};
  for (const name of FIXTURES) {
    await open(page, "foldkit", name);
    const ours = await readGeometry(page, "foldkit");
    await open(page, "react", name);
    const theirs = await readGeometry(page, "react");

    const ourEdges = Object.fromEntries(
      Object.entries(ours.edges).map(([id, d]) => [id, roundNumbers(d, 3)]),
    );
    const theirEdges = Object.fromEntries(
      Object.entries(theirs.edges).map(([id, d]) => [id, roundNumbers(d, 3)]),
    );
    const ourNodes = Object.fromEntries(
      Object.entries(ours.nodes).map(([id, box]) => [id, roundNumbers(box, 1)]),
    );
    const theirNodes = Object.fromEntries(
      Object.entries(theirs.nodes).map(([id, box]) => [
        id,
        roundNumbers(box, 1),
      ]),
    );

    geometry[name] = {
      ourEdges,
      theirEdges,
      ourNodes,
      theirNodes,
      ourViewport: ours.viewport,
      theirViewport: theirs.viewport,
    };

    expect(Object.keys(ourEdges).sort(), `${name}: edge ids`).toEqual(
      Object.keys(theirEdges).sort(),
    );
    expect(Object.keys(ourNodes).sort(), `${name}: node ids`).toEqual(
      Object.keys(theirNodes).sort(),
    );
    // The path geometry: same anchors, same curvature, same commands.
    expect(ourEdges, `${name}: path d strings`).toEqual(theirEdges);
    // The node boxes: same box, so the anchors above are the same input.
    expect(ourNodes, `${name}: node boxes`).toEqual(theirNodes);
  }

  // 2. `hidden` is a documented divergence, not a match: ours collapses the
  // subtree (a collapsed container takes its children and their edges with it),
  // React Flow hides the node it is set on.
  await open(page, "foldkit", "hidden");
  const ourHidden = await readGeometry(page, "foldkit");
  await open(page, "react", "hidden");
  const theirHidden = await readGeometry(page, "react");

  expect(Object.keys(ourHidden.nodes)).toEqual(["loose"]);
  expect(Object.keys(ourHidden.edges)).toEqual([]);
  expect(Object.keys(theirHidden.nodes).sort()).toEqual(["h1", "h2", "loose"]);
  expect(Object.keys(theirHidden.edges)).toEqual(["e-child"]);

  report.divergence = {
    hidden: {
      ours: "collapsed: the container, its children and every edge into it are gone (1 node, 0 edges)",
      theirs:
        "the flagged node alone is hidden; its children and the edge into them are still drawn (3 nodes, 1 edge)",
      why: "`hidden` means collapsed here — the escape hatch for large graphs (M4-FINDINGS §2.3, README). React Flow's `hidden` is per node.",
    },
  };

  // 3. Paint, within each library: two states differing only in the feature.
  const paint: Record<string, unknown> = {};
  const paintCases = [
    { name: "labels", what: "labels" as const },
    { name: "markers", what: "markers" as const },
    { name: "edge-types", what: undefined },
    { name: "hidden", what: undefined },
  ];

  for (const entry of paintCases) {
    for (const side of ["foldkit", "react"] as const) {
      await open(page, side, entry.name, "on");
      const on = await screenshotOf(page, side);
      const domOn =
        entry.what === undefined ? null : await countOf(page, side, entry.what);

      await open(page, side, entry.name, "off");
      const off = await screenshotOf(page, side);
      const domOff =
        entry.what === undefined ? null : await countOf(page, side, entry.what);

      const key = `${entry.name}/${side}`;
      paint[key] = {
        pixelsDiffer: !on.equals(off),
        ...(domOn === null ? {} : { domOn, domOff }),
      };

      // The feature painted: the two screenshots cannot be identical.
      expect(on.equals(off), `${key}: the feature changed the pixels`).toBe(
        false,
      );
      // The DOM agrees about *what* changed, on that library's own terms.
      if (entry.what === "labels") {
        expect(domOn, `${key}: a label element`).toBeGreaterThan(0);
        expect(domOff, `${key}: no label element`).toBe(0);
      }
      if (entry.what === "markers") {
        expect(domOn, `${key}: a marker`).toBeGreaterThan(0);
        expect(domOff, `${key}: no marker`).toBe(0);
      }
    }
  }

  // 4. The resize fixture's controls are ours alone; the box is both.
  await open(page, "foldkit", "resize");
  const ourControls = await page.evaluate(() => ({
    handles: document.querySelectorAll(".fflow__resize").length,
    boxed: document.querySelectorAll(".fflow__node[data-boxed]").length,
  }));
  await open(page, "react", "resize");
  const theirControls = await page.evaluate(
    () => document.querySelectorAll(".react-flow__resize-control").length,
  );

  // Four corner controls per node (the edge midpoints belong to port handles,
  // M4-FINDINGS §2.7) on both fixtures' nodes, and both carry `data-boxed`
  // because the flow is drawing their declared size as their box.
  expect(ourControls.handles).toBe(8);
  expect(ourControls.boxed).toBe(2);
  expect(theirControls).toBe(0);

  report.fixtures = geometry;
  report.paint = paint;
  report.resize = {
    ourResizeHandles: ourControls.handles,
    ourBoxedNodes: ourControls.boxed,
    theirResizeControls: theirControls,
    boxGeometryMatches: true,
  };

  const outPath = resolve(process.cwd(), "results/gallery.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  expect(FIXTURES.length).toBe(6);
});
