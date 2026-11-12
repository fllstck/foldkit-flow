import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The M7 proofs (§7 M7): the flow-anchored overlay layer, on `/m7.html`.
 *
 * Rung 5, because every claim here is about the screen. The layer's existence,
 * its wiring and the pane's guard are rung 3 (`view/selection.scene.test.ts`);
 * what no lower rung can see is where the item lands, how big it is on screen,
 * what paints over what, and whether a real press on it moves the viewport.
 *
 * The page's fixture (`src/fixture.ts` → `overlayFlow`) puts both edges' label
 * points in known places: `e-open`'s is empty canvas, `e-cover`'s is inside the
 * `cover` node. That is what makes the paint-order claim two comparisons against
 * one clip instead of an assertion about DOM order.
 *
 * `docs/verification.md`'s five questions, and where each is answered:
 *
 * 1. what paints on top of what — proof 53 (pixels, two states);
 * 2. a press on it neither pans nor clears the selection — proof 54;
 * 3. screen-size-stable while zooming, anchored while panning — proof 52;
 * 4. keyboard focus reaches the consumer's control — proof 54;
 * 5. it works on a second consumer page — proof 55 (`/examples/resizing/`).
 */
const M7 = "/m7.html";

/** `page.waitForFunction` has no default timeout: without this a proof that never
 *  becomes true burns the whole 600 s budget instead of failing (`M1-FINDINGS` §6.4). */
const WAIT = { timeout: 15_000 } as const;

/** The consumer's control's own background (`packages/benchmark/src/styles.css`).
 *  Nothing else on the page paints it, so it is a paint assertion, not a DOM one. */
const ITEM_BACKGROUND = "#ff00ff";
/** The `cover` node's background, from the same stylesheet. */
const COVER_BACKGROUND = "#2f5d4a";

const waitForPage = async (page: Page) => {
  await page.waitForSelector('[data-bench-ready="true"]', { timeout: 20_000 });
  await page.waitForSelector("[data-fflow-overlay]", { timeout: 20_000 });
  await page.waitForTimeout(300);
};

const attr = async (page: Page, name: string) =>
  (await page.locator(".bench-root").first().getAttribute(name)) ?? "";

const viewportOf = async (page: Page) => {
  const [x, y, zoom] = (await attr(page, "data-viewport"))
    .split(",")
    .map(Number);
  return { x: x ?? 0, y: y ?? 0, zoom: zoom ?? 1 };
};

/** The label point of an edge, in page coordinates, read off the painted path:
 *  half its length is the midpoint, which for a straight edge is exactly the
 *  point the overlay's transform translates to. Passing it through the path's own
 *  `getScreenCTM()` is what makes it independent of the viewport transform. */
const labelPoint = async (page: Page, edgeId: string, at = 0.5) => {
  const point = await page.evaluate(
    ({ id, fraction }) => {
      const path = document.querySelector(
        `.fflow__edge[data-edgeid="${id}"] .fflow__edge-path`,
      );
      if (!(path instanceof SVGPathElement)) return null;
      const local = path.getPointAtLength(path.getTotalLength() * fraction);
      const matrix = path.getScreenCTM();
      if (matrix === null) return null;
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    },
    { id: edgeId, fraction: at },
  );
  if (point === null) throw new Error(`no painted path for ${edgeId}`);
  return point;
};

/** The consumer's control for one edge, as the browser laid it out. */
const itemBox = async (page: Page, edgeId: string) => {
  const box = await page
    .locator(`.m7-overlay-item[data-edge="${edgeId}"]`)
    .first()
    .boundingBox();
  if (box === null) throw new Error(`no overlay item for ${edgeId}`);
  return box;
};

const centreOf = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

const expectClose = (actual: number, expected: number, tolerance: number) =>
  expect(
    Math.abs(actual - expected),
    `${actual} is not within ${tolerance} of ${expected}`,
  ).toBeLessThanOrEqual(tolerance);

