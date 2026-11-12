import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The examples (M5, slice 1 of `docs/DOCS-PROPOSAL.md`).
 *
 * One proof for the whole set, driven by the index page rather than a list in this
 * file: every link the index offers must mount a flow, and the set must include
 * the examples the proposal promised. A new example is then proved the moment it
 * is added to `packages/example/src/examples/registry.ts` — and an example that
 * stops rendering fails here instead of sitting broken on the docs index.
 *
 * The two behavioural checks are the ones whose failure a reader would see and
 * not report: a collapse that hides the wrong thing, and a fit that never ran.
 */
const EXAMPLES = "http://localhost:4174/examples/";
const WAIT = { timeout: 20_000 } as const;

const waitForFlow = async (page: Page) => {
  await page.waitForFunction(
    () => document.querySelectorAll(".fflow__node").length > 0,
    undefined,
    WAIT,
  );
  // A measured pane is what "the flow is live" means: without it the nodes have
  // no geometry and a screenshot proves nothing (`verification.md`).
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector("main")?.getAttribute("data-example-nodes") ?? 0,
      ) > 0,
    undefined,
    WAIT,
  );
  await page.waitForTimeout(250);
};

test("every example the index offers mounts and is its own file", async ({
  page,
}) => {
  test.setTimeout(240_000);

  const errors: Array<string> = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource")
    ) {
      errors.push(message.text());
    }
  });

  await page.goto(EXAMPLES);
  await page.waitForSelector("[data-example-link]", WAIT);

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-example-link]")).map(
      (item) => ({
        slug: item.getAttribute("data-example-link") ?? "",
        href: item.querySelector("a")?.getAttribute("href") ?? "",
        description: item.querySelector("p")?.textContent ?? "",
      }),
    ),
  );

  // The set the proposal named. `toContain` rather than equality so adding an
  // example is not a test edit, and the count keeps the list from shrinking.
  for (const slug of [
    "minimal",
    "custom-nodes",
    "resizing",
    "edge-types",
    "connection-policy",
    "collapse",
    "fit-and-zoom",
  ]) {
    expect(links.map((link) => link.slug)).toContain(slug);
  }
  expect(links.length).toBeGreaterThanOrEqual(7);
  for (const link of links) {
    expect(
      link.description.length,
      `${link.slug}: a description`,
    ).toBeGreaterThan(20);
    // A trailing slash, or a static host serves the playground's document for the
    // path (the same trap `/example` has — M5-FINDINGS §8).
    expect(link.href, `${link.slug}: href`).toBe(`/examples/${link.slug}/`);
  }

  for (const link of links) {
    await page.goto(`http://localhost:4174${link.href}`);
    await waitForFlow(page);

    const mounted = await page.evaluate(() => ({
      name: document.querySelector("main")?.getAttribute("data-example-name"),
      nodes: document.querySelectorAll(".fflow__node").length,
      edges: document.querySelectorAll("[data-edgeid]").length,
      files: Array.from(document.querySelectorAll(".ex2-file-label")).map(
        (label) => label.textContent,
      ),
    }));

    expect(mounted.name, `${link.slug}: the page is this example`).toBe(
      link.slug,
    );
    expect(mounted.nodes, `${link.slug}: nodes rendered`).toBeGreaterThan(0);
    // The source beside it: the example's own file, the shared wiring, the CSS.
    expect(mounted.files, `${link.slug}: three files`).toEqual([
      `${link.slug}.ts`,
      "harness.ts",
      "examples.css",
    ]);
  }

  expect(errors).toEqual([]);

  // 1. Collapsing hides the container's *children*, not the container: the two
  // children and all three edges that touch them go, the frame stays.
  await page.goto("http://localhost:4174/examples/collapse/");
  await waitForFlow(page);
  expect(await page.locator(".fflow__node").count()).toBe(5);
  expect(await page.locator("[data-edgeid]").count()).toBe(3);
  await page.getByRole("button", { name: "Collapse" }).click();
  await page.waitForTimeout(250);
  expect(await page.locator(".fflow__node").count()).toBe(3);
  expect(await page.locator('.fflow__node[data-nodeid="frame"]').count()).toBe(
    1,
  );
  expect(await page.locator('.fflow__node[data-nodeid="one"]').count()).toBe(0);
  expect(await page.locator("[data-edgeid]").count()).toBe(0);

  // 2. `fit-and-zoom` is given no viewport: the fit runs from the pane's own
  // measurement, so the transform cannot still be the initial 1:1.
  await page.goto("http://localhost:4174/examples/fit-and-zoom/");
  await waitForFlow(page);
  const zoom = await page.evaluate(() => {
    const style =
      document.querySelector("[data-fflow-viewport]")?.getAttribute("style") ??
      "";
    const match = style.match(/scale\(([\d.]+)\)/);
    return match === null ? 1 : Number(match[1]);
  });
  expect(zoom).toBeLessThan(0.95);
  expect(zoom).toBeGreaterThan(0.2);
});
