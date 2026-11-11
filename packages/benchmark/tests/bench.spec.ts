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
  /** A specific node, kept for the readiness selector. */
  node: string;
  /** Every node; the drag picks the one nearest the pane centre, because the
   *  fixtures are larger than the pane and `n0` is not always on screen. */
  nodeAny: string;
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
  /** Measured: React Flow's node drag never engages under this harness, so its
   *  drag leg is reported as unverified rather than as idle frames. */
  canDrag: boolean;
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
    nodeAny: ".react-flow__node",
    viewport: ".react-flow__viewport",
    panPoint: cornerPan,
    canDrag: false,
    ready: '[data-bench-ready="true"]',
  },
  {
    name: "svelte",
    path: "/svelte.html",
    pane: ".svelte-flow__pane",
    node: '[data-id="n0"]',
    nodeAny: ".svelte-flow__node",
    viewport: ".svelte-flow__viewport",
    panPoint: cornerPan,
    canDrag: true,
    ready: '[data-bench-ready="true"]',
  },
  {
    name: "foldkit",
    path: "/foldkit.html",
    pane: ".fflow__pane",
    node: '[data-nodeid="n0"]',
    nodeAny: ".fflow__node",
    viewport: "[data-fflow-viewport]",
    panPoint: cornerPan,
    canDrag: true,
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

/** The node whose centre is nearest the pane centre, among those fully visible.
 *  The fixtures are larger than the pane (React Flow's `fitView` clamps at its
 *  min zoom), so a fixed id like `n0` may not be on screen at all. */
const nearestNodeTo = async (
  page: Page,
  paneSelector: string,
  nodeSelector: string,
): Promise<{
  index: number;
  box: { x: number; y: number; width: number; height: number };
}> => {
  const pane = await page.locator(paneSelector).first().boundingBox();
  if (pane === null) throw new Error(`pane not found: ${paneSelector}`);

  const index = await page.$$eval(
    nodeSelector,
    (elements, paneRect) => {
      const distance = (rect: DOMRect) =>
        Math.hypot(
          rect.x + rect.width / 2 - (paneRect.x + paneRect.width / 2),
          rect.y + rect.height / 2 - (paneRect.y + paneRect.height / 2),
        );

      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      elements.forEach((element, position) => {
        const rect = element.getBoundingClientRect();
        const isFullyInside =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.x > paneRect.x &&
          rect.y > paneRect.y &&
          rect.x + rect.width < paneRect.x + paneRect.width &&
          rect.y + rect.height < paneRect.y + paneRect.height;
        if (!isFullyInside) return;
        const candidate = distance(rect);
        if (candidate < bestDistance) {
          best = position;
          bestDistance = candidate;
        }
      });
      return best;
    },
    pane,
  );

  if (index < 0) throw new Error(`no node fully visible in ${paneSelector}`);

  const node = page.locator(nodeSelector).nth(index);
  const box = await node.boundingBox();
  if (box === null) throw new Error(`node ${index} has no box`);

  return { index, box };
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

const dragNode = async (
  page: Page,
  paneSelector: string,
  nodeSelector: string,
) => {
  const { index, box } = await nearestNodeTo(page, paneSelector, nodeSelector);
  const node = page.locator(nodeSelector).nth(index);

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x + step * 5, y + step * 2);
    await page.waitForTimeout(16);
  }

  // The node has to have moved *while the frames are recorded*. A drag that only
  // dispatches the press records idle frames, which would silently flatter the
  // numbers — that happened: the Foldkit page had no subscriptions, so no
  // pointermove ever arrived.
  const during = await node.boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(120);

  if (during === null)
    throw new Error(`node vanished during the drag: ${nodeSelector}`);
  if (Math.abs(during.x - box.x) < 20 && Math.abs(during.y - box.y) < 10) {
    throw new Error(
      `the scripted drag did not move ${nodeSelector}[${index}] (${box.x},${box.y} → ${during.x},${during.y})`,
    );
  }
};

const waitForReady = async (page: Page, ready: string) => {
  await page.waitForSelector(ready, { timeout: 20_000 });
  await page.waitForTimeout(500);
};