/** Pixels of one clip, as `[r, g, b]` triples (the `m4.spec.ts` helper). */
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

const isNear = (
  pixel: ReadonlyArray<number>,
  colour: ReadonlyArray<number>,
  slack = 26,
) =>
  Math.abs((pixel[0] ?? 0) - (colour[0] ?? 0)) <= slack &&
  Math.abs((pixel[1] ?? 0) - (colour[1] ?? 0)) <= slack &&
  Math.abs((pixel[2] ?? 0) - (colour[2] ?? 0)) <= slack;

const rgbOf = (hex: string): ReadonlyArray<number> => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const countNear = (
  pixels: ReadonlyArray<ReadonlyArray<number>>,
  colour: ReadonlyArray<number>,
  slack = 26,
) => pixels.filter((pixel) => isNear(pixel, colour, slack)).length;

/** Hide or show the overlay layer without unmounting it, so the two states differ
 *  in one thing only: whether the item paints. */
const setLayerPainted = (page: Page, isPainted: boolean) =>
  page.evaluate((painted) => {
    const layer = document.querySelector(".fflow__overlays");
    if (!(layer instanceof HTMLElement)) return;
    layer.style.display = painted ? "" : "none";
  }, isPainted);

test("proof 52: the overlay item sits on the label point at two zooms, at one screen size", async ({
  page,
}) => {
  await page.goto(M7);
  await waitForPage(page);

  const atStart = await viewportOf(page);
  expect(atStart.zoom).toBe(1);

  const midOne = await labelPoint(page, "e-open");
  const boxOne = await itemBox(page, "e-open");
  const centreOne = centreOf(boxOne);

  // The item's centre *is* the edge's label point. This is the claim that
  // validates `transform-origin: 0 0`: the transform is
  // `translate(x, y) scale(1/zoom) translate(-50%, -50%)`, and with the default
  // centre origin both the translate and the scale pivot about the wrong point.
  expectClose(centreOne.x, midOne.x, 1);
  expectClose(centreOne.y, midOne.y, 1);
  expect(Math.round(boxOne.width)).toBe(90);
  expect(Math.round(boxOne.height)).toBe(24);

  /** The painted path's own on-screen extent, so a later comparison can say the
   *  zoom changed the edge as well as the item. */
  const edgeSpan = async (edgeId: string) => {
    const start = await labelPoint(page, edgeId, 0);
    const end = await labelPoint(page, edgeId, 1);
    return Math.hypot(end.x - start.x, end.y - start.y);
  };
  const spanAtZoomOne = await edgeSpan("e-open");

  // Anchored while panning: a pointer pan commits the viewport, and the item
  // travels with the edge because the anchor is in flow space.
  await page.mouse.move(1150, 300);
  await page.mouse.down();
  for (let step = 1; step <= 3; step += 1) {
    await page.mouse.move(1150 - step * 20, 300 + step * 10);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);

  expect(await viewportOf(page)).not.toEqual(atStart);
  const midPanned = await labelPoint(page, "e-open");
  const centrePanned = centreOf(await itemBox(page, "e-open"));
  expectClose(centrePanned.x, midPanned.x, 1);
  expectClose(centrePanned.y, midPanned.y, 1);

  // Two zooms: the zoom-out button, twice (×1/1.2 each). Zooming *out* keeps the
  // graph inside the pane, and it makes the inverse-zoom half of the claim
  // visible — without `scale(1/zoom)` the item would grow on screen.
  await page.locator('[data-fflow-control="ZoomOut"]').click();
  await page.locator('[data-fflow-control="ZoomOut"]').click();
  await page.waitForTimeout(300);

  const atZoomOut = await viewportOf(page);
  expect(atZoomOut.zoom).toBeLessThan(atStart.zoom - 0.2);

  const midOut = await labelPoint(page, "e-open");
  const boxOut = await itemBox(page, "e-open");
  const centreOut = centreOf(boxOut);

  // Still centred on the label point…
  expectClose(centreOut.x, midOut.x, 1.5);
  expectClose(centreOut.y, midOut.y, 1.5);
  // …at the same size on screen: the layout size is multiplied by `1/zoom`
  // inside a viewport that multiplies by `zoom`.
  expectClose(boxOut.width, boxOne.width, 1);
  expectClose(boxOut.height, boxOne.height, 1);

  // And the zoom really did change the edge, so the constant size above is not
  // one measurement taken twice.
  expectClose(await edgeSpan("e-open"), spanAtZoomOne * atZoomOut.zoom, 3);
  expect(await edgeSpan("e-open")).toBeLessThan(spanAtZoomOne * 0.95);
});

