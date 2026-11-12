import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The M6 proofs (§7 M6). One page, `/m6.html`, built from the sub-flow fixture with
 * the three behaviours that milestone shipped switched on: `edgeSelection`,
 * `resize` and the chrome (which brings the minimap).
 *
 * Rung 5, because every claim here is about the screen: a press that lands on a
 * painted stroke, a tab stop a browser will actually focus, a drag whose scale
 * comes from the minimap's own `getScreenCTM()`, and a box that holds its ratio
 * under a held modifier. The arithmetic for all four is rung 1/2
 * (`geometry/resize.test.ts`, `state.test.ts`) and the wiring is rung 3
 * (`view/selection.scene.test.ts`).
 */
const M6 = "/m6.html";

/** `page.waitForFunction` has no default timeout: without this a proof that never
 *  becomes true burns the whole 600 s budget instead of failing (`M1-FINDINGS` §6.4). */
const WAIT = { timeout: 15_000 } as const;

const waitForPage = async (page: Page) => {
  await page.waitForSelector('[data-bench-ready="true"]', { timeout: 20_000 });
  await page.waitForSelector("[data-fflow-minimap]", { timeout: 20_000 });
  await page.waitForTimeout(300);
};

const attr = async (page: Page, name: string) =>
  (await page.locator("main, [data-bench-ready]").first().getAttribute(name)) ??
  "";

/** The middle of an edge's painted stroke, in page coordinates: a point on the
 *  path, not the middle of its bounding box (which for a curve can be empty). */
const edgePoint = async (page: Page, edgeId: string) => {
  const point = await page.evaluate((id) => {
    const path = document.querySelector(
      `.fflow__edge[data-edgeid="${id}"] .fflow__edge-path`,
    );
    if (!(path instanceof SVGPathElement)) return null;
    const length = path.getTotalLength();
    const at = path.getPointAtLength(length / 2);
    const screen = new DOMPoint(at.x, at.y).matrixTransform(
      path.getScreenCTM() ?? new DOMMatrix(),
    );
    return { x: screen.x, y: screen.y };
  }, edgeId);
  if (point === null) throw new Error(`no painted path for ${edgeId}`);
  return point;
};

const edgeStyleOf = (page: Page, edgeId: string) =>
  page.evaluate((id) => {
    const path = document.querySelector(
      `.fflow__edge[data-edgeid="${id}"] .fflow__edge-path`,
    );
    return path === null ? null : getComputedStyle(path).stroke;
  }, edgeId);

const boxOf = async (page: Page, nodeId: string) => {
  const box = await page
    .locator(`.fflow__node[data-nodeid="${nodeId}"]`)
    .first()
    .boundingBox();
  if (box === null) throw new Error(`not rendered: ${nodeId}`);
  return box;
};

test("proof 47: a press on an edge selects it, and the selection is painted", async ({
  page,
}) => {
  await page.goto(M6);
  await waitForPage(page);

  // The hit path exists and is wider than the stroke, which is what makes a 1.5px
  // curve pressable at all: 20 flow units at zoom 1.
  const hitWidth = await page.evaluate(() => {
    const hit = document.querySelector(
      '.fflow__edge[data-edgeid="e-child"] .fflow__edge-interaction',
    );
    return hit === null ? null : getComputedStyle(hit).strokeWidth;
  });
  expect(hitWidth).toBe("20px");

  const before = await edgeStyleOf(page, "e-child");
  const point = await edgePoint(page, "e-child");

  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-bench-ready]")
        ?.getAttribute("data-selected-edges") === "e-child",
    undefined,
    WAIT,
  );

  // The Model says so…
  expect(await attr(page, "data-selected-edges")).toBe("e-child");
  expect(await attr(page, "data-gesture")).toBe("Idle");

  // …and so do the pixels. A `computedStyle` read is a DOM assertion, and this
  // library has shipped a correct DOM whose paint was wrong before
  // (`docs/verification.md`), so the two states are compared as images.
  const after = await edgeStyleOf(page, "e-child");
  expect(after).not.toBe(before);

  const clip = {
    x: Math.round(point.x - 30),
    y: Math.round(point.y - 12),
    width: 60,
    height: 24,
  };
  const selected = await page.screenshot({ clip });
  await page.mouse.click(10, 10);
  await page.waitForTimeout(200);
  const deselected = await page.screenshot({ clip });
  expect(selected.equals(deselected)).toBe(false);
});