const runOnce = async (page: Page, library: Library): Promise<Sample> => {
  if (library.canDrag) {
    await start(page, "drag");
    await dragNode(page, library.pane, library.nodeAny);
    await stop(page);
  }

  await start(page, "pan");
  await panPane(page, library);
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
      // `count: 0` means the drag leg was skipped because the library's node
      // drag does not engage under this harness (see `canDrag`).
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
    // Every leg is verified: the pan must move the library's viewport, and the
    // drag must move the node under the pointer. A library whose drag cannot be
    // verified reports `drag.count: 0` instead of idle frames.
    dragCoverage: {
      react:
        "not verified: node drag does not engage (pointerdown delivered, node box unchanged)",
      svelte: "verified",
      foldkit: "verified",
    },
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
  // Both verified legs, for every library: the pan for all three, and the drag
  // wherever the harness can prove the node moved.
  for (const name of ["react", "svelte", "foldkit"] as const) {
    expect(results[name]?.pan.count ?? 0).toBeGreaterThan(0);
  }
  expect(results.svelte?.drag.count ?? 0).toBeGreaterThan(0);
  expect(results.foldkit?.drag.count ?? 0).toBeGreaterThan(0);
});

const largeLibrary: Library = {
  name: "foldkit",
  path: "/large.html",
  pane: ".fflow__pane",
  node: '[data-nodeid="n0"]',
  nodeAny: ".fflow__node",
  viewport: "[data-fflow-viewport]",
  // Zoom 1 puts nodes under the corner; flow (170, 60) is the fixture's gap
  // between node boxes, with the pane at the page origin and viewport 20/30.
  panPoint: (box) => ({ x: box.x + 190, y: box.y + 90 }),
  canDrag: true,
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
  // §4.5's gate is the p95, and both legs are verified to have moved something
  // above. Long frames are also bounded, but not required to be zero: a single
  // 3–4 frame stall shows up at the start of a pan in *both* the M1 and the M2
  // tree (M1, instrumented: 1 gesture in 5), and the frame that contains it does
  // one render and no measurement work — a zero tolerance measured the machine,
  // not the library. M2 sits slightly above M1's rate; the numbers and that
  // residual difference are in `docs/M2-FINDINGS.md` §4.
  expect(drag.p95).toBeLessThan(33);
  expect(pan.p95).toBeLessThan(33);
  expect(drag.longFrames).toBeLessThanOrEqual(Math.ceil(drag.count * 0.02));
  expect(pan.longFrames).toBeLessThanOrEqual(Math.ceil(pan.count * 0.02));
});

const largeChromeLibrary: Library = {
  ...largeLibrary,
  path: "/large-chrome.html",
};

test("1000-node culled gate with M3 chrome on", async ({ browser }) => {
  test.setTimeout(600_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  const samples: Sample[] = [];

  const open = async () => {
    await page.goto("/large-chrome.html");
    await page.waitForSelector(".fflow__pane", { timeout: 20_000 });
    await page.waitForSelector('[data-nodeid="n0"]', { timeout: 20_000 });
    // The chrome has to be there, or this leg measures the bare page again.
    await page.waitForSelector("[data-fflow-background]", { timeout: 20_000 });
    await page.waitForSelector("[data-fflow-minimap]", { timeout: 20_000 });
    await page.waitForTimeout(500);
    await installRecorder(page);
  };

  await open();
  await runOnce(page, largeChromeLibrary);

  for (let run = 0; run < RUNS; run += 1) {
    await open();
    samples.push(await runOnce(page, largeChromeLibrary));
  }

  const metrics = await readFlowMetrics(page);
  const minimapRects = await page
    .locator(".fflow__minimap .fflow__minimap-node")
    .count();
  await context.close();

  const drag = statsOf(samples.flatMap((sample) => sample.drag));
  const pan = statsOf(samples.flatMap((sample) => sample.pan));

  const output = {
    fixture: { nodes: 1000, culling: true, zoom: 1 },
    chrome: { background: "dots", controls: true, minimap: true, minimapRects },
    runs: RUNS,
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
    drag,
    pan,
    flow: metrics,
  };

  const outPath = resolve(process.cwd(), "results/benchmark-1k-chrome.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(output, null, 2));
  // The chrome must not move the gate. The minimap draws every node — 1000
  // rectangles — but memoized on `nodes`/`nodeSizes`, so a pan frame rebuilds
  // the viewport rectangle and nothing else.
  expect(minimapRects).toBe(1000);
  expect(drag.p95).toBeLessThan(33);
  expect(pan.p95).toBeLessThan(33);
  expect(drag.longFrames).toBeLessThanOrEqual(Math.ceil(drag.count * 0.02));
  expect(pan.longFrames).toBeLessThanOrEqual(Math.ceil(pan.count * 0.02));
});
