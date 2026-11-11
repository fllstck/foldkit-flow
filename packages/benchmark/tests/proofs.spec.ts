import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEMO = "http://127.0.0.1:4174/";

const attr = async (page: Page, name: string) =>
  (await page.locator("main.app").getAttribute(name)) ?? "";

const waitForMount = async (page: Page) => {
  await page.waitForFunction(() => {
    const main = document.querySelector("main.app");
    return (
      main?.getAttribute("data-measured-nodes") === "625" &&
      main?.getAttribute("data-pane-mounts") === "1"
    );
  });
};

const styleAttributeOf = (page: Page) =>
  page.locator(".fflow__viewport").getAttribute("style");

type Transform = { x: number; y: number; zoom: number };

const parseTransform = (style: string | null): Transform | null => {
  const match = style?.match(
    /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/,
  );
  return match === null || match === undefined
    ? null
    : { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
};

const installViewportRecorder = (page: Page) =>
  page.evaluate(() => {
    const target = document.querySelector("[data-fflow-viewport]");
    const changes: Array<string | null> = [];
    (
      window as unknown as { __viewportStyles: typeof changes }
    ).__viewportStyles = changes;
    new MutationObserver(() => {
      changes.push(target?.getAttribute("style") ?? null);
    }).observe(target as Element, {
      attributes: true,
      attributeFilter: ["style"],
    });
  });

const recordedTransforms = (page: Page): Promise<Transform[]> =>
  page.evaluate(() =>
    (
      window as unknown as { __viewportStyles: Array<string | null> }
    ).__viewportStyles
      .map((style) => {
        const match = style?.match(
          /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/,
        );
        return match
          ? {
              x: Number(match[1]),
              y: Number(match[2]),
              zoom: Number(match[3]),
            }
          : null;
      })
      .filter((value): value is Transform => value !== null),
  );

const expectNoBackwardsFrames = (
  transforms: ReadonlyArray<Transform>,
  axes: ReadonlyArray<"x" | "y" | "zoom">,
) => {
  let previous: Transform | undefined;
  for (const current of transforms) {
    if (previous !== undefined) {
      for (const axis of axes) {
        expect(current[axis]).toBeLessThanOrEqual(previous[axis] + 0.01);
      }
    }
    previous = current;
  }
};

const installStyleObserver = async (page: Page) => {
  await page.addInitScript(() => {
    const changes: Array<{ oldValue: string | null; value: string | null }> =
      [];
    (window as unknown as { __styleChanges: typeof changes }).__styleChanges =
      changes;

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (
          record.type === "attributes" &&
          target instanceof Element &&
          target.matches("[data-fflow-viewport]")
        ) {
          changes.push({
            oldValue: record.oldValue,
            value: target.getAttribute("style"),
          });
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });
  });
};

test("proof 2: a re-render does not restart the node or pane Mounts", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  expect(await attr(page, "data-measured-nodes")).toBe("625");
  expect(await attr(page, "data-pane-mounts")).toBe("1");

  await page.evaluate(() => {
    const state = window as unknown as {
      __node?: Element | null;
      __pane?: Element | null;
    };
    state.__node = document.querySelector('[data-nodeid="n0"]');
    state.__pane = document.querySelector(".fflow__pane");
  });

  await page.click("#rerender");
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-label") ===
      "Rerendered",
  );
  await page.waitForTimeout(300);

  // A restarted node Mount re-emits its initial MeasuredNode, so a second
  // mount would push this to 1250; a restarted pane Mount would push to 2.
  expect(await attr(page, "data-measured-nodes")).toBe("625");
  expect(await attr(page, "data-pane-mounts")).toBe("1");

  const reused = await page.evaluate(() => {
    const state = window as unknown as {
      __node?: Element | null;
      __pane?: Element | null;
    };
    return {
      node: state.__node === document.querySelector('[data-nodeid="n0"]'),
      pane: state.__pane === document.querySelector(".fflow__pane"),
    };
  });
  expect(reused).toEqual({ node: true, pane: true });
});

