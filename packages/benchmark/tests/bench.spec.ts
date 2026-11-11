import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const RUNS = 10;

type LibraryName = "react" | "svelte" | "foldkit";

type Sample = { drag: number[]; pan: number[] };

type Stats = {
  count: number;
  median: number;
  p95: number;
  longest: number;
  longFrames: number;
};

const libraries: ReadonlyArray<{
  name: LibraryName;
  path: string;
  pane: string;
  node: string;
  ready: string;
}> = [
  {
    name: "react",
    path: "/react.html",
    pane: ".react-flow__pane",
    node: '[data-id="n0"]',
    ready: '[data-bench-ready="true"]',
  },
  {
    name: "svelte",
    path: "/svelte.html",
    pane: ".svelte-flow__pane",
    node: '[data-id="n0"]',
    ready: '[data-bench-ready="true"]',
  },
  {
    name: "foldkit",
    path: "/foldkit.html",
    pane: ".fflow__pane",
    node: '[data-nodeid="n0"]',
    ready: '[data-measured="625"]',
  },
];

const statsOf = (values: ReadonlyArray<number>): Stats => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return {
    count: sorted.length,
    median: Number(at(0.5).toFixed(2)),
    p95: Number(at(0.95).toFixed(2)),
    longest: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    longFrames: sorted.filter((value) => value > 50).length,
  };
};

const installRecorder = async (page: Page) => {
  await page.evaluate(() => {
    const state = window as unknown as {
      __frames: { drag: number[]; pan: number[] };
      __recording: boolean;
      __bucket: "drag" | "pan";
    };
    state.__frames = { drag: [], pan: [] };
    state.__recording = false;

    let token = 0;

    const tick = (now: number, loopToken: number) => {
      if (!state.__recording || loopToken !== token) return;
      const bucket = state.__frames[state.__bucket];
      const previous = (state as unknown as { __last?: number | undefined })
        .__last;
      if (previous !== undefined) bucket.push(now - previous);
      (state as unknown as { __last?: number | undefined }).__last = now;
      requestAnimationFrame((next) => tick(next, loopToken));
    };

    (
      window as unknown as { __start: (bucket: "drag" | "pan") => void }
    ).__start = (bucket) => {
      token += 1;
      const loopToken = token;
      state.__bucket = bucket;
      (state as unknown as { __last?: number | undefined }).__last = undefined;
      state.__recording = true;
      requestAnimationFrame((now) => tick(now, loopToken));
    };
    (window as unknown as { __stop: () => void }).__stop = () => {
      token += 1;
      state.__recording = false;
    };
  });
};

const start = (page: Page, bucket: "drag" | "pan") =>
  page.evaluate(
    (name) =>
      (
        window as unknown as { __start: (bucket: "drag" | "pan") => void }
      ).__start(name),
    bucket,
  );

const stop = (page: Page) =>
  page.evaluate(() => (window as unknown as { __stop: () => void }).__stop());

const readFrames = (page: Page): Promise<Sample> =>
  page.evaluate(() => {
    const state = window as unknown as {
      __frames: { drag: number[]; pan: number[] };
    };
    return state.__frames;
  });

const dragNode = async (page: Page, nodeSelector: string) => {
  const node = page.locator(nodeSelector).first();
  const box = await node.boundingBox();
  if (box === null) throw new Error(`node not found: ${nodeSelector}`);

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x + step * 5, y + step * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

const panPane = async (page: Page, paneSelector: string) => {
  const pane = page.locator(paneSelector).first();
  const box = await pane.boundingBox();
  if (box === null) throw new Error(`pane not found: ${paneSelector}`);

  const x = box.x + box.width - 60;
  const y = box.y + box.height - 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x - step * 5, y - step * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

const waitForReady = async (page: Page, ready: string) => {
  await page.waitForSelector(ready, { timeout: 60_000 });
  await page.waitForTimeout(500);
};

const runOnce = async (
  page: Page,
  library: (typeof libraries)[number],
): Promise<Sample> => {
  await start(page, "drag");
  await dragNode(page, library.node);
  await stop(page);

  await start(page, "pan");
  await panPane(page, library.pane);
  await stop(page);

  return readFrames(page);
};

test("625-node drag and pan frame times", async ({ browser }) => {
  test.setTimeout(600_000);

  const results: Record<string, { drag: Stats; pan: Stats }> = {};

  for (const library of libraries) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const samples: Sample[] = [];

    await page.goto(library.path);
    await waitForReady(page, library.ready);
    await installRecorder(page);

    // Warm-up, discarded.
    await runOnce(page, library);

    for (let run = 0; run < RUNS; run += 1) {
      await page.goto(library.path);
      await waitForReady(page, library.ready);
      await installRecorder(page);
      samples.push(await runOnce(page, library));
    }

    results[library.name] = {
      drag: statsOf(samples.flatMap((sample) => sample.drag)),
      pan: statsOf(samples.flatMap((sample) => sample.pan)),
    };

    await context.close();
  }

  const output = {
    fixture: { nodes: 625, edges: 624 },
    runs: RUNS,
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
    libraries: results,
  };

  const outPath = resolve(process.cwd(), "results/benchmark.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(output, null, 2));
  expect(results.react?.drag.count ?? 0).toBeGreaterThan(0);
  expect(results.foldkit?.pan.count ?? 0).toBeGreaterThan(0);
});