test("proof 53: the overlay paints above the edges and below the nodes", async ({
  page,
}) => {
  await page.goto(M7);
  await waitForPage(page);

  // ── Above the edges. `e-open`'s label point is empty canvas and the edge's
  // stroke runs through it: the item covers that stroke, so the pixels inside
  // the item are its own background rather than the edge's colour.
  const open = await labelPoint(page, "e-open");
  const openClip = {
    x: Math.round(open.x - 20),
    y: Math.round(open.y - 12),
    width: 40,
    height: 24,
  };

  const painted = await pixelsOf(page, openClip);
  expect(countNear(painted, rgbOf(ITEM_BACKGROUND))).toBeGreaterThan(400);

  // Two states: the same clip with the layer not painted. Every item pixel is
  // gone, and what was underneath is there instead.
  await setLayerPainted(page, false);
  await page.waitForTimeout(200);
  const unpainted = await pixelsOf(page, openClip);
  expect(countNear(unpainted, rgbOf(ITEM_BACKGROUND))).toBe(0);
  await setLayerPainted(page, true);
  await page.waitForTimeout(200);

  // …and what is underneath at the label point is the edge's own stroke, which
  // is the other half of "above the edges": the item's centre sits on the path.
  const edgeStroke = await page.evaluate(() => {
    const path = document.querySelector(
      '.fflow__edge[data-edgeid="e-open"] .fflow__edge-path',
    );
    return path === null ? null : getComputedStyle(path).stroke;
  });
  const stroke = (edgeStroke ?? "")
    .replace(/[^0-9,]/g, "")
    .split(",")
    .map(Number);
  await setLayerPainted(page, false);
  await page.waitForTimeout(200);
  const under = await pixelsOf(page, {
    x: Math.round(open.x) - 1,
    y: Math.round(open.y) - 1,
    width: 3,
    height: 3,
  });
  await setLayerPainted(page, true);
  await page.waitForTimeout(200);
  expect(countNear(under, stroke, 40)).toBeGreaterThan(0);

  // ── Below the nodes. `e-cover`'s label point is inside the `cover` node, and
  // the item's whole box is inside it too: the pixel is the node's background,
  // and hiding the layer changes nothing there. If the layer painted above the
  // nodes the two states would differ and the centre would be magenta.
  const covered = await labelPoint(page, "e-cover");
  const coveredBox = await itemBox(page, "e-cover");
  expect(covered.x).toBeGreaterThan(coveredBox.x);
  expect(covered.x).toBeLessThan(coveredBox.x + coveredBox.width);
  expect(covered.y).toBeGreaterThan(coveredBox.y);
  expect(covered.y).toBeLessThan(coveredBox.y + coveredBox.height);

  const coveredClip = {
    x: Math.round(covered.x - 20),
    y: Math.round(covered.y - 12),
    width: 40,
    height: 24,
  };
  const nodeOnTop = await pixelsOf(page, coveredClip);
  expect(countNear(nodeOnTop, rgbOf(ITEM_BACKGROUND))).toBe(0);
  // Sampled inside the item's own box and inside the node, but off the node's
  // centred text: the pixel is the node's background, which is what "the node
  // paints over the item" looks like.
  expect(
    countNear(
      await pixelsOf(page, {
        x: Math.round(coveredBox.x + 3),
        y: Math.round(covered.y),
        width: 1,
        height: 1,
      }),
      rgbOf(COVER_BACKGROUND),
    ),
  ).toBe(1);

  await setLayerPainted(page, false);
  await page.waitForTimeout(200);
  const nodeAlone = await pixelsOf(page, coveredClip);
  await setLayerPainted(page, true);

  // Identical: removing the item changed nothing, because the node was already
  // painting over it.
  expect(nodeAlone.length).toBe(nodeOnTop.length);
  expect(
    nodeAlone.filter(
      (pixel, index) =>
        pixel[0] !== nodeOnTop[index]?.[0] ||
        pixel[1] !== nodeOnTop[index]?.[1] ||
        pixel[2] !== nodeOnTop[index]?.[2],
    ).length,
  ).toBe(0);

  // The open item is still where proof 52 left it, so this test did not measure
  // a hidden layer by accident.
  expect(
    countNear(await pixelsOf(page, openClip), rgbOf(ITEM_BACKGROUND)),
  ).toBeGreaterThan(400);
});

