import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The example page (M5): `/example/` on the demo's own server.
 *
 * It is a *second consumer* of the library — different node markup, a frame with
 * children, handles on the vertical edges, a panel — so the five-question
 * checklist in `docs/verification.md` is answered here, on the shapes the
 * playground's 630-node fixture does not have. A DOM assertion is not a paint
 * assertion, and an assertion on the library's element is not an assertion on
 * what the consumer sees: the resize check below measures the **consumer's** root
 * against the wrapper, mid-gesture.
 */
const EXAMPLE = "http://127.0.0.1:4174/example/";
const WAIT = { timeout: 20_000 } as const;

const waitForExample = async (page: Page) => {
  await page.waitForFunction(
    () => document.querySelectorAll(".fflow__node").length >= 8,
    undefined,
    WAIT,
  );
  // The opening fit is folded from `ResizedPane`; until it has landed the
  // transform is the placeholder viewport and every screen coordinate is wrong.
  await page.waitForFunction(
    () =>
      document.querySelector(".ex-panel-fact")?.textContent ===
      "Fitted the pipeline",
    undefined,
    WAIT,
  );
  await page.waitForTimeout(200);
};

const fact = (page: Page) =>
  page.evaluate(
    () => document.querySelector(".ex-panel-fact")?.textContent ?? "",
  );

test("the example page renders, drags, collapses and resizes", async ({
  page,
}) => {
  const errors: Array<string> = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The headless browser requests `/favicon.ico` and logs its 404 as a console
    // error with no URL of its own; that is the browser's, not the page's.
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource")
    ) {
      errors.push(message.text());
    }
  });

  await page.goto(EXAMPLE);
  await waitForExample(page);

  // 1. The workflow itself, with the consumer's own markup inside the nodes.
  expect(await page.locator(".fflow__node").count()).toBe(8);
  expect(await page.locator(".fflow__edge").count()).toBe(6);
  expect(
    await page
      .locator('.fflow__node[data-nodeid="deploy"] .ex-node-title')
      .textContent(),
  ).toBe("Deploy");
  // The source beside it is the example's own file, not a copy: the page and its
  // code cannot drift apart.
  expect(await page.locator(".ex-code").textContent()).toContain(
    'const PANE_ID = "pipeline-pane"',
  );

  // `data-nodeid` is on the handles and the resize controls too, so a node is
  // `.fflow__node[data-nodeid]` and nothing looser.

  // 2. A drag is a Message and the fact comes back into the parent's data.
  const commit = page.locator('.fflow__node[data-nodeid="commit"]');
  const before = await commit.boundingBox();
  if (before === null) throw new Error("no Commit node");
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(
      before.x + before.width / 2 + step * 6,
      before.y + before.height / 2,
    );
    await page.waitForTimeout(16);
  }
  const during = await commit.boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await commit.boundingBox();
  if (during === null || after === null)
    throw new Error("Commit node vanished");
  expect(during.x).toBeGreaterThan(before.x + 30);
  expect(after.x).toBeGreaterThan(before.x + 30);
  expect(await fact(page)).toContain("Moved commit");

  // 3. Collapsing is the parent's edit plus `informGraphChanged`: the two checks
  // and all three edges that touch them go, and the frame **stays** as a summary
  // band. A container that vanished would take the affordance with it — that is
  // what `hidden` on the container itself does, and it is the wrong example.
  const qaBefore = await page
    .locator('.fflow__node[data-nodeid="qa"]')
    .boundingBox();
  if (qaBefore === null) throw new Error("no QA frame");

  await page.getByRole("button", { name: "Collapse QA" }).click();
  await page.waitForTimeout(250);

  expect(await page.locator(".fflow__node").count()).toBe(6);
  expect(await page.locator('.fflow__node[data-nodeid="review"]').count()).toBe(
    0,
  );
  expect(await page.locator('.fflow__node[data-nodeid="smoke"]').count()).toBe(
    0,
  );
  // Three edges touch the collapsed subtree — the two into the checks and the one
  // out of Review — so three of six remain ("half an edge is not a smaller edge",
  // M4-FINDINGS §2.3).
  expect(await page.locator(".fflow__edge").count()).toBe(3);

  const qaCollapsed = await page
    .locator('.fflow__node[data-nodeid="qa"]')
    .boundingBox();
  if (qaCollapsed === null) throw new Error("the QA frame disappeared");
  expect(qaCollapsed.height).toBeLessThan(qaBefore.height - 40);
  expect(qaCollapsed.width).toBeCloseTo(qaBefore.width, 0);
  expect(
    await page
      .locator('.fflow__node[data-nodeid="qa"] .ex-node-subtitle')
      .textContent(),
  ).toBe("collapsed · 2 hidden");
  expect(await fact(page)).toContain("Collapsed QA");

  await page.getByRole("button", { name: "Expand QA" }).click();
  await page.waitForTimeout(250);
  expect(await page.locator(".fflow__node").count()).toBe(8);
  expect(await page.locator(".fflow__edge").count()).toBe(6);
  const qaExpanded = await page
    .locator('.fflow__node[data-nodeid="qa"]')
    .boundingBox();
  if (qaExpanded === null) throw new Error("no QA frame after expanding");
  expect(Math.abs(qaExpanded.height - qaBefore.height)).toBeLessThan(2);

  // 4. A resize is visible while the pointer is down, and the consumer's content
  // follows the box — the M4 contract on the second consumer shape.
  const deploy = page.locator('.fflow__node[data-nodeid="deploy"]');
  const box = await deploy.boundingBox();
  if (box === null) throw new Error("no Deploy node");
  const contentBefore = await page
    .locator('.fflow__node[data-nodeid="deploy"] .ex-node')
    .boundingBox();
  const corner = await page
    .locator('[data-nodeid="deploy"] .fflow__resize--bottom-right')
    .boundingBox();
  if (corner === null || contentBefore === null)
    throw new Error("no resize control on Deploy");

  await page.mouse.move(
    corner.x + corner.width / 2,
    corner.y + corner.height / 2,
  );
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(
      corner.x + corner.width / 2 + step * 6,
      corner.y + corner.height / 2 + step * 4,
    );
    await page.waitForTimeout(16);
  }

  const wrapperDuring = await deploy.boundingBox();
  const contentDuring = await page
    .locator('[data-nodeid="deploy"] .ex-node')
    .boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const wrapperAfter = await deploy.boundingBox();

  if (wrapperDuring === null || contentDuring === null || wrapperAfter === null)
    throw new Error("Deploy node vanished during the resize");

  // Width grew while the pointer was down…
  expect(wrapperDuring.width).toBeGreaterThan(box.width + 20);
  // …and the consumer's content grew with it, not only the wrapper. A tolerance
  // for the 1px border on `.ex-node` with `box-sizing: border-box`.
  expect(Math.abs(contentDuring.width - wrapperDuring.width)).toBeLessThan(2);
  expect(contentDuring.width).toBeGreaterThan(contentBefore.width + 20);
  // Persisted: the release reports the box and the parent keeps it.
  expect(await fact(page)).toContain("Resized deploy");
  expect(Math.abs(wrapperAfter.width - wrapperDuring.width)).toBeLessThan(2);

  // The page's own console is clean (the Favicon 404 a headless browser logs is
  // not a page error; `pageerror` and console errors are).
  expect(errors).toEqual([]);
});

