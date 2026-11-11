import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEMO = "http://127.0.0.1:4174/";

const WAIT = { timeout: 15_000 } as const;

const attr = async (page: Page, name: string) =>
  (await page.locator("main.app").getAttribute(name)) ?? "";

const waitForMount = async (page: Page) => {
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main.app");
      return (
        main?.getAttribute("data-measured-nodes") === "625" &&
        main?.getAttribute("data-pane-mounts") === "1"
      );
    },
    undefined,
    WAIT,
  );
};

const viewportOf = async (page: Page) => {
  const [x, y, zoom] = (await attr(page, "data-viewport"))
    .split(",")
    .map(Number);
  return { x: x ?? 0, y: y ?? 0, zoom: zoom ?? 1 };
};

const viewportStyle = (page: Page) =>
  page
    .locator("[data-fflow-viewport]")
    .getAttribute("style")
    .then(
      (style) =>
        /translate\([^)]*\)\s*scale\([^)]*\)/.exec(style ?? "")?.[0] ?? "",
    );

const nodeTranslate = (page: Page, nodeId: string) =>
  page
    .evaluate(
      (id) =>
        document
          .querySelector(`.fflow__node[data-nodeid="${id}"]`)
          ?.getAttribute("style") ?? "",
      nodeId,
    )
    .then((style) => /translate\([^)]*\)/.exec(style)?.[0] ?? "");