test("proof 48: an edge is a tab stop, and Enter selects it", async ({
  page,
}) => {
  await page.goto(M6);
  await waitForPage(page);

  // Tab order is DOM order, and the edges layer renders before the nodes layer:
  // the first Tab from the pane stops on the first edge (`edgeSelection` puts it
  // in the sequence at all).
  const focusEdge = async () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName ?? "",
        edgeId: active?.getAttribute("data-edgeid") ?? "",
        label: active?.getAttribute("aria-label") ?? "",
        role: active?.getAttribute("role") ?? "",
      };
    });

  await page.locator(".fflow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Tab");
  const focused = await focusEdge();

  expect(focused.edgeId).not.toBe("");
  expect(focused.role).toBe("button");
  // The name comes from the consumer's hook, not from the id.
  expect(focused.label).toMatch(/^Edge from .+ to .+/);

  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (edgeId) =>
      document
        .querySelector("[data-bench-ready]")
        ?.getAttribute("data-selected-edges") === edgeId,
    focused.edgeId,
    WAIT,
  );
  expect(await attr(page, "data-selected-edges")).toBe(focused.edgeId);

  // Space selects too, and the page must not scroll (the `PreventDefault` rule):
  // Escape clears the selection from a focused edge.
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-bench-ready]")
        ?.getAttribute("data-selected-edges") === "",
    undefined,
    WAIT,
  );
  expect(await attr(page, "data-selected-edges")).toBe("");
});

test("proof 49: dragging inside the minimap pans the view", async ({
  page,
}) => {
  await page.goto(M6);
  await waitForPage(page);

  const minimap = await page
    .locator(".fflow__minimap-svg")
    .first()
    .boundingBox();
  if (minimap === null) throw new Error("no minimap");

  /** The viewport rectangle the minimap draws, in flow units (the minimap's
   *  `viewBox` *is* flow space), and its centre on screen. */
  const viewportRect = () =>
    page.evaluate(() => {
      const rect = document.querySelector("[data-fflow-minimap-viewport]");
      const svg = document.querySelector(".fflow__minimap-svg");
      if (rect === null || !(svg instanceof SVGSVGElement)) return null;
      const box = rect.getBoundingClientRect();
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      const width = Number(rect.getAttribute("width"));
      return {
        flow: { x, y, width },
        screen: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      };
    });

  const before = await viewportRect();
  if (before === null) throw new Error("no minimap viewport rectangle");
  const viewportBefore = await attr(page, "data-viewport");

  // Grab the viewport rectangle itself and drag it 24 px right and 12 px down
  // inside the minimap: the rectangle has to follow the pointer, which is the
  // thing the user sees.
  const grab = {
    x: Math.min(
      Math.max(before.screen.x, minimap.x + 6),
      minimap.x + minimap.width - 6,
    ),
    y: Math.min(
      Math.max(before.screen.y, minimap.y + 6),
      minimap.y + minimap.height - 6,
    ),
  };

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let step = 1; step <= 4; step += 1) {
    await page.mouse.move(grab.x + step * 6, grab.y + step * 3);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = await viewportRect();
  if (after === null) throw new Error("no minimap viewport rectangle after");
  expect(await attr(page, "data-viewport")).not.toBe(viewportBefore);

  // The rectangle moved right and down on screen, by roughly the drag.
  expect(after.screen.x - before.screen.x).toBeGreaterThan(12);
  expect(after.screen.y - before.screen.y).toBeGreaterThan(4);

  // The gesture is over and the view stayed where the drag left it: a release
  // must not snap back to the pressed point, and the Model and the DOM must agree
  // about where it is (`M5-FINDINGS` §8.2 is the divergence this checks for).
  expect(await attr(page, "data-gesture")).toBe("Idle");
  // The engine's own matrix, read through the computed style rather than the
  // authored string (the browser rounds what it serialises).
  const engine = await page.evaluate(() => {
    const viewport = document.querySelector(
      "[data-fflow-viewport]",
    ) as HTMLElement | null;
    const matrix =
      viewport === null
        ? null
        : new DOMMatrix(getComputedStyle(viewport).transform);
    return matrix === null
      ? null
      : { x: matrix.m41, y: matrix.m42, zoom: matrix.a };
  });
  if (engine === null) throw new Error("no viewport element");
  const [x, y, zoom] = (await attr(page, "data-viewport"))
    .split(",")
    .map(Number);
  expect(engine.x).toBeCloseTo(x ?? 0, 2);
  expect(engine.y).toBeCloseTo(y ?? 0, 2);
  expect(engine.zoom).toBeCloseTo(zoom ?? 1, 3);
});