test("proof 54: a press on the overlay neither pans nor clears the selection, and focus reaches it", async ({
  page,
}) => {
  await page.goto(M7);
  await waitForPage(page);

  // ── The tab sequence. Edges are tab stops (`edgeSelection`), the overlay layer
  // renders after them, and the nodes after that: two edges, then their controls.
  // This is the documented second-tab-stop consequence, walked as a keyboard user
  // walks it.
  await page.locator(".fflow__pane").click({ position: { x: 5, y: 5 } });
  const focused = async () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return {
        edgeId: active?.getAttribute("data-edgeid") ?? "",
        overlayEdge: active?.getAttribute("data-edge") ?? "",
        role: active?.getAttribute("role") ?? "",
        tag: active?.tagName ?? "",
      };
    });

  await page.keyboard.press("Tab");
  expect((await focused()).edgeId).not.toBe("");
  await page.keyboard.press("Tab");
  expect((await focused()).edgeId).not.toBe("");
  await page.keyboard.press("Tab");
  const onControl = await focused();
  expect(onControl.tag).toBe("DIV");
  expect(onControl.role).toBe("button");
  expect(onControl.overlayEdge).toBe("e-open");
  // Enter on the control is the control's: its own message runs, and no edge is
  // activated by the same keypress.
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".bench-root")
        ?.getAttribute("data-overlay-clicks") === "1",
    undefined,
    WAIT,
  );
  expect(await attr(page, "data-overlay-edge")).toBe("e-open");
  expect(await attr(page, "data-selected-edges")).toBe("");

  // ── Select the edge, then press the item that sits on it.
  const edgePoint = await labelPoint(page, "e-open", 0.25);
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await page.waitForFunction(
    () =>
      document
        .querySelector(".bench-root")
        ?.getAttribute("data-selected-edges") === "e-open",
    undefined,
    WAIT,
  );

  const before = await viewportOf(page);
  const centre = centreOf(await itemBox(page, "e-open"));

  // A press *and a drag* on the item: d3 would pan from it and the pane handler
  // would clear the selection, which is the bug `isOverlayTarget` exists for.
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let step = 1; step <= 3; step += 1) {
    await page.mouse.move(centre.x + step * 12, centre.y + step * 14);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);

  expect(await viewportOf(page)).toEqual(before);
  expect(await attr(page, "data-selected-edges")).toBe("e-open");
  expect(await attr(page, "data-gesture")).toBe("Idle");
  // The drag ended outside the button, so it is not a click: the count is still
  // the one Enter produced.
  expect(await attr(page, "data-overlay-clicks")).toBe("1");

  // A plain click is the consumer's message, and still not the pane's.
  await page.mouse.click(centre.x, centre.y);
  await page.waitForFunction(
    () =>
      document
        .querySelector(".bench-root")
        ?.getAttribute("data-overlay-clicks") === "2",
    undefined,
    WAIT,
  );
  expect(await attr(page, "data-overlay-edge")).toBe("e-open");
  expect(await attr(page, "data-selected-edges")).toBe("e-open");
  expect(await viewportOf(page)).toEqual(before);
  expect(await attr(page, "data-gesture")).toBe("Idle");
});