const nodeCenter = async (page: Page, nodeId: string) => {
  const box = await page
    .locator(`.fflow__node[data-nodeid="${nodeId}"]`)
    .first()
    .boundingBox();
  if (box === null) throw new Error(`node not found: ${nodeId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A point on the node's own wrapper rather than on the focusable content inside
 *  it: pressing a node's label focuses the node, pressing its input focuses the
 *  input. */
const nodeBodySelectPoint = async (page: Page, nodeId: string) => {
  const box = await page
    .locator(`.fflow__node[data-nodeid="${nodeId}"]`)
    .first()
    .boundingBox();
  if (box === null) throw new Error(`node not found: ${nodeId}`);
  return { x: box.x + 20, y: box.y + box.height / 2 };
};

const paneBox = async (page: Page) => {
  const box = await page.locator(".fflow__pane").first().boundingBox();
  if (box === null) throw new Error("pane not found");
  return box;
};

/** Reads a property of the chrome element's inline style, which is what carries
 *  the transform-awareness claim (a computed style would also match, but the
 *  inline value is the one `view` wrote). */
const chromeStyle = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (element, name) => (element as HTMLElement).style.getPropertyValue(name),
      property,
    );

/** "12px 34px" → [12, 34]. The browser normalizes the inline value it stores
 *  (six significant digits), so every comparison here is numeric with a
 *  tolerance rather than a string equality. */
const pairOf = (value: string): [number, number] => {
  const [first, second] = value.split(" ").map((part) => parseFloat(part));
  if (
    first === undefined ||
    second === undefined ||
    Number.isNaN(first) ||
    Number.isNaN(second)
  ) {
    throw new Error(`unparsable pair: ${value}`);
  }
  return [first, second];
};

/** One pan over the empty top-left corner of the pane, which is outside the
 *  graph at the demo's initial viewport (proof 16's press point). */
const panFrom = async (page: Page, steps: number) => {
  const box = await paneBox(page);
  const x = box.x + 8;
  const y = box.y + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(x + step * 8, y + step * 5);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
};

test("proof 22: the background pattern moves with the viewport", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = {
    position: await chromeStyle(
      page,
      "[data-fflow-background]",
      "background-position",
    ),
    size: await chromeStyle(page, "[data-fflow-background]", "background-size"),
    viewport: await viewportOf(page),
  };

  // The initial pattern is written from the initial viewport, so the two agree
  // before anything moves.
  const [posX, posY] = pairOf(before.position);
  expect(posX).toBeCloseTo(before.viewport.x, 3);
  expect(posY).toBeCloseTo(before.viewport.y, 3);
  const [sizeX, sizeY] = pairOf(before.size);
  expect(sizeX).toBeCloseTo(20 * before.viewport.zoom, 3);
  expect(sizeY).toBeCloseTo(20 * before.viewport.zoom, 3);

  await panFrom(page, 8);

  const after = {
    position: await chromeStyle(
      page,
      "[data-fflow-background]",
      "background-position",
    ),
    viewport: await viewportOf(page),
  };

  // A scripted gesture has to be shown to have moved something: the viewport
  // moved, and the pattern moved with it.
  expect(after.viewport.x).not.toBe(before.viewport.x);
  const [movedX, movedY] = pairOf(after.position);
  expect(movedX).toBeCloseTo(after.viewport.x, 3);
  expect(movedY).toBeCloseTo(after.viewport.y, 3);
  expect(after.position).not.toBe(before.position);

  // The pattern is not inside the transformed viewport, so zooming cannot scale
  // the dots twice.
  const insideViewport = await page.evaluate(
    () =>
      document.querySelector(
        "[data-fflow-viewport] [data-fflow-background]",
      ) !== null,
  );
  expect(insideViewport).toBe(false);

  // ...and the pitch follows the zoom. The point is over the graph but clear of
  // the minimap and the controls, so the wheel is a pane wheel.
  const box = await paneBox(page);
  await page.mouse.move(box.x + box.width - 80, box.y + 150);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(250);

  const zoomed = await viewportOf(page);
  expect(zoomed.zoom).not.toBe(after.viewport.zoom);
  const [zoomedPitch] = pairOf(
    await chromeStyle(page, "[data-fflow-background]", "background-size"),
  );
  expect(zoomedPitch).toBeCloseTo(20 * zoomed.zoom, 3);
});

test("proof 23: the zoom controls move the viewport and stop at its bounds", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = await viewportOf(page);
  await page.locator('[data-fflow-control="ZoomIn"]').click();
  await page.waitForTimeout(200);

  const zoomedIn = await viewportOf(page);
  expect(zoomedIn.zoom).toBeGreaterThan(before.zoom);
  // The engine was synced, not just the Model: the transform is the engine's.
  expect(await viewportStyle(page)).toContain(`scale(${zoomedIn.zoom})`);

  // Press until the bound. The Model's `maxZoom` is 2 and one press is ×1.2, so
  // this cannot overshoot no matter how many presses land.
  for (let press = 0; press < 12; press += 1) {
    await page.locator('[data-fflow-control="ZoomIn"]').click();
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(250);
  const atMax = await viewportOf(page);
  expect(atMax.zoom).toBe(2);

  // One more press changes nothing at all: not the Model, not the transform.
  const transformAtMax = await viewportStyle(page);
  await page.locator('[data-fflow-control="ZoomIn"]').click();
  await page.waitForTimeout(200);
  expect(await viewportOf(page)).toEqual(atMax);
  expect(await viewportStyle(page)).toBe(transformAtMax);

  await page.locator('[data-fflow-control="ZoomOut"]').click();
  await page.waitForTimeout(200);
  expect((await viewportOf(page)).zoom).toBeLessThan(2);
});

test("proof 24: fit view fits the graph into the pane", async ({ page }) => {
  await page.goto(DEMO);
  await waitForMount(page);

  // Start deliberately wrong: zoomed in far past the point where the whole graph
  // is visible.
  for (let press = 0; press < 3; press += 1) {
    await page.locator('[data-fflow-control="ZoomIn"]').click();
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(200);

  const before = await viewportOf(page);
  const beforeStyle = await viewportStyle(page);
  const beforeVisible = await page.evaluate(() => {
    const pane = document
      .querySelector(".fflow__pane")
      ?.getBoundingClientRect();
    const nodes = [...document.querySelectorAll(".fflow__node")];
    if (pane === undefined) return 0;
    return nodes.filter((node) => {
      const box = node.getBoundingClientRect();
      return box.right > pane.left && box.left < pane.right;
    }).length;
  });

  await page.locator('[data-fflow-control="FitView"]').click();
  await page.waitForFunction(
    (previousZoom) => {
      const zoom = Number(
        (
          document.querySelector("main.app")?.getAttribute("data-viewport") ??
          "0,0,1"
        )
          .split(",")
          .map(Number)[2] ?? 0,
      );
      return Math.abs(zoom - previousZoom) > 1e-6;
    },
    before.zoom,
    WAIT,
  );
  await page.waitForTimeout(200);

  const after = await viewportOf(page);
  expect(after).not.toEqual(before);
  expect(await viewportStyle(page)).not.toBe(beforeStyle);

  // The whole graph now fits: every node's box is inside the pane, and far more
  // of them are than before.
  const fitted = await page.evaluate(() => {
    const pane = document
      .querySelector(".fflow__pane")
      ?.getBoundingClientRect();
    const nodes = [...document.querySelectorAll(".fflow__node")];
    if (pane === undefined) return { inside: 0, outside: 0 };
    let outside = 0;
    nodes.forEach((node) => {
      const box = node.getBoundingClientRect();
      const isInside =
        box.left >= pane.left - 1 &&
        box.top >= pane.top - 1 &&
        box.right <= pane.right + 1 &&
        box.bottom <= pane.bottom + 1;
      if (!isInside) outside += 1;
    });
    return { inside: nodes.length - outside, outside };
  });

  expect(fitted.outside).toBe(0);
  expect(fitted.inside).toBeGreaterThan(beforeVisible);
});

test("proof 25: pressing a control neither pans nor clears the selection", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const centre = await nodeCenter(page, "n0");
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(80);
  expect(await attr(page, "data-selected-nodes")).toBe("n0");

  const transformBefore = await viewportStyle(page);
  const controlBox = await page
    .locator('[data-fflow-control="ZoomOut"]')
    .boundingBox();
  if (controlBox === null) throw new Error("zoom-out control not found");

  // A drag that starts on a control: if the pane's d3 filter saw it, this would
  // pan the viewport. A plain click would not, which is why the press is a drag.
  const x = controlBox.x + controlBox.width / 2;
  const y = controlBox.y + controlBox.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x + step * 7, y + step * 5);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  expect(await viewportStyle(page)).toBe(transformBefore);
  // The pane's own handler declined the press, so the selection is still n0 and
  // the drag did not become a node drag either.
  expect(await attr(page, "data-selected-nodes")).toBe("n0");
  expect(await attr(page, "data-gesture")).toBe("Idle");
});

test("proof 26: the minimap draws the graph and its viewport rectangle", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const rectCount = await page
    .locator(".fflow__minimap .fflow__minimap-node")
    .count();
  expect(rectCount).toBe(625);

  const pane = await paneBox(page);
  const viewport = await viewportOf(page);
  const rectBefore = await page
    .locator("[data-fflow-minimap-viewport]")
    .evaluate((rect) => ({
      x: Number(rect.getAttribute("x")),
      y: Number(rect.getAttribute("y")),
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
    }));

  // The rectangle is the pane in flow space (`viewportRect`), not the culling
  // region, which is three screens wide and would be a third of this.
  expect(rectBefore.width).toBeCloseTo(pane.width / viewport.zoom, 3);
  expect(rectBefore.height).toBeCloseTo(pane.height / viewport.zoom, 3);
  expect(rectBefore.x).toBeCloseTo(-viewport.x / viewport.zoom, 3);
  expect(rectBefore.y).toBeCloseTo(-viewport.y / viewport.zoom, 3);

  await panFrom(page, 8);

  const panned = await viewportOf(page);
  expect(panned.x).not.toBe(viewport.x);

  const rectAfter = await page
    .locator("[data-fflow-minimap-viewport]")
    .evaluate((rect) => ({
      x: Number(rect.getAttribute("x")),
      y: Number(rect.getAttribute("y")),
    }));
  expect(rectAfter.x).toBeCloseTo(-panned.x / panned.zoom, 3);
  expect(rectAfter.x).not.toBeCloseTo(rectBefore.x, 3);
});

test("proof 27: nodes are focusable, and arrow keys nudge the focused one", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  // Pressing a node focuses it: the wrapper is the tab stop. The press lands on
  // the node's own label, because a press on the input inside it focuses the
  // input instead — which is what the next proof is about.
  const body = await nodeBodySelectPoint(page, "n0");
  await page.mouse.click(body.x, body.y);
  await page.waitForTimeout(80);

  const focused = await page.evaluate(
    () =>
      (document.activeElement as HTMLElement | null)?.getAttribute(
        "data-nodeid",
      ) ?? "",
  );
  expect(focused).toBe("n0");
  expect(
    await page.locator('.fflow__node[data-nodeid="n0"]').evaluate((node) => ({
      role: node.getAttribute("role"),
      label: node.getAttribute("aria-label"),
      pressed: node.getAttribute("aria-pressed"),
      tabindex: node.getAttribute("tabindex"),
    })),
  ).toEqual({
    role: "button",
    label: "Node 0",
    pressed: "true",
    tabindex: "0",
  });

  // One arrow press is one pixel, and one OutMessage the demo folds.
  const before = await nodeTranslate(page, "n0");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(120);
  const afterOne = await nodeTranslate(page, "n0");
  expect(afterOne).not.toBe(before);

  const position = (translate: string) => {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(translate);
    if (match === null) throw new Error(`unparsable transform: ${translate}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  };
  expect(position(afterOne).x - position(before).x).toBeCloseTo(1, 5);
  expect(position(afterOne).y).toBeCloseTo(position(before).y, 5);

  // Shift is the larger step.
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(120);
  const afterShift = await nodeTranslate(page, "n0");
  expect(position(afterShift).y - position(afterOne).y).toBeCloseTo(10, 5);

  // Tab cycles to the next focusable inside the pane, which is the next node's
  // own focusable content — the tab order is the DOM's, not a Model array.
  await page.keyboard.press("Tab");
  const afterTab = await page.evaluate(
    () =>
      (document.activeElement as HTMLElement | null)
        ?.closest("[data-nodeid]")
        ?.getAttribute("data-nodeid") ?? "",
  );
  expect(afterTab).toBe("n0");
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.getAttribute(
          "data-nodeid",
        ) ?? "",
    ),
  ).toBe("n0");
});

