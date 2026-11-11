import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The 10k exploration (§4.5, §7 M4). PLAN §4.5 promises no number until it is
 * measured, and `hidden` collapsing is the documented escape hatch — so this file
 * measures it and records the result. It is **not** a gate: nothing here asserts a
 * frame budget, only that the graph is interactive and that the collapsed subtree
 * really is gone.
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

const pan = async (page: Page) => {
  const box = await page.locator(".fflow__pane").boundingBox();
  if (box === null) throw new Error("pane not found");
  // Empty pane at zoom 0.35: containers 3 onwards are collapsed, so the screen
  // area over `box4` (flow x 2800, screen x 980 at this zoom) is empty — a press
  // there pans instead of grabbing a node (M1-FINDINGS §9).
  const x = box.x + 980;
  const y = box.y + 40;

  const before = await page.evaluate(
    () =>
      document.querySelector("[data-fflow-viewport]")?.getAttribute("style") ??
      "",
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x + step * 6, y + step * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);

  const after = await page.evaluate(
    () =>
      document.querySelector("[data-fflow-viewport]")?.getAttribute("style") ??
      "",
  );
  // The pan has to have moved something, or the recorded frames are idle ones
  // (M1-FINDINGS §9).
  if (after === before)
    throw new Error("the scripted pan did not move the view");
};

test("10k nodes with hidden subtrees: what it costs", async ({ browser }) => {
  test.setTimeout(600_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/large-hidden.html");
  await page.waitForSelector('[data-bench-ready="true"]', { timeout: 30_000 });
  await page.waitForTimeout(600);

  const counts = await page.evaluate(() => {
    const root = document.querySelector("[data-bench-ready]");
    return {
      nodes: root?.getAttribute("data-nodes") ?? "",
      hidden: root?.getAttribute("data-hidden") ?? "",
      rendered: document.querySelectorAll(".fflow__node").length,
      edges: document.querySelectorAll(".fflow__edge").length,
    };
  });

  expect(counts.nodes).toBe("10000");
  // 98 of 100 containers are collapsed: 98 containers plus their 9,702 children.
  expect(counts.hidden).toBe("9800");
  // The renderer draws what is left, culled — a few hundred, not ten thousand.
  expect(counts.rendered).toBeGreaterThan(0);
  expect(counts.rendered).toBeLessThan(600);

  const samples: Array<number> = [];
  await installRecorder(page);
  // Warm-up, discarded: the first pan measures a cold graph.
  await pan(page);

  for (let run = 0; run < RUNS; run += 1) {
    await page.goto("/large-hidden.html");
    await page.waitForSelector('[data-bench-ready="true"]', {
      timeout: 30_000,
    });
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
    cullScanMs: Number((window.__flowStats?.cullScanMs ?? 0).toFixed(4)),
    cullScanSamples: window.__flowStats?.cullScanSamples ?? 0,
  }));

  const report = {
    note: "M4 exploration, not a gate: PLAN §4.5 promises no figure for 10k until it is measured. Recorded from packages/benchmark/tests/hidden.spec.ts.",
    fixture: {
      nodes: 10000,
      containers: 100,
      childrenPerContainer: 99,
      collapsedContainers: 98,
      hiddenNodes: Number(counts.hidden),
      renderedNodes: counts.rendered,
    },
    pan: statsOf(samples),
    flow,
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
  };

  const outPath = resolve(process.cwd(), "results/hidden-10k.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  expect(report.pan.count).toBeGreaterThan(0);
});
