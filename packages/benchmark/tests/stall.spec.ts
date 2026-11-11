import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Where the start-of-pan stall is (M5; `M3-FINDINGS.md` §5.1 carried it forward).
 *
 * The gate has recorded 0–3 frames over 50 ms in the 1k pan leg since M2, in runs
 * of identical code that did not agree with each other. This file is the
 * diagnostic, not a gate: on one page it records three arms — an **idle** window
 * with no gesture, the page's **first** pan, and a **second** pan — with each
 * frame's offset from its own arm's start. If the stall is the pan's own work it
 * lands at the start of both pans; if it is a cold page's first frames it lands in
 * the idle arm too.
 *
 * A fourth arm replays the gate's own order — a node drag, then the pan — because
 * that is the configuration in which the stall was recorded (M3-FINDINGS §5.1).
 *
 * Each invocation is a fresh page load, exactly like the gate's recorded runs, so
 * "cold" means what it means there.
 */
const INVOCATIONS = 12;

type Frame = Readonly<{ dt: number; at: number }>;

const installRecorder = async (page: Page) => {
  await page.evaluate(() => {
    const state = window as unknown as {
      __frames: Array<{ dt: number; at: number }>;
      __recording: boolean;
      __last?: number | undefined;
      __startAt: number;
    };
    state.__frames = [];
    state.__recording = false;
    state.__startAt = 0;

    let token = 0;
    const tick = (now: number, loopToken: number) => {
      if (!state.__recording || loopToken !== token) return;
      if (state.__last !== undefined) {
        state.__frames.push({
          dt: now - state.__last,
          at: now - state.__startAt,
        });
      }
      state.__last = now;
      requestAnimationFrame((next) => tick(next, loopToken));
    };

    (window as unknown as { __start: () => void }).__start = () => {
      token += 1;
      state.__last = undefined;
      state.__startAt = performance.now();
      state.__recording = true;
      requestAnimationFrame((now) => tick(now, token));
    };
    (window as unknown as { __stop: () => void }).__stop = () => {
      token += 1;
      state.__recording = false;
    };
  });
};

const readFrames = async (page: Page): Promise<ReadonlyArray<Frame>> =>
  page.evaluate(
    () =>
      (window as unknown as { __frames: Array<{ dt: number; at: number }> })
        .__frames,
  );

const start = async (page: Page) =>
  page.evaluate(() => (window as unknown as { __start: () => void }).__start());

const stop = async (page: Page) =>
  page.evaluate(() => (window as unknown as { __stop: () => void }).__stop());

/**
 * A point inside the pane that is not over a node.
 *
 * The 1k gate leg presses flow (170, 60) — the fixture's gap at zoom 1 — but a
 * *second* pan on the same page has moved the gap, so the nominal point lands on
 * a node and the press becomes a node drag (M1-FINDINGS §9). The search is a
 * static hit test (`elementFromPoint`), not a probe gesture, so it moves nothing.
 */
const emptyPointNear = async (
  page: Page,
  near: Readonly<{ x: number; y: number }>,
): Promise<Readonly<{ x: number; y: number }>> => {
  const point = await page.evaluate(
    ({ x, y }) => {
      const overNode = (cx: number, cy: number): boolean => {
        const element = document.elementFromPoint(cx, cy);
        if (element === null) return true;
        return element.closest(".fflow__node") !== null;
      };
      if (!overNode(x, y)) return { x, y };
      // Outward from the nominal point: 5 px steps, one ring at a time.
      for (let radius = 5; radius <= 200; radius += 5) {
        const candidates: Array<{ x: number; y: number }> = [];
        for (let offset = -radius; offset <= radius; offset += 5) {
          candidates.push({ x: x + offset, y: y - radius });
          candidates.push({ x: x + offset, y: y + radius });
          candidates.push({ x: x - radius, y: y + offset });
          candidates.push({ x: x + radius, y: y + offset });
        }
        const found = candidates.find((entry) => !overNode(entry.x, entry.y));
        if (found !== undefined) return found;
      }
      return null;
    },
    { x: near.x, y: near.y },
  );

  if (point === null)
    throw new Error(`no empty pane point near ${near.x},${near.y}`);
  return point;
};

const pan = async (page: Page, direction: 1 | -1 = 1) => {
  const box = await page.locator(".fflow__pane").boundingBox();
  if (box === null) throw new Error("pane not found");
  const point = await emptyPointNear(page, { x: box.x + 190, y: box.y + 90 });

  const viewportStyle = () =>
    page.evaluate(
      () =>
        document
          .querySelector("[data-fflow-viewport]")
          ?.getAttribute("style") ?? "",
    );

  const before = await viewportStyle();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(
      point.x + step * 6 * direction,
      point.y + step * 2 * direction,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);

  const after = await viewportStyle();
  // The pan has to have moved something, or the recorded frames are idle ones
  // (M1-FINDINGS §9).
  if (after === before) {
    throw new Error(
      `the scripted pan did not move the view (pressed ${point.x},${point.y})`,
    );
  }
};