test("proof 28: an input or a no-key region does not nudge the graph", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = await nodeTranslate(page, "n0");

  // A text input inside a node: typing arrows must move the caret, not the node.
  // `focus()` rather than `click()`: this proof is about the keyboard guard, and
  // a click would also test the pointer layer for no extra claim.
  const input = page.locator('.fflow__node[data-nodeid="n0"] input').first();
  await input.focus();
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).toBe(
    "INPUT",
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(120);
  expect(await nodeTranslate(page, "n0")).toBe(before);

  // The explicit `.fflow__nokey` opt-out, focused directly.
  await page
    .locator('.fflow__node[data-nodeid="n0"] .fflow__nokey')
    .first()
    .focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(120);
  expect(await nodeTranslate(page, "n0")).toBe(before);

  // The guard is the *target*, not the focus: with the node wrapper focused the
  // same key does nudge, so the proof above was not measuring a broken listener.
  const body = await nodeBodySelectPoint(page, "n0");
  await page.mouse.click(body.x, body.y);
  await page.waitForTimeout(80);
  expect(
    await page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.getAttribute(
          "data-nodeid",
        ) ?? "",
    ),
  ).toBe("n0");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(120);
  expect(await nodeTranslate(page, "n0")).not.toBe(before);
});

test("proof 29: the description lists the graph and does not churn on a pan", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const description = page.locator("[data-fflow-description]");
  await expect(description).toHaveCount(1);

  const text = (await description.textContent()) ?? "";
  // The demo's grid links every step except every third one (416 of 624).
  expect(text).toContain("Flow graph: 625 nodes and 416 connections.");
  expect(text).toContain("Node 1 of 625: Node 0, connects to Node 1.");
  // Capped, and honest about it.
  expect(text).toContain("575 more nodes are not listed.");

  // Visually hidden but in the accessibility tree: a 1×1 box, not `display:none`.
  const box = await description.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(1);
  expect(box?.height ?? 0).toBeLessThanOrEqual(1);
  expect(
    await description.evaluate(
      (element) => getComputedStyle(element).display === "none",
    ),
  ).toBe(false);

  // A pan changes the viewport 60 times a second and must produce no DOM work in
  // the description: it lists nodes and connections, not the view. The observer
  // is installed before the gesture and read after it.
  await page.evaluate(() => {
    const region = document.querySelector("[data-fflow-description]");
    const counter = { mutations: 0 };
    (
      window as unknown as { __descriptionMutations: typeof counter }
    ).__descriptionMutations = counter;
    if (region === null) return;
    new MutationObserver((records) => {
      counter.mutations += records.length;
    }).observe(region, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });

  const viewportBefore = await viewportOf(page);
  await panFrom(page, 10);

  const mutations = await page.evaluate(
    () =>
      (window as unknown as { __descriptionMutations?: { mutations: number } })
        .__descriptionMutations?.mutations ?? 0,
  );
  expect(mutations).toBe(0);

  // The gesture did move the viewport, so the observer was watching a live tree
  // rather than a pane nothing happened to.
  const viewportAfter = await viewportOf(page);
  expect(viewportAfter.x).not.toBe(viewportBefore.x);
  expect((await description.textContent()) ?? "").toBe(text);
});

