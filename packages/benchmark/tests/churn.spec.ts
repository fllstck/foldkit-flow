import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The create/delete churn exploration (§4.5's last metric: "JS heap after a
 * 1,000-create/1,000-delete churn loop", the memo-cache bound).
 *
 * It is **not** a gate: nothing here asserts a frame budget or an absolute heap
 * size, because a heap number on one machine is not a promise to another. What it
 * does assert is the invariant the cache is built on — 1,000 unique ids passing
 * through a 200-node graph leave the cache at 200 slots and the DOM at 200 nodes —
 * and it records the retained heap before, after, and after a second identical
 * loop, so "memory follows the largest graph rendered rather than its history"
 * (`PLAN.md` §4.5) is a number rather than a claim.
 */
const CHURN = "/churn.html";
const WAIT = { timeout: 20_000 } as const;

test("churn: 1,000 creates and deletes leave the node cache at its bound", async ({
  browser,
}) => {
  test.setTimeout(600_000);

  const context = await browser.newContext();
  const page: Page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");

  const heapUsedMb = async (): Promise<number> => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const used = metrics.find((entry) => entry.name === "JSHeapUsedSize");
    if (used === undefined)
      throw new Error("no JSHeapUsedSize in the CDP metrics");
    return Number((used.value / (1024 * 1024)).toFixed(2));
  };

  const snapshot = () =>
    page.evaluate(() => ({
      nodes: document.querySelectorAll(".fflow__node").length,
      cache: window.__churn?.cacheSize() ?? -1,
      peak: window.__churn?.peakCacheSize() ?? -1,
      step: Number(
        document
          .querySelector("[data-churn-step]")
          ?.getAttribute("data-churn-step") ?? 0,
      ),
    }));

  await page.goto(CHURN);
  await page.waitForSelector('[data-bench-ready="true"]', WAIT);
  // Every node measured and cached before the baseline, or the first loop would
  // be measured against a cache that is still filling.
  await page.waitForTimeout(800);

  const before = await snapshot();
  const heapBefore = await heapUsedMb();
  expect(before.nodes).toBe(200);
  expect(before.cache).toBe(200);

  /**
   * One loop, keyed on the page's own loop counter.
   *
   * The first two versions of this wait keyed on `done` alone, then on
   * `done + step`, and both matched a stale paint: the second loop was measured at
   * 300 ms and 51 of 2,000 steps. A counter that only ever increases while the
   * loop it names is running cannot be satisfied by an earlier loop's render.
   */
  const runLoop = async (loop: number): Promise<{ ms: number }> => {
    const startedAt = Date.now();
    await page.click("[data-churn-start]");
    await page.waitForFunction(
      (expected) => {
        const root = document.querySelector("[data-churn-loop]");
        return (
          root?.getAttribute("data-churn-loop") === String(expected) &&
          root.getAttribute("data-churn-done") === "true" &&
          root.getAttribute("data-churn-step") === "2000"
        );
      },
      loop,
      { timeout: 240_000 },
    );
    await page.waitForTimeout(300);
    return { ms: Date.now() - startedAt };
  };

  const first = await runLoop(1);
  const middle = await snapshot();
  const heapAfterFirst = await heapUsedMb();

  const second = await runLoop(2);
  const after = await snapshot();
  const heapAfterSecond = await heapUsedMb();

  const cycles = await page.evaluate(() => window.__churn?.cycles ?? 0);
  expect(cycles).toBe(1000);

  const report = {
    note: "M5 exploration, not a gate: PLAN §4.5's heap-after-churn column, measured on its own page (src/foldkit/churn.ts) so no gate page changes. Retained heap after HeapProfiler.collectGarbage, read through CDP Performance.getMetrics.",
    fixture: {
      page: CHURN,
      baseNodes: 200,
      cycles,
      stepsPerLoop: cycles * 2,
      // One node in, one node out: the graph is 200 nodes at every pause.
      graphAtRest: 200,
    },
    loop: {
      firstMs: first.ms,
      secondMs: second.ms,
      steps: { afterFirst: middle.step, afterSecond: after.step },
    },
    cache: {
      before: before.cache,
      afterFirst: middle.cache,
      afterSecond: after.cache,
      // 201 while the churn node exists, 200 once it is gone. A cache that did not
      // sweep would climb toward 200 + 1,000 (and 2,000 after the second loop).
      peak: Math.max(middle.peak, after.peak),
    },
    dom: {
      before: before.nodes,
      afterFirst: middle.nodes,
      afterSecond: after.nodes,
    },
    heapMb: {
      before: heapBefore,
      afterFirst: heapAfterFirst,
      afterSecond: heapAfterSecond,
      growthAfterFirst: Number((heapAfterFirst - heapBefore).toFixed(2)),
      growthAfterSecond: Number((heapAfterSecond - heapBefore).toFixed(2)),
    },
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
  };

  const outPath = resolve(process.cwd(), "results/churn.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  // The cache bound, which is the contract: one slot per node in the render pass,
  // swept when the id goes away — after one loop and after two.
  expect(middle.cache).toBe(before.cache);
  expect(after.cache).toBe(before.cache);
  // The slot was created, not skipped: the churn node rendered on its own pass.
  expect(report.cache.peak).toBe(before.cache + 1);
  // The DOM follows the graph, not the history.
  expect(middle.nodes).toBe(before.nodes);
  expect(after.nodes).toBe(before.nodes);
  // A generous ceiling on retained memory: it is there to catch a leak of the
  // whole loop (2,000 VNodes and their props), not to pretend a heap figure from
  // one machine is a promise.
  expect(report.heapMb.growthAfterSecond).toBeLessThan(12);
});