test("proof 3: XYPanZoom survives re-renders and a Command can syncViewport it", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = await styleAttributeOf(page);
  expect(before).toContain("translate(20px, 30px) scale(0.9)");

  await page.click("#rerender");
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-label") ===
      "Rerendered",
  );

  await installViewportRecorder(page);
  await page.click("#sync-viewport");
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-syncs") === "1",
  );
  await page.waitForTimeout(300);

  const after = await styleAttributeOf(page);
  expect(after).toContain("translate(-200px, -100px) scale(1.25)");
  expect(await attr(page, "data-viewport")).toBe("-200,-100,1.25");
  expect(await attr(page, "data-pane-mounts")).toBe("1");
  expect(Number(await attr(page, "data-viewport-frames"))).toBeGreaterThan(0);

  // A programmatic animation must be driven by the Model patches, not by two
  // writers racing: x decreases and zoom increases monotonically.
  const transforms = await recordedTransforms(page);
  expect(transforms.length).toBeGreaterThan(1);
  expectNoBackwardsFrames(transforms, ["x", "y"]);
  let previousZoom: number | undefined;
  for (const transform of transforms) {
    if (previousZoom !== undefined) {
      expect(transform.zoom).toBeGreaterThanOrEqual(previousZoom - 0.01);
    }
    previousZoom = transform.zoom;
  }

  // The review's regression: after completion, a rerender must not restore the
  // pre-sync Model transform.
  await page.click("#rerender");
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-label") === "Node",
  );
  await page.waitForTimeout(300);
  expect(await attr(page, "data-viewport")).toBe("-200,-100,1.25");
  expect(parseTransform(await styleAttributeOf(page))).toEqual({
    x: -200,
    y: -100,
    zoom: 1.25,
  });

  // Remount from the committed Model: the new pane Mount gets its initial
  // viewport from `model.viewport`, not from the previous DOM.
  await page.click("#toggle-flow");
  await page.waitForSelector(".placeholder");
  expect(await page.locator(".fflow__pane").count()).toBe(0);

  await page.click("#toggle-flow");
  await page.waitForFunction(() => {
    const main = document.querySelector("main.app");
    return (
      main?.getAttribute("data-pane-mounts") === "2" &&
      document.querySelector(".fflow__pane") !== null
    );
  });
  expect(await attr(page, "data-viewport")).toBe("-200,-100,1.25");
  expect(parseTransform(await styleAttributeOf(page))).toEqual({
    x: -200,
    y: -100,
    zoom: 1.25,
  });
});

test("proof 3b: a pointer pan commits the terminal viewport to the Model", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const framesBefore = Number(await attr(page, "data-viewport-frames"));
  await installViewportRecorder(page);

  const pane = page.locator(".fflow__pane");
  const box = await pane.boundingBox();
  if (box === null) throw new Error("pane not found");
  const x = box.x + box.width - 80;
  const y = box.y + box.height - 80;

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(x - step * 8, y - step * 4);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const transforms = await recordedTransforms(page);
  expect(transforms.length).toBeGreaterThan(1);
  expectNoBackwardsFrames(transforms, ["x", "y"]);
  expect(Number(await attr(page, "data-viewport-frames"))).toBeGreaterThan(
    framesBefore,
  );

  const committed = parseTransform(await styleAttributeOf(page));
  expect(committed).not.toBeNull();

  await page.click("#rerender");
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-label") ===
      "Rerendered",
  );
  await page.waitForTimeout(300);
  expect(parseTransform(await styleAttributeOf(page))).toEqual(committed);
});

test("proof 4: server HTML carries the transform and hydration does not move it", async ({
  browser,
  page,
}) => {
  const served = await page.request.get(DEMO);
  const html = await served.text();
  expect(html).toContain("transform: translate(20px, 30px) scale(0.9)");

  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJs.newPage();
  await noJsPage.goto(DEMO);
  const serverTransform = await styleAttributeOf(noJsPage);
  await noJs.close();

  expect(serverTransform).toContain("translate(20px, 30px) scale(0.9)");

  await installStyleObserver(page);
  await page.goto(DEMO);
  await waitForMount(page);

  const hydratedTransform = await styleAttributeOf(page);
  expect(hydratedTransform).toContain("translate(20px, 30px) scale(0.9)");

  const changes = await page.evaluate(
    () =>
      (
        window as unknown as {
          __styleChanges: Array<{
            oldValue: string | null;
            value: string | null;
          }>;
        }
      ).__styleChanges,
  );

  for (const change of changes) {
    expect(change.value).toContain("translate(20px, 30px) scale(0.9)");
  }
});