test("proof 29b: the description follows a graph change at commit rate", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const centre = await nodeCenter(page, "n0");
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(80);

  await page.locator("#delete-selection").click();
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-nodes") === "624",
    undefined,
    WAIT,
  );

  const text =
    (await page.locator("[data-fflow-description]").textContent()) ?? "";
  expect(text).toContain("Flow graph: 624 nodes and");
  expect(text).not.toContain("Node 1 of 625");
});

test("proof 30: a consumer panel is chrome, not an empty pane press", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const centre = await nodeCenter(page, "n0");
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(80);
  expect(await attr(page, "data-selected-nodes")).toBe("n0");

  const transformBefore = await viewportStyle(page);
  const panelBox = await page
    .locator('[data-fflow-panel="TopRight"]')
    .boundingBox();
  if (panelBox === null) throw new Error("panel not found");

  // A press on the panel's padding: not the button, so it is a bare press inside
  // the pane. Without the chrome guard it would clear the selection.
  const x = panelBox.x + panelBox.width - 4;
  const y = panelBox.y + 4;
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);

  expect(await attr(page, "data-selected-nodes")).toBe("n0");
  expect(await viewportStyle(page)).toBe(transformBefore);

  // The panel's own button dispatches a parent Message, not a flow Message.
  await page.locator("#panel-select-all").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("main.app")
        ?.getAttribute("data-selected-nodes")
        ?.split(",").length === 625,
    undefined,
    WAIT,
  );
});