test("proof 55: the overlay works on a second consumer page", async ({
  page,
}) => {
  // `/examples/resizing/` is the second consumer: the control's markup and its
  // Message are the harness's (`edgeOverlay: (edge, h) => h.button(…)`), and the
  // selection it sits on is the example's own state, not the benchmark fixture's.
  await page.goto("http://localhost:4174/examples/resizing/");
  await page.waitForFunction(
    () => document.querySelectorAll(".fflow__node").length > 0,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForSelector("[data-fflow-overlay]", { timeout: 20_000 });
  await page.waitForTimeout(300);

  const selected = async () =>
    (await page
      .locator("main")
      .first()
      .getAttribute("data-example-selected")) ?? "";
  const fact = async () =>
    (await page.locator("main").first().getAttribute("data-example-fact")) ??
    "";
  const viewportTransform = async () =>
    (await page
      .locator("[data-fflow-viewport]")
      .first()
      .getAttribute("style")) ?? "";

  // One anchor per edge, and the anchor is the label point. The page's only edge
  // is a Bezier, whose label point is the midpoint of its two endpoints — the
  // painted path's own ends, in screen coordinates, so this is independent of the
  // transform the item is placed with.
  const edgeCount = await page.locator("[data-edgeid]").count();
  expect(edgeCount).toBe(1);
  expect(await page.locator("[data-fflow-overlay]").count()).toBe(edgeCount);

  const control = page.locator("[data-fflow-overlay] .ex2-edge-action").first();
  expect(await control.textContent()).toBe("Edit edge");

  const anchor = await page.evaluate(() => {
    const path = document.querySelector(
      ".fflow__edge[data-edgeid] .fflow__edge-path",
    );
    if (!(path instanceof SVGPathElement)) return null;
    const matrix = path.getScreenCTM();
    if (matrix === null) return null;
    const length = path.getTotalLength();
    const ends = [0, length].map((distance) => {
      const local = path.getPointAtLength(distance);
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
    return {
      x: ((ends[0]?.x ?? 0) + (ends[1]?.x ?? 0)) / 2,
      y: ((ends[0]?.y ?? 0) + (ends[1]?.y ?? 0)) / 2,
    };
  });
  if (anchor === null) throw new Error("the edge has no painted path");
  const controlBox = await control.boundingBox();
  if (controlBox === null) throw new Error("the control has no box");
  expectClose(controlBox.x + controlBox.width / 2, anchor.x, 2);
  expectClose(controlBox.y + controlBox.height / 2, anchor.y, 2);

  // Keyboard: the edge is the first stop, the control is the next one. Enter on
  // the control is the consumer's Message and leaves the edge selected.
  await page.locator(".fflow__edge[data-edgeid]").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector("main")?.getAttribute("data-example-selected") ===
      "e-panel-leaf",
    undefined,
    WAIT,
  );
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement?.className ?? ""),
  ).toBe("ex2-edge-action");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector("main")?.getAttribute("data-example-fact") ===
      "Edge control on e-panel-leaf",
    undefined,
    WAIT,
  );
  expect(await selected()).toBe("e-panel-leaf");

  // A press *and a drag* on the control: the pane declines it on this page too,
  // so the viewport does not travel and the selection survives.
  const before = await viewportTransform();
  const centre = {
    x: controlBox.x + controlBox.width / 2,
    y: controlBox.y + controlBox.height / 2,
  };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let step = 1; step <= 3; step += 1) {
    await page.mouse.move(centre.x + step * 11, centre.y + step * 13);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await viewportTransform()).toBe(before);
  expect(await selected()).toBe("e-panel-leaf");
  expect(await fact()).toBe("Edge control on e-panel-leaf");
});
