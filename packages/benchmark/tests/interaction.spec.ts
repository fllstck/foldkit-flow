import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEMO = "http://127.0.0.1:4174/";

/** Waits are explicit and short: `page.waitForFunction` defaults to no timeout,
 *  so a selector that never matches would burn the whole 600 s test budget
 *  instead of failing. */
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

// Handles carry `data-nodeid` too (the engine's geometry contract), so node
// selectors are scoped to the node wrapper.
const nodeTransform = (page: Page, nodeId: string) =>
  page.evaluate(
    (id) =>
      document
        .querySelector(`.fflow__node[data-nodeid="${id}"]`)
        ?.getAttribute("style") ?? "",
    nodeId,
  );

/** The transform alone: the hydrated DOM normalizes `top: 0` to `top: 0px`, so a
 *  raw style-string comparison would test the serializer, not the position. */
const nodeTranslate = async (page: Page, nodeId: string) => {
  const style = await nodeTransform(page, nodeId);
  return /translate\([^)]*\)/.exec(style)?.[0] ?? "";
};

const nodeCenter = async (page: Page, nodeId: string) => {
  const box = await page
    .locator(`.fflow__node[data-nodeid="${nodeId}"]`)
    .first()
    .boundingBox();
  if (box === null) throw new Error(`node not found: ${nodeId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const paneBox = async (page: Page) => {
  const box = await page.locator(".fflow__pane").first().boundingBox();
  if (box === null) throw new Error("pane not found");
  return box;
};

test("proof 8: a drag moves the node and commits one position update", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = await nodeTranslate(page, "n0");
  const { x, y } = await nodeCenter(page, "n0");

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(x + step * 6, y + step * 4);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  expect(await attr(page, "data-selected-nodes")).toBe("n0");
  expect(await attr(page, "data-gesture")).toBe("Idle");
  expect(await nodeTranslate(page, "n0")).not.toBe(before);
});

test("proof 9: pointer events from another pointer are ignored", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = await nodeTranslate(page, "n0");
  const { x, y } = await nodeCenter(page, "n0");

  await page.mouse.move(x, y);
  await page.mouse.down();

  // A second pointer (a palm on a touch screen, a second mouse) must not steer
  // the gesture the first one owns.
  await page.evaluate(
    ({ clientX, clientY }) => {
      const pane = document.querySelector(".fflow__pane");
      pane?.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 99,
          pointerType: "touch",
          bubbles: true,
          composed: true,
          clientX,
          clientY,
        }),
      );
    },
    { clientX: x + 400, clientY: y + 300 },
  );
  await page.waitForTimeout(50);

  expect(await attr(page, "data-gesture")).toBe("DraggingNodes");
  expect(await nodeTranslate(page, "n0")).toBe(before);

  await page.mouse.up();
  await page.waitForTimeout(100);
});

test("proof 10: pointercancel drops the overlay without committing a move", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = await nodeTranslate(page, "n0");
  const { x, y } = await nodeCenter(page, "n0");

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x + step * 8, y + step * 6);
    await page.waitForTimeout(16);
  }
  expect(await attr(page, "data-gesture")).toBe("DraggingNodes");

  // The subscription listens on the pane's root (`document` here), which is
  // where a real `pointercancel` from an OS gesture is dispatched.
  await page.evaluate(() => {
    document.dispatchEvent(
      new PointerEvent("pointercancel", {
        pointerId: 1,
        pointerType: "mouse",
        bubbles: true,
        composed: true,
      }),
    );
  });
  await page.waitForTimeout(50);

  expect(await attr(page, "data-gesture")).toBe("Idle");
  // The overlay is gone and nothing was committed, so the node is back.
  expect(await nodeTranslate(page, "n0")).toBe(before);

  await page.mouse.up();
  await page.waitForTimeout(50);
});

test("proof 11: a handle change re-measures without a remount", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = Number(await attr(page, "data-handle-measurements"));

  await page.evaluate(() => {
    const handle = document.querySelector('[data-nodeid="n0"] .fflow__handle');
    handle?.setAttribute("data-handlepos", "Bottom");
  });

  await page.waitForFunction(
    (previous) =>
      Number(
        document
          .querySelector("main.app")
          ?.getAttribute("data-handle-measurements") ?? "0",
      ) > previous,
    before,
    WAIT,
  );

  // A re-measure is not a remount: the pane still has its single Mount.
  expect(await attr(page, "data-pane-mounts")).toBe("1");
  expect(await attr(page, "data-measured-nodes")).toBe("625");
});

test("proof 12: a flow inside a ShadowRoot still drags", async ({ page }) => {
  await page.goto("/shadow.html");
  await page.waitForSelector(".fflow__pane", { timeout: 20_000 });
  await page.waitForTimeout(400);

  const shadowBox = await page.locator("#shadow-host").boundingBox();
  if (shadowBox === null) throw new Error("shadow host not found");

  const box = await page.evaluate(() => {
    const host = document.getElementById("shadow-host");
    const node = host?.shadowRoot?.querySelector(".fflow__node");
    const rect = node?.getBoundingClientRect();
    return rect === undefined
      ? null
      : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (box === null) throw new Error("shadow node not found");

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  const readTransform = () =>
    page.evaluate(() => {
      const host = document.getElementById("shadow-host");
      return (
        host?.shadowRoot
          ?.querySelector(".fflow__node")
          ?.getAttribute("style") ?? null
      );
    });

  const before = await readTransform();

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x + step * 5, y + step * 3);
    await page.waitForTimeout(16);
  }

  expect(await readTransform()).not.toBe(before);

  await page.mouse.up();
  await page.waitForTimeout(100);

  // The pointer listeners had to attach to the ShadowRoot for the press to
  // reach the flow at all; the committed position is the proof they did.
  const after = await page.evaluate(() => {
    const host = document.getElementById("shadow-host");
    return (
      host?.shadowRoot?.querySelector(".fflow__node")?.getAttribute("style") ??
      null
    );
  });
  expect(after).toContain("translate(40px, 40px)");

  const paneId = await page.evaluate(() => {
    const host = document.getElementById("shadow-host");
    return (
      host?.shadowRoot
        ?.querySelector(".fflow__pane")
        ?.getAttribute("data-paneid") ?? null
    );
  });
  expect(paneId).toBe("shadow-pane");
});

test("proof 13: a wheel over .fflow__nowheel does not zoom the pane", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const box = await paneBox(page);
  const before = await attr(page, "data-viewport");

  // The opt-out region inside a node wins over zoom (§4.6).
  const nowheel = await page.locator(".fflow__nowheel").first().boundingBox();
  if (nowheel === null) throw new Error("nowheel region not found");
  await page.mouse.move(
    nowheel.x + nowheel.width / 2,
    nowheel.y + nowheel.height / 2,
  );
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(250);
  expect(await attr(page, "data-viewport")).toBe(before);

  // The pane itself still zooms.
  await page.mouse.move(box.x + box.width - 40, box.y + box.height - 40);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(250);
  expect(await attr(page, "data-viewport")).not.toBe(before);
});

test("proof 14: holding a modifier makes presses additive", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const first = await nodeCenter(page, "n0");
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(50);
  expect(await attr(page, "data-selected-nodes")).toBe("n0");

  // Shift reaches the flow through the modifier subscription, not the pointer
  // event: Foldkit's `OnPointerDown` carries no modifier state.
  await page.keyboard.down("Shift");
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-additive") ===
      "true",
    undefined,
    WAIT,
  );

  const second = await nodeCenter(page, "n1");
  await page.mouse.click(second.x, second.y);
  await page.waitForTimeout(50);
  expect(await attr(page, "data-selected-nodes")).toBe("n0,n1");

  await page.keyboard.up("Shift");
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-additive") ===
      "false",
    undefined,
    WAIT,
  );

  // Without the modifier a press replaces the selection.
  const third = await nodeCenter(page, "n2");
  await page.mouse.click(third.x, third.y);
  await page.waitForTimeout(50);
  expect(await attr(page, "data-selected-nodes")).toBe("n2");
});

test("proof 15: culling renders only the viewport and still drags", async ({
  page,
}) => {
  // `/large.html` is client-only (no hydration) and renders 1k nodes at zoom 1
  // with culling on, so culling and dragging can be checked together without a
  // server/client disagreement about what the first view should contain.
  await page.goto("/large.html");
  await page.waitForSelector(".fflow__pane", { timeout: 20_000 });
  await page.waitForSelector('.fflow__node[data-nodeid="n0"]', {
    timeout: 20_000,
  });
  await page.waitForTimeout(400);

  const rendered = Number(
    await page.locator(".fflow__pane").getAttribute("data-node-count"),
  );
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(1000);

  const node = page.locator('.fflow__node[data-nodeid="n0"]');
  const box = await node.boundingBox();
  if (box === null) throw new Error("node n0 is not rendered");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // Push the pointer far past the overscan. The mouse cannot leave the window,
  // so the drag continues with a synthetic move from the same pointer.
  await page.evaluate(
    ({ clientX, clientY }) => {
      document.querySelector(".fflow__pane")?.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          bubbles: true,
          composed: true,
          clientX,
          clientY,
        }),
      );
    },
    { clientX: box.x + 6000, clientY: box.y },
  );
  await page.waitForTimeout(80);

  // The node keeps its element and its overlay transform for the whole gesture,
  // which is the end-to-end half of the retention rule; the culling filter's own
  // invariant (a node whose *graph* position is outside the region but which is
  // being dragged stays rendered) is pinned in `src/view/culling.test.ts`,
  // because these pages do not commit positions per frame.
  expect(await page.locator('.fflow__node[data-nodeid="n0"]').count()).toBe(1);
  const style = await node.getAttribute("style");
  expect(/translate\([^)]*\)/.exec(style ?? "")?.[0] ?? "").not.toBe(
    "translate(0px, 0px)",
  );

  await page.mouse.up();
  await page.waitForTimeout(100);
});

test("proof 16: dragging a node does not pan the pane", async ({ page }) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const viewportTransform = () =>
    page
      .locator("[data-fflow-viewport]")
      .getAttribute("style")
      .then(
        (style) =>
          /translate\([^)]*\)\s*scale\([^)]*\)/.exec(style ?? "")?.[0] ?? "",
      );

  const before = await viewportTransform();
  const nodeBefore = await nodeTranslate(page, "n0");
  const { x, y } = await nodeCenter(page, "n0");

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x + step * 7, y + step * 5);
    await page.waitForTimeout(16);
  }

  // The press is a node drag, not a pane pan: the viewport transform is
  // untouched while the node's overlay follows the pointer.
  expect(await viewportTransform()).toBe(before);
  expect(await nodeTranslate(page, "n0")).not.toBe(nodeBefore);
  expect(await attr(page, "data-gesture")).toBe("DraggingNodes");

  await page.mouse.up();
  await page.waitForTimeout(100);

  // A drag on empty pane still pans. The top-left corner is outside every node
  // at this viewport, which matters: a press that lands on a node is a node
  // drag, and the whole point here is that the pane still pans where it should.
  const paneBounds = await page.locator(".fflow__pane").first().boundingBox();
  if (paneBounds === null) throw new Error("pane not found");
  const px = paneBounds.x + 10;
  const py = paneBounds.y + 10;
  await page.mouse.move(px, py);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(px + step * 10, py + step * 6);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  expect(await viewportTransform()).not.toBe(before);
});