test("proof 31: Enter and Space activate the focused node", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  // Focus the node by pressing its own label: a press on the input inside it
  // would focus the input instead.
  const body = await nodeBodySelectPoint(page, "n0");
  await page.mouse.click(body.x, body.y);
  await page.waitForTimeout(80);
  expect(await attr(page, "data-selected-nodes")).toBe("n0");
  const before = await nodeTranslate(page, "n0");

  // Shift+Enter toggles it off, which is the state `aria-pressed` claims.
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(120);
  expect(await attr(page, "data-selected-nodes")).toBe("");
  expect(
    await page
      .locator('.fflow__node[data-nodeid="n0"]')
      .evaluate((node) => node.getAttribute("aria-pressed")),
  ).toBe("false");

  // Space turns it back on...
  await page.keyboard.press(" ");
  await page.waitForTimeout(120);
  expect(await attr(page, "data-selected-nodes")).toBe("n0");

  // ...without moving the node: activation is not a nudge.
  expect(await nodeTranslate(page, "n0")).toBe(before);
  expect(await attr(page, "data-gesture")).toBe("Idle");

  // Space in a node's text input types a space and activates nothing.
  const input = page.locator('.fflow__node[data-nodeid="n0"] input').first();
  await input.focus();
  await page.waitForTimeout(80);
  await page.keyboard.type("a b");
  await page.waitForTimeout(120);
  expect(await input.inputValue()).toBe("a b");
  expect(await attr(page, "data-selected-nodes")).toBe("n0");

  // With focus outside every node the key keeps its default action: Enter on a
  // focused control button is the button's click (the viewport zooms), and no
  // node gets selected by it.
  await page.locator('[data-fflow-control="ZoomIn"]').focus();
  await page.waitForTimeout(80);
  const zoomBefore = (await viewportOf(page)).zoom;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  expect((await viewportOf(page)).zoom).toBeGreaterThan(zoomBefore);
  expect(await attr(page, "data-selected-nodes")).toBe("n0");
});

