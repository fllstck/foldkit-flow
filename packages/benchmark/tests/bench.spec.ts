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

type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

type Library = Readonly<{
  name: LibraryName;
  path: string;
  pane: string;
  node: string;
  /** The library's transformed content element; its `style` proves a pan moved. */
  viewport: string;
  /** Where the pan gesture starts, in page coordinates.
   *
   *  It has to be empty pane: a press on a node is a node drag in every one of
   *  these libraries, and the recorded "pan" frames would then be idle frames.
   *  It is declared rather than probed because probing pans the content, which
   *  at fitView zoom moves a different node under the point — and `panPane`
   *  asserts the pan moved, so a stale point fails the run instead of quietly
   *  flattering the numbers. */
  panPoint: (box: Box) => { x: number; y: number };
  ready: string;
}>;

const cornerPan = (box: Box) => ({
  x: box.x + box.width - 60,
  y: box.y + box.height - 60,
});

const libraries: ReadonlyArray<Library> = [
  {
    name: "react",
    path: "/react.html",
    pane: ".react-flow__pane",
    node: '[data-id="n0"]',
    viewport: ".react-flow__viewport",
    panPoint: cornerPan,
    ready: '[data-bench-ready="true"]',
  },
  {
    name: "svelte",
    path: "/svelte.html",
    pane: ".svelte-flow__pane",
    node: '[data-id="n0"]',
    viewport: ".svelte-flow__viewport",
    panPoint: cornerPan,
    ready: '[data-bench-ready="true"]',
  },
  {
    name: "foldkit",
    path: "/foldkit.html",
    pane: ".fflow__pane",
    node: '[data-nodeid="n0"]',
    viewport: "[data-fflow-viewport]",
    panPoint: cornerPan,
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

const viewportTransform = (page: Page, viewportSelector: string) =>
  page.locator(viewportSelector).first().getAttribute("style");

const panPane = async (page: Page, library: Library) => {
  const box = await page.locator(library.pane).first().boundingBox();
  if (box === null) throw new Error(`pane not found: ${library.pane}`);
  const point = library.panPoint(box);
  const before = await viewportTransform(page, library.viewport);

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(point.x - step * 5, point.y - step * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);

  // Idle frames would silently flatter the numbers; fail instead.
  if ((await viewportTransform(page, library.viewport)) === before) {
    throw new Error(
      `the scripted pan did not move ${library.viewport} (pressed ${library.pane})`,
    );
  }
};

const waitForReady = async (page: Page, ready: string) => {
  await page.waitForSelector(ready, { timeout: 20_000 });
  await page.waitForTimeout(500);
};

const runOnce = async (page: Page, library: Library): Promise<Sample> => {
  // Pan first: the drag leg moves a node in every one of these libraries, and
  // the resolved pan point must still be empty pane when the pan press lands.
  await start(page, "pan");
  await panPane(page, library);
  await stop(page);

  await start(page, "drag");
  await dragNode(page, library.node);
  await stop(page);

  return readFrames(page);
};

type FlowMetrics = Readonly<{
  updates: number;
  updateTotalMs: number;
  updatePerDispatchMs: number;
  cullScanMs: number;
  cullScanSamples: number;
}>;

const readFlowMetrics = (page: Page): Promise<FlowMetrics> =>
  page.evaluate(() => {
    const stats = window.__flowStats ?? {
      updateTotalMs: 0,
      updateCount: 0,
      cullScanMs: 0,
      cullScanSamples: 0,
    };
    return {
      updates: stats.updateCount,
      updateTotalMs: Number(stats.updateTotalMs.toFixed(2)),
      updatePerDispatchMs:
        stats.updateCount === 0
          ? 0
          : Number((stats.updateTotalMs / stats.updateCount).toFixed(4)),
      cullScanMs: Number(stats.cullScanMs.toFixed(4)),
      cullScanSamples: stats.cullScanSamples,
    };
  });

test("625-node drag and pan frame times", async ({ browser }) => {
  test.setTimeout(600_000);

  const results: Record<string, { drag: Stats; pan: Stats }> = {};
  const metrics: Record<string, FlowMetrics> = {};

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

    if (library.name === "foldkit") {
      metrics.foldkit = await readFlowMetrics(page);
    }

    await context.close();
  }

  const output = {
    fixture: { nodes: 625, edges: 624 },
    runs: RUNS,
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
    libraries: results,
    // The three extra columns §4.5 asks for: per-dispatch fold cost, the culling
    // scan, and the interaction frame distribution above. Heap after churn is
    // not recorded (see docs/M1-FINDINGS.md).
    flow: metrics.foldkit,
  };

  const outPath = resolve(process.cwd(), "results/benchmark.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(output, null, 2));
  expect(results.react?.drag.count ?? 0).toBeGreaterThan(0);
  expect(results.foldkit?.pan.count ?? 0).toBeGreaterThan(0);
});

const largeLibrary: Library = {
  name: "foldkit",
  path: "/large.html",
  pane: ".fflow__pane",
  node: '[data-nodeid="n0"]',
  viewport: "[data-fflow-viewport]",
  // Zoom 1 puts nodes under the corner; flow (170, 60) is the fixture's gap
  // between node boxes, with the pane at the page origin and viewport 20/30.
  panPoint: (box) => ({ x: box.x + 190, y: box.y + 90 }),
  ready: ".fflow__pane",
};

test("1000-node culled drag and pan gate", async ({ browser }) => {
  test.setTimeout(600_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  const samples: Sample[] = [];

  const open = async () => {
    await page.goto("/large.html");
    await page.waitForSelector(".fflow__pane", { timeout: 20_000 });
    await page.waitForSelector('[data-nodeid="n0"]', { timeout: 20_000 });
    await page.waitForTimeout(500);
    await installRecorder(page);
  };

  await open();
  // Warm-up, discarded.
  await runOnce(page, largeLibrary);

  for (let run = 0; run < RUNS; run += 1) {
    await open();
    samples.push(await runOnce(page, largeLibrary));
  }

  const metrics = await readFlowMetrics(page);
  await context.close();

  const drag = statsOf(samples.flatMap((sample) => sample.drag));
  const pan = statsOf(samples.flatMap((sample) => sample.pan));

  const output = {
    fixture: { nodes: 1000, culling: true, zoom: 1 },
    runs: RUNS,
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
    drag,
    pan,
    flow: metrics,
  };

  const outPath = resolve(process.cwd(), "results/benchmark-1k.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(output, null, 2));
  expect(drag.p95).toBeLessThan(33);
  expect(pan.p95).toBeLessThan(33);
  expect(drag.longFrames).toBe(0);
  expect(pan.longFrames).toBe(0);
});
