import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The 10k **expanded** exploration (M5).
 *
 * `docs/M4-FINDINGS.md` §7 measured the escape hatch: 10,000 nodes with 98% of
 * them collapsed pan at the frame rate. The ceiling is the other number — what
 * the same graph costs with nothing collapsed — and PLAN §4.5 promises no figure
 * at 10k until it is measured, so this measures it. It is **not** a gate: nothing
 * here asserts a frame budget, only that the graph rendered, that the pan moved
 * the view, and that the numbers were recorded.
 *
 * Its own file, so the three gate legs in `bench.spec.ts` keep the runtime and the
 * DOM they have always measured.
 */
const RUNS = 5;

const statsOf = (values: ReadonlyArray<number>) => {
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
      __frames: Array<number>;
      __recording: boolean;
      __last?: number | undefined;
    };
    state.__frames = [];
    state.__recording = false;

    let token = 0;
    const tick = (now: number, loopToken: number) => {
      if (!state.__recording || loopToken !== token) return;
      if (state.__last !== undefined) state.__frames.push(now - state.__last);
      state.__last = now;
      requestAnimationFrame((next) => tick(next, loopToken));
    };

    (window as unknown as { __start: () => void }).__start = () => {
      token += 1;
      state.__last = undefined;
      state.__recording = true;
      requestAnimationFrame((now) => tick(now, token));
    };
    (window as unknown as { __stop: () => void }).__stop = () => {
      token += 1;
      state.__recording = false;
    };
  });
};

/**
 * The pan point is flow (170, 60) — the fixture's gap between node boxes at zoom
 * 1, the same point the 1k gate leg presses (M1-FINDINGS §9: a press that lands
 * on a node is a node drag, and a drag records idle pan frames).
 */
const pan = async (page: Page) => {
  const box = await page.locator(".fflow__pane").boundingBox();
  if (box === null) throw new Error("pane not found");
  const x = box.x + 190;
  const y = box.y + 90;

  const viewportStyle = () =>
    page.evaluate(
      () =>
        document
          .querySelector("[data-fflow-viewport]")
          ?.getAttribute("style") ?? "",
    );

  const before = await viewportStyle();
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x + step * 6, y + step * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);

  if ((await viewportStyle()) === before)
    throw new Error("the scripted pan did not move the view");
};

test("10k nodes, nothing collapsed: what the ceiling costs", async ({
  browser,
}) => {
  test.setTimeout(600_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/large-expanded.html");
  await page.waitForSelector('[data-bench-ready="true"]', { timeout: 60_000 });

  // Time to the first painted graph, measured in the page clock (navigation
  // start = 0): the §4.5 protocol reports mount cost separately rather than
  // hiding it inside a frame number.
  const readyAtMs = await page.evaluate(() => performance.now());

  // The first render happens before the pane has been measured, so culling is
  // off for it: all 10,000 nodes are in the DOM and every one of them runs a
  // Mount. The settled state — every measurement in, culling on — is the second
  // number, and it is the one that says how long the page takes to become usable.
  await page.waitForFunction(
    () => {
      const root = document.querySelector("[data-bench-ready]");
      const measured = Number(root?.getAttribute("data-measured") ?? 0);
      return (
        measured >= 10_000 &&
        document.querySelectorAll(".fflow__node").length < 1_000
      );
    },
    undefined,
    { timeout: 120_000 },
  );
  const settledAtMs = await page.evaluate(() => performance.now());
  await page.waitForTimeout(400);

  const counts = await page.evaluate(() => {
    const root = document.querySelector("[data-bench-ready]");
    return {
      nodes: root?.getAttribute("data-nodes") ?? "",
      hidden: root?.getAttribute("data-hidden") ?? "",
      measured: root?.getAttribute("data-measured") ?? "",
      rendered: document.querySelectorAll(".fflow__node").length,
      edges: document.querySelectorAll(".fflow__edge").length,
    };
  });

  expect(counts.nodes).toBe("10000");
  expect(counts.hidden).toBe("0");
  // Culling, not `hidden`: most of the graph is outside the region worth
  // drawing, so the DOM holds the visible slice and nothing else.
  expect(counts.rendered).toBeGreaterThan(0);
  expect(counts.rendered).toBeLessThan(10000);
  expect(counts.edges).toBeGreaterThan(0);

  const samples: Array<number> = [];
  await installRecorder(page);
  // Warm-up, discarded: the first pan measures a cold graph.
  await pan(page);

  for (let run = 0; run < RUNS; run += 1) {
    await page.goto("/large-expanded.html");
    await page.waitForSelector('[data-bench-ready="true"]', {
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => {
        const root = document.querySelector("[data-bench-ready]");
        return Number(root?.getAttribute("data-measured") ?? 0) >= 10_000;
      },
      undefined,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(400);
    await installRecorder(page);
    await page.evaluate(() =>
      (window as unknown as { __start: () => void }).__start(),
    );
    await pan(page);
    await page.evaluate(() =>
      (window as unknown as { __stop: () => void }).__stop(),
    );
    samples.push(
      ...(await page.evaluate(
        () => (window as unknown as { __frames: Array<number> }).__frames,
      )),
    );
  }

  const flow = await page.evaluate(() => ({
    updates: window.__flowStats?.updateCount ?? 0,
    updateTotalMs: Number((window.__flowStats?.updateTotalMs ?? 0).toFixed(4)),
    cullScanMs: Number((window.__flowStats?.cullScanMs ?? 0).toFixed(4)),
    cullScanSamples: window.__flowStats?.cullScanSamples ?? 0,
  }));

  // The gate's tell (M1 §9), kept: a culling sample is taken on every
  // `MovedViewport`, so zero samples means the pan never happened.
  expect(flow.cullScanSamples).toBeGreaterThan(0);

  const report = {
    note: "M5 exploration, not a gate: PLAN §4.5 promises no figure for 10k until it is measured. Recorded from packages/benchmark/tests/expanded.spec.ts.",
    fixture: {
      nodes: 10000,
      renderedNodes: counts.rendered,
      edges: counts.edges,
      collapsed: Number(counts.hidden),
      measuredNodes: Number(counts.measured),
      timeToFirstViewMs: Number(readyAtMs.toFixed(1)),
      timeToSettledMs: Number(settledAtMs.toFixed(1)),
    },
    pan: statsOf(samples),
    flow,
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
  };

  const outPath = resolve(process.cwd(), "results/expanded-10k.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  expect(report.pan.count).toBeGreaterThan(0);
});