test("proof 32: the connection preview follows the pointer", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const out = await page
    .locator(
      '.fflow__node[data-nodeid="n0"] .fflow__handle[data-handleid="out"]',
    )
    .boundingBox();
  if (out === null) throw new Error("source handle not found");
  const from = { x: out.x + out.width / 2, y: out.y + out.height / 2 };

  // A free point: no handle, so the preview ends at the pointer.
  const to = { x: from.x + 140, y: from.y + 90 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 6,
      from.y + ((to.y - from.y) * step) / 6,
    );
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);

  // Where the preview actually is on screen: the path's own end, taken through
  // its screen CTM. The layer is a sibling of the transformed viewport, so a
  // preview drawn at raw flow coordinates lands far above the pointer — which at
  // this viewport (y 200, zoom 0.9) is the bug this pins.
  const end = await page.evaluate(() => {
    const path = document.querySelector(
      ".fflow__connection path",
    ) as SVGPathElement | null;
    if (path === null) return null;
    const matrix = path.getScreenCTM();
    if (matrix === null) return null;
    const point = path.getPointAtLength(path.getTotalLength());
    const onScreen = point.matrixTransform(matrix);
    return { x: onScreen.x, y: onScreen.y };
  });
  if (end === null) throw new Error("no connection preview");

  expect(Math.abs(end.x - to.x)).toBeLessThan(3);
  expect(Math.abs(end.y - to.y)).toBeLessThan(3);

  // ...and the same point is nowhere near the raw flow coordinate, which is the
  // shape the bug had.
  const flowCoordinate = await page.evaluate(() => {
    const viewport = (
      document.querySelector("main.app")?.getAttribute("data-viewport") ??
      "0,0,1"
    )
      .split(",")
      .map(Number);
    const pane = document
      .querySelector(".fflow__pane")
      ?.getBoundingClientRect();
    return {
      left: pane?.left ?? 0,
      top: pane?.top ?? 0,
      x: viewport[0] ?? 0,
      y: viewport[1] ?? 0,
      zoom: viewport[2] ?? 1,
    };
  });
  const untransformedY =
    flowCoordinate.top +
    (to.y - flowCoordinate.top - flowCoordinate.y) / flowCoordinate.zoom;
  expect(Math.abs(end.y - untransformedY)).toBeGreaterThan(20);

  await page.mouse.up();
  await page.waitForTimeout(150);
});