/** The gate's drag leg, cut down: a node is pressed and moved, so the gesture
 *  path the pan shares is warm before the recorded pan — `runOnce` in
 *  `bench.spec.ts` does exactly this, in that order. */
const dragNode = async (page: Page) => {
  const box = await page.locator(".fflow__node").first().boundingBox();
  if (box === null) throw new Error("no node to drag");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x + step * 5, y + step * 2);
    await page.waitForTimeout(16);
  }
  const during = await page.locator(".fflow__node").first().boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(120);
  if (during === null || Math.abs(during.x - box.x) < 20)
    throw new Error("the scripted drag did not move the node");
};

const summarise = (frames: ReadonlyArray<Frame>) => {
  const sorted = [...frames.map((frame) => frame.dt)].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const long = frames.filter((frame) => frame.dt > 50);
  const frameIndex = (frame: Frame) => frames.indexOf(frame);
  return {
    frames: frames.length,
    median: Number(at(0.5).toFixed(2)),
    p95: Number(at(0.95).toFixed(2)),
    longest: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    longFrames: long.length,
    longAtMs: long.map((frame) => Number(frame.at.toFixed(1))),
    longAtIndex: long.map((frame) => frameIndex(frame)),
  };
};

test("1k pan: idle, first pan, second pan", async ({ browser }) => {
  test.setTimeout(600_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  const arms = {
    idle: [] as Array<ReadonlyArray<Frame>>,
    firstPan: [] as Array<ReadonlyArray<Frame>>,
    secondPan: [] as Array<ReadonlyArray<Frame>>,
    gatePan: [] as Array<ReadonlyArray<Frame>>,
  };

  // Warm-up invocation, discarded: the first page load of a browser process
  // compiles the whole bundle, which is not what the gate's runs measure.
  const load = async () => {
    await page.goto("/large.html");
    await page.waitForSelector('[data-bench-ready="true"]', {
      timeout: 60_000,
    });
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector("[data-bench-ready]")
            ?.getAttribute("data-measured") ?? 0,
        ) >= 1_000,
      undefined,
      { timeout: 60_000 },
    );
    await page.waitForTimeout(400);
    await installRecorder(page);
  };

  await load();
  await pan(page, 1);

  for (let invocation = 0; invocation < INVOCATIONS; invocation += 1) {
    await load();

    // Arm 1: 400 ms of nothing. The page is settled; if a long frame shows up
    // here, it is not the pan.
    await start(page);
    await page.waitForTimeout(400);
    await stop(page);
    arms.idle.push(await readFrames(page));

    // Arm 2: the page's first pan.
    await installRecorder(page);
    await start(page);
    await pan(page, 1);
    await stop(page);
    arms.firstPan.push(await readFrames(page));

    // Arm 3: the second pan, same page, everything warm.
    await installRecorder(page);
    await start(page);
    await pan(page, -1);
    await stop(page);
    arms.secondPan.push(await readFrames(page));

    // Arm 4: the gate's own order — a drag, then the recorded pan.
    await dragNode(page);
    await installRecorder(page);
    await start(page);
    await pan(page, 1);
    await stop(page);
    arms.gatePan.push(await readFrames(page));
  }

  const report = {
    note: "M5 diagnostic, not a gate: the start-of-pan stall M3-FINDINGS §5.1 carried forward. Recorded from packages/benchmark/tests/stall.spec.ts.",
    fixture: { page: "/large.html", nodes: 1000, culled: true },
    invocations: INVOCATIONS,
    arms: {
      idle: arms.idle.map(summarise),
      firstPan: arms.firstPan.map(summarise),
      secondPan: arms.secondPan.map(summarise),
      gatePan: arms.gatePan.map(summarise),
    },
    totals: {
      idle: summarise(arms.idle.flat()),
      firstPan: summarise(arms.firstPan.flat()),
      secondPan: summarise(arms.secondPan.flat()),
      gatePan: summarise(arms.gatePan.flat()),
    },
    browser: "Brave 156.1.98.63 (Chromium 156), headless",
    machine: "MacBook Air (Apple M5), macOS 26.6.2",
  };

  const outPath = resolve(process.cwd(), "results/pan-stall.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  expect(report.totals.firstPan.frames).toBeGreaterThan(0);
  expect(report.totals.secondPan.frames).toBeGreaterThan(0);
  expect(report.totals.gatePan.frames).toBeGreaterThan(0);
});