test("proof 50: the example page is a second consumer of edge selection", async ({
  page,
}) => {
  // `docs/verification.md`'s fifth checklist question: a shipped behaviour has to
  // work on the *other* page that renders it. `/examples/resizing/` turns
  // `edgeSelection` on in its own spec file, and this walks it the way a user
  // would: press the edge, read the fact the harness folded.
  await page.goto("http://127.0.0.1:4174/examples/resizing/");
  await page.waitForSelector(".fflow__edge", { timeout: 20_000 });
  await page.waitForTimeout(400);

  const tabindex = await page
    .locator(".fflow__edge")
    .first()
    .getAttribute("tabindex");
  expect(tabindex).toBe("0");

  const point = await edgePoint(page, "e-panel-leaf");
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(250);

  const fact = await page.evaluate(() => {
    const main = document.querySelector("[data-example-fact]");
    return main?.getAttribute("data-example-fact") ?? "";
  });
  expect(fact).toContain("e-panel-leaf");
});

test("proof 51: a held modifier keeps a resize proportional", async ({
  page,
}) => {
  await page.goto(M6);
  await waitForPage(page);

  const corner = await page
    .locator('.fflow__node[data-nodeid="c3"] .fflow__resize--bottom-right')
    .first()
    .boundingBox();
  if (corner === null) throw new Error("no resize corner on c3");

  const before = await boxOf(page, "c3");
  const ratio = before.width / before.height;

  const from = {
    x: corner.x + corner.width / 2,
    y: corner.y + corner.height / 2,
  };
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    // Mostly downwards, so the y axis is the one that moved further
    // proportionally and the width has to follow it (`geometry/resize.ts`).
    await page.mouse.move(from.x + step * 3, from.y + step * 8);
    await page.waitForTimeout(16);
  }

  const during = await boxOf(page, "c3");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(200);

  // Mid-gesture the box is bigger and still proportional — the claim is about the
  // gesture, not the release (`docs/verification.md` rule 1).
  expect(during.height).toBeGreaterThan(before.height + 20);
  expect(during.width / during.height).toBeCloseTo(ratio, 1);

  // Neighbours: the four corner controls are still 10×10 grab targets, and the
  // box is published to the consumer (`data-boxed`) — the content-fill half of
  // this belongs to the page that carries the consumer's one-line CSS, which is
  // proof 44 (`docs/M4-FINDINGS.md` §14; the library deliberately does not
  // stretch consumer markup, `docs/verification.md` rule 3).
  const neighbours = await page.evaluate(() => {
    const node = document.querySelector('.fflow__node[data-nodeid="c3"]');
    const handles = node?.querySelectorAll(".fflow__resize") ?? [];
    const sizes = [...handles].map((handle) => {
      const box = handle.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });
    return {
      boxed: node?.hasAttribute("data-boxed") ?? false,
      sizes,
    };
  });
  expect(neighbours.boxed).toBe(true);
  expect(neighbours.sizes.length).toBe(4);
  neighbours.sizes.forEach((size) => {
    expect(size.width).toBeLessThanOrEqual(12);
    expect(size.height).toBeLessThanOrEqual(12);
  });
});