test("proof 33: a rejected duplicate is visible, and a novel connection still lands", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const handleCenter = async (nodeId: string, handleId: string) => {
    const box = await page
      .locator(
        `.fflow__node[data-nodeid="${nodeId}"] .fflow__handle[data-handleid="${handleId}"]`,
      )
      .boundingBox();
    if (box === null)
      throw new Error(`handle not found: ${nodeId}/${handleId}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  const dragTo = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / 8,
        from.y + ((to.y - from.y) * step) / 8,
      );
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(120);
    const target = await attr(page, "data-connection-target");
    await page.mouse.up();
    await page.waitForTimeout(200);
    return target;
  };

  const edges = Number(await attr(page, "data-edges"));
  const n0out = await handleCenter("n0", "out");

  // The fixture already connects every neighbour, so this is a duplicate: the
  // parent's `isValidConnection` rejects it and the library emits nothing. The
  // point is that the demo now says so instead of looking broken.
  expect(await dragTo(n0out, await handleCenter("n1", "in"))).toBe("n1:in");
  expect(await attr(page, "data-edges")).toBe(String(edges));
  expect(await attr(page, "data-last-edge")).toBe("");
  expect(await attr(page, "data-last-attempt")).toBe("n0:out > n1:in");
  // The panel is next to the gesture, so it is where "nothing happened" is
  // explained: a rejected release emits no fact to react to.
  expect((await page.locator("#panel-attempt").textContent()) ?? "").toContain(
    "Not connected: n0:out > n1:in",
  );

  // A pair that is not already an edge goes through, and the indicator clears.
  expect(await dragTo(n0out, await handleCenter("n2", "in"))).toBe("n2:in");
  expect(await attr(page, "data-edges")).toBe(String(edges + 1));
  expect(await attr(page, "data-last-edge")).toBe("n0:out>n2:in");
  expect(await attr(page, "data-last-attempt")).toBe("");
  expect((await page.locator("#panel-attempt").textContent()) ?? "").toContain(
    "Drag a handle onto another node to connect.",
  );
});

test("proof 34: dragging does not select the page's text", async ({ page }) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const out = await page
    .locator(
      '.fflow__node[data-nodeid="n0"] .fflow__handle[data-handleid="out"]',
    )
    .boundingBox();
  const label = await page
    .locator('.fflow__node[data-nodeid="n1"] .node-label')
    .boundingBox();
  if (out === null || label === null) throw new Error("boxes missing");

  const from = { x: out.x + out.width / 2, y: out.y + out.height / 2 };
  const to = { x: label.x + label.width / 2, y: label.y + label.height / 2 };

  // A connection gesture dragged straight across another node's label: without
  // `user-select: none` on the pane the browser highlights the text and the
  // selection grows under the pointer for the length of the drag.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 8,
      from.y + ((to.y - from.y) * step) / 8,
    );
    await page.waitForTimeout(20);
  }
  expect(
    await page.evaluate(() => window.getSelection()?.toString() ?? ""),
  ).toBe("");

  await page.mouse.up();
  await page.waitForTimeout(100);

  // The opt-out is the pane, not the node: a text input inside a node keeps its
  // own selection, or the note field would be unusable.
  expect(
    await page
      .locator('.fflow__node[data-nodeid="n0"] input')
      .first()
      .evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("text");
});

test("proof 35: a release near a handle connects, not only an exact hit", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const edges = Number(await attr(page, "data-edges"));
  const out = await page
    .locator(
      '.fflow__node[data-nodeid="n0"] .fflow__handle[data-handleid="out"]',
    )
    .boundingBox();
  const target = await page
    .locator(
      '.fflow__node[data-nodeid="n3"] .fflow__handle[data-handleid="in"]',
    )
    .boundingBox();
  if (out === null || target === null) throw new Error("handles missing");

  const from = { x: out.x + out.width / 2, y: out.y + out.height / 2 };
  const handleCentre = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };

  // Release 14 px inside the node, well clear of the 8×8 handle box: this is
  // what "drop it on the node" looks like, and it has to connect.
  const release = { x: handleCentre.x + 14, y: handleCentre.y + 6 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      from.x + ((release.x - from.x) * step) / 8,
      from.y + ((release.y - from.y) * step) / 8,
    );
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);

  // The target is resolved during the drag, before the release.
  expect(await attr(page, "data-connection-target")).toBe("n3:in");

  await page.mouse.up();
  await page.waitForTimeout(250);

  expect(await attr(page, "data-edges")).toBe(String(edges + 1));
  expect(await attr(page, "data-last-edge")).toBe("n0:out>n3:in");
});