/**
 * The reported bug (M5-FINDINGS §8.2): the opening fit is folded from the pane's
 * first measurement, and that measurement used to arrive **before** the pane's
 * registration. `Flow.setViewport` could not emit its `SyncViewport` without a
 * pane id, so the Model (and the DOM, which the view renders from it) moved to the
 * fitted viewport while d3 kept the one it was constructed with — and the first
 * pan applied its delta to that stale transform, shrinking the graph and jumping
 * it left. This asserts the user's layer: press empty pane, drag, and the view must
 * keep the fitted zoom and advance by the drag.
 */
test("a pan continues from the fitted viewport, instead of snapping back", async ({
  page,
}) => {
  await page.goto(EXAMPLE);
  await waitForExample(page);

  const viewportOf = () =>
    page.evaluate(() => {
      const style =
        document
          .querySelector("[data-fflow-viewport]")
          ?.getAttribute("style") ?? "";
      const match = style.match(
        /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/,
      );
      if (match === null) throw new Error(`no transform in "${style}"`);
      return {
        x: Number(match[1]),
        y: Number(match[2]),
        zoom: Number(match[3]),
      };
    });

  const before = await viewportOf();
  // The fit is not the viewport the page was initialised with, or this proof
  // would pass without the fix.
  expect(before.zoom).not.toBeCloseTo(0.6, 2);

  const box = await page.locator(".fflow__pane").boundingBox();
  if (box === null) throw new Error("no pane");
  // Empty pane: below the pipeline, right of the panel, clear of every node.
  const x = box.x + box.width - 60;
  const y = box.y + box.height - 120;

  const stepPx = 8;
  const steps = 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(x + step * stepPx, y + step * stepPx * 0.5);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await viewportOf();
  // The zoom the fit chose survives the gesture — a snap back to the initial
  // viewport is the bug.
  expect(after.zoom).toBeCloseTo(before.zoom, 3);
  // And the view moved by the drag, not to somewhere else.
  expect(after.x - before.x).toBeGreaterThan(steps * stepPx * 0.8);
  expect(after.y - before.y).toBeGreaterThan(steps * stepPx * 0.3);
  expect(Math.abs(after.x - (before.x + steps * stepPx))).toBeLessThan(2);
});
