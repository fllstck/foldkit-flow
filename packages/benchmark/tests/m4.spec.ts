import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEMO = "http://127.0.0.1:4174/";
const SUBFLOW = "/subflow.html";

/** `page.waitForFunction` has no default timeout: without this a proof that never
 *  becomes true burns the whole 600 s budget instead of failing (M1-FINDINGS §6.4). */
const WAIT = { timeout: 15_000 } as const;

const attr = async (page: Page, name: string) =>
  (await page.locator("main.app").getAttribute(name)) ?? "";

const waitForDemo = async (page: Page) => {
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main.app");
      return (
        main?.getAttribute("data-measured-nodes") === "630" &&
        main?.getAttribute("data-pane-mounts") === "1"
      );
    },
    undefined,
    WAIT,
  );
};

const waitForSubFlow = async (page: Page) => {
  await page.waitForSelector('[data-bench-ready="true"]', { timeout: 20_000 });
  await page.waitForTimeout(300);
};

/** The numbers inside `translate(x, y)`, in flow units: `parseFloat` drops the
 *  `px` for us, so no regular expression is needed. */
const parseTranslate = (style: string) => {
  const start = style.indexOf("translate(");
  const end = style.indexOf(")", start);
  if (start < 0 || end < 0) throw new Error(`no transform in: ${style}`);
  const parts = style.slice(start + "translate(".length, end).split(",");
  const [x, y] = parts.map((part) => Number.parseFloat(part));
  if (
    x === undefined ||
    y === undefined ||
    Number.isNaN(x) ||
    Number.isNaN(y)
  ) {
    throw new Error(`unparseable transform: ${style}`);
  }
  return { x, y };
};

const translateOf = async (page: Page, nodeId: string) => {
  const style = await page.evaluate(
    (id) =>
      document
        .querySelector(`.fflow__node[data-nodeid="${id}"]`)
        ?.getAttribute("style") ?? "",
    nodeId,
  );
  return parseTranslate(style);
};

/** The *content* box: the node's first child, which is what the user sees. The
 *  wrapper growing while the content stays put is exactly the bug that was
 *  reported by hand — "it only changes its visual size after I release". */
const contentOf = async (page: Page, nodeId: string) => {
  const box = await page.evaluate((id) => {
    const node = document.querySelector(`.fflow__node[data-nodeid="${id}"]`);
    const content = node?.firstElementChild;
    if (content === null || content === undefined) return null;
    const rect = content.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      boxed: node?.hasAttribute("data-boxed") ?? false,
    };
  }, nodeId);
  if (box === null) throw new Error(`no content for ${nodeId}`);
  return box;
};

const boxOf = async (page: Page, nodeId: string) => {
  const box = await page
    .locator(`.fflow__node[data-nodeid="${nodeId}"]`)
    .first()
    .boundingBox();
  if (box === null) throw new Error(`not rendered: ${nodeId}`);
  return box;
};

const centreOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`not rendered: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("proof 38: a child is drawn inside its parent, and dragging the parent carries it", async ({
  page,
}) => {
  await page.goto(SUBFLOW);
  await waitForSubFlow(page);

  // The fixture: p1 at (100, 100), c1 at (20, 60) inside it, at zoom 1 and
  // viewport (40, 40). So c1's absolute position is (120, 160) — and the wrapper
  // transform is that absolute position, not the relative one.
  expect(await translateOf(page, "p1")).toEqual({ x: 100, y: 100 });
  expect(await translateOf(page, "c1")).toEqual({ x: 120, y: 160 });
  // A node outside any parent is absolute, as it always was.
  expect(await translateOf(page, "loose")).toEqual({ x: 100, y: 520 });

  // Drag the parent by 80×40 *flow* units at zoom 1. The child is not in the
  // gesture's node list, so its moving is the position resolution at work.
  const start = await centreOf(page, '.fflow__node[data-nodeid="p1"]');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + step * 10, start.y + step * 5);
    await page.waitForTimeout(16);
  }

  // Read while the pointer is down: the overlay is what moves before release.
  expect(await translateOf(page, "p1")).toEqual({ x: 180, y: 140 });
  expect(await translateOf(page, "c1")).toEqual({ x: 200, y: 200 });
  await page.mouse.up();
});

test("proof 39: collapsing a container removes its subtree and its measurement", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForDemo(page);

  // The group is 5 nodes (a container and four children) parked above the grid;
  // nothing collapses until the parent says so.
  expect(await attr(page, "data-nodes")).toBe("630");
  expect(await attr(page, "data-hidden-nodes")).toBe("0");
  expect(await attr(page, "data-measured-nodes")).toBe("630");
  await expect(page.locator('.fflow__node[data-nodeid="group"]')).toHaveCount(
    1,
  );
  await expect(page.locator('.fflow__node[data-nodeid="g2"]')).toHaveCount(1);

  await page.locator("#toggle-group").click();

  // The nodes and their measurement go: `informGraphChanged` prunes what the flow
  // measured for ids the parent just collapsed (§2.5.9).
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main.app");
      return (
        main?.getAttribute("data-rendered-nodes") === "625" &&
        main?.getAttribute("data-hidden-nodes") === "5" &&
        main?.getAttribute("data-measured-nodes") === "625"
      );
    },
    undefined,
    WAIT,
  );
  await expect(page.locator('.fflow__node[data-nodeid="group"]')).toHaveCount(
    0,
  );
  await expect(page.locator('.fflow__node[data-nodeid="g2"]')).toHaveCount(0);
  // The rest of the graph is untouched: a collapse is not a cull.
  await expect(page.locator('.fflow__node[data-nodeid="n0"]')).toHaveCount(1);

  // Expanding restores the subtree and re-measures it.
  await page.locator("#toggle-group").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("main.app")
        ?.getAttribute("data-measured-nodes") === "630",
    undefined,
    WAIT,
  );
  await expect(page.locator('.fflow__node[data-nodeid="g2"]')).toHaveCount(1);
});

test("proof 40: a snapped drag lands the grabbed node on a grid multiple", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForDemo(page);

  // n0 is at flow (0, 0) and the demo's grid is 20 units, so a drag of ~63×47
  // has to land on a multiple of 20 — and the released position is what the demo
  // persists, so this is the committed number, not the overlay.
  const start = await centreOf(page, '.fflow__node[data-nodeid="n0"]');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 9; step += 1) {
    await page.mouse.move(start.x + step * 7, start.y + step * 5.2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);

  const moved = await translateOf(page, "n0");
  expect(moved.x % 20).toBe(0);
  expect(moved.y % 20).toBe(0);
  // …and it actually moved: a snap that pinned the node at 0 would pass a modulo
  // test and fail the user.
  expect(moved.x).toBeGreaterThan(0);
});

test("proof 41: the fit button uses the configured padding and clamp", async ({
  page,
}) => {
  await page.goto(SUBFLOW);
  await waitForSubFlow(page);

  const viewportOf = () =>
    page.evaluate(() => {
      const element = document.querySelector(
        "[data-fflow-viewport]",
      ) as HTMLElement;
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return { x: matrix.m41, y: matrix.m42, zoom: matrix.a };
    });

  const before = await viewportOf();
  await page.locator('[data-fflow-control="FitView"]').click();
  await page.waitForTimeout(500);

  const after = await viewportOf();
  // The page configures `fitView: { maxZoom: 0.6 }`. The graph fits the pane at
  // about 1.05, so the per-fit clamp is what the result shows — and it can only
  // tighten the Model's own maxZoom of 2, which is checked below.
  expect(after.zoom).toBeCloseTo(0.6, 3);
  expect(after.zoom).toBeLessThanOrEqual(2);
  expect(
    Math.abs(after.x - before.x) + Math.abs(after.y - before.y),
  ).toBeGreaterThan(1);

  // Padding 0.2 of the pane on each side leaves every node box inside the pane.
  const pane = await page.locator(".fflow__pane").boundingBox();
  if (pane === null) throw new Error("pane not rendered");
  for (const id of ["p1", "p2", "loose"]) {
    const box = await boxOf(page, id);
    expect(box.x).toBeGreaterThanOrEqual(pane.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(pane.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
  }
});

/** Pixels of one clip, as `[r, g, b]` triples. */
const pixelsOf = async (
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<ReadonlyArray<ReadonlyArray<number>>> => {
  const buffer = await page.screenshot({ clip });
  const png = buffer.toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) return [];
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    const triples: Array<Array<number>> = [];
    for (let index = 0; index < rgba.length; index += 4) {
      triples.push([
        rgba[index] ?? 0,
        rgba[index + 1] ?? 0,
        rgba[index + 2] ?? 0,
      ]);
    }
    return triples;
  }, png);
};

const isNear = (pixel: ReadonlyArray<number>, hex: string, slack = 26) => {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return (
    Math.abs((pixel[0] ?? 0) - red) <= slack &&
    Math.abs((pixel[1] ?? 0) - green) <= slack &&
    Math.abs((pixel[2] ?? 0) - blue) <= slack
  );
};

const EDGE_STROKE = "#596273";
const PANE_FOREGROUND = "#e6e8ee";

/** The screen point a path ends at, through the element's own screen matrix. */
const pathEnd = async (page: Page, edgeId: string) => {
  const point = await page.evaluate((id) => {
    const path = document.querySelector(
      `.fflow__edge[data-edgeid="${id}"] path.fflow__edge-path`,
    );
    if (!(path instanceof SVGPathElement)) return null;
    const at = path.getPointAtLength(path.getTotalLength());
    const matrix = path.getScreenCTM();
    if (matrix === null) return null;
    const screen = new DOMPoint(at.x, at.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, edgeId);
  if (point === null) throw new Error(`no path for edge ${edgeId}`);
  return point;
};

test("proof 42: an edge marker is painted, not just present in the DOM", async ({
  page,
}) => {
  await page.goto(SUBFLOW);
  await waitForSubFlow(page);

  // `e-child` ends on Child 4 with `markerEnd: "ArrowClosed"`.
  const end = await pathEnd(page, "e-child");
  // The arrow sits behind the endpoint (`refX` is the tip), so the clip is a
  // square just inside the path's end — where only the glyph can be drawn.
  // The glyph extends *back* along the path from the tip, and the path arrives
  // from above, so the clip is the square just above the end point.
  const clip = { x: end.x - 22, y: end.y - 36, width: 44, height: 36 };

  const withMarker = await pixelsOf(page, clip);
  await page.evaluate((id) => {
    document
      .querySelector(`.fflow__edge[data-edgeid="${id}"] path.fflow__edge-path`)
      ?.setAttribute("marker-end", "none");
  }, "e-child");
  await page.waitForTimeout(150);
  const without = await pixelsOf(page, clip);

  const countStroke = (pixels: ReadonlyArray<ReadonlyArray<number>>) =>
    pixels.filter((pixel) => isNear(pixel, EDGE_STROKE)).length;

  // A DOM assertion cannot see paint (M3-FINDINGS §14): same clip, same page,
  // with the marker attribute as the only difference. Measured in this clip: 137
  // stroke-coloured pixels with the arrow, 114 without — the glyph is ~23 px of
  // solid fill, and the rest of the difference would be the antialiased head of a
  // 1.5px line.
  expect(countStroke(withMarker)).toBeGreaterThan(countStroke(without) + 15);
});

test("proof 43: an edge label paints its text over a halo background", async ({
  page,
}) => {
  await page.goto(SUBFLOW);
  await waitForSubFlow(page);

  const box = await page.locator(".fflow__edge-label").first().boundingBox();
  if (box === null) throw new Error("label not rendered");
  const clip = {
    x: box.x - 2,
    y: box.y - 2,
    width: box.width + 4,
    height: box.height + 4,
  };

  const painted = await pixelsOf(page, clip);
  await page.evaluate(() => {
    const element = document.querySelector(".fflow__edge-label");
    if (element instanceof SVGElement) element.style.visibility = "hidden";
  });
  await page.waitForTimeout(150);
  const hidden = await pixelsOf(page, clip);

  const textPixels = (pixels: ReadonlyArray<ReadonlyArray<number>>) =>
    pixels.filter((pixel) => isNear(pixel, PANE_FOREGROUND)).length;

  // Glyphs are foreground-coloured pixels and they are painted: with the label
  // hidden the same clip has none of them.
  expect(textPixels(painted)).toBeGreaterThan(20);
  expect(textPixels(hidden)).toBe(0);
});

test("proof 44: a resize corner grows the node and the parent persists the box", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForDemo(page);

  const before = await boxOf(page, "n0");
  const contentBefore = await contentOf(page, "n0");
  const corner = await centreOf(
    page,
    '.fflow__node[data-nodeid="n0"] .fflow__resize--bottom-right',
  );

  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(corner.x + step * 10, corner.y + step * 5);
    await page.waitForTimeout(16);
  }

  // Mid-gesture the box is already bigger and the node has not moved: a corner
  // resize only writes the bottom-right edge.
  const during = await boxOf(page, "n0");
  expect(during.width).toBeGreaterThan(before.width + 30);
  expect(Math.abs(during.x - before.x)).toBeLessThan(1);

  // …and so is what the user actually sees. The wrapper carries `data-boxed` while
  // the gesture runs, and the content fills it, which is what makes the resize
  // visible before the parent has persisted anything (reported by hand after M4).
  const contentDuring = await contentOf(page, "n0");
  expect(contentDuring.boxed).toBe(true);
  expect(contentDuring.width).toBeGreaterThan(contentBefore.width + 30);
  expect(Math.abs(contentDuring.width - during.width)).toBeLessThan(3);
  // A resize is not a connection and not a node drag.
  expect(await attr(page, "data-gesture")).toBe("Resizing");
  expect(await attr(page, "data-selected-nodes")).toBe("");

  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-boxed-nodes") ===
      "1",
    undefined,
    WAIT,
  );

  // The parent folded `ResizedNodes` into `node.size` and the flow draws it: the
  // box survives the gesture, which is what "the parent persists the box" means.
  const after = await boxOf(page, "n0");
  expect(after.width).toBeGreaterThan(before.width + 30);
  expect(Math.abs(after.width - during.width)).toBeLessThan(3);
  expect(await attr(page, "data-gesture")).toBe("Idle");
});

test("proof 45: the same resize snaps to the demo's grid", async ({ page }) => {
  await page.goto(DEMO);
  await waitForDemo(page);

  const corner = await centreOf(
    page,
    '.fflow__node[data-nodeid="n0"] .fflow__resize--bottom-right',
  );
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  for (let step = 1; step <= 7; step += 1) {
    await page.mouse.move(corner.x + step * 9.3, corner.y + step * 7.1);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(350);

  // The demo's grid is 20 flow units at zoom 0.9, so the persisted box is a
  // multiple of 20 in flow units.
  const box = await boxOf(page, "n0");
  const zoom = Number((await attr(page, "data-viewport")).split(",")[2] ?? "1");
  const width = box.width / zoom;
  const height = box.height / zoom;
  expect(Math.abs(width - Math.round(width / 20) * 20)).toBeLessThan(2);
  expect(Math.abs(height - Math.round(height / 20) * 20)).toBeLessThan(2);
});

test("proof 46: a minimap click centres the view on the point under the cursor", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForDemo(page);

  const minimap = await page.locator(".fflow__minimap").boundingBox();
  if (minimap === null) throw new Error("minimap not rendered");
  const pane = await page.locator(".fflow__pane").boundingBox();
  if (pane === null) throw new Error("pane not rendered");

  // The flow point the minimap is showing under a screen point: the minimap's
  // `viewBox` *is* flow space, so its own screen matrix is the conversion — the
  // same one the press handler uses.
  const minimapFlowPoint = async (screen: { x: number; y: number }) =>
    page.evaluate((at) => {
      const svg = document.querySelector(".fflow__minimap-svg");
      if (!(svg instanceof SVGSVGElement)) return null;
      const matrix = svg.getScreenCTM();
      if (matrix === null) return null;
      const point = new DOMPoint(at.x, at.y).matrixTransform(matrix.inverse());
      return { x: point.x, y: point.y };
    }, screen);

  const flowPointUnder = async (screen: { x: number; y: number }) =>
    page.evaluate((at) => {
      const paneBox = (
        document.querySelector(".fflow__pane") as HTMLElement
      ).getBoundingClientRect();
      const matrix = new DOMMatrix(
        getComputedStyle(
          document.querySelector("[data-fflow-viewport]") as HTMLElement,
        ).transform,
      );
      return {
        x: (at.x - paneBox.left - matrix.m41) / matrix.a,
        y: (at.y - paneBox.top - matrix.m42) / matrix.a,
      };
    }, screen);

  const point = {
    x: minimap.x + minimap.width * 0.3,
    y: minimap.y + minimap.height * 0.4,
  };
  const target = await minimapFlowPoint(point);
  if (target === null) throw new Error("no minimap matrix");
  const before = await attr(page, "data-viewport");

  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);

  expect(await attr(page, "data-viewport")).not.toBe(before);
  const centred = await flowPointUnder({
    x: pane.x + pane.width / 2,
    y: pane.y + pane.height / 2,
  });
  // The flow point that was under the cursor is now the middle of the pane.
  expect(Math.abs(centred.x - target.x)).toBeLessThan(6);
  expect(Math.abs(centred.y - target.y)).toBeLessThan(6);
});
