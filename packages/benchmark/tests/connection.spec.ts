import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEMO = "http://127.0.0.1:4174/";

/** `page.waitForFunction` has no default timeout, so every wait here states one:
 *  a broken assertion has to fail in seconds, not burn the 600 s budget
 *  (`docs/M1-FINDINGS.md` §6.4). */
const WAIT = { timeout: 15_000 } as const;

const attr = async (page: Page, name: string) =>
  (await page.locator("main.app").getAttribute(name)) ?? "";

const waitForMount = async (page: Page) => {
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main.app");
      return (
        main?.getAttribute("data-measured-nodes") === "630" &&
        main?.getAttribute("data-pane-mounts") === "1"
      );
    },
    undefined,
    WAIT,
  );
};

/** Screen → flow space, from the same two inputs `Flow.screenToFlow` uses. */
const toFlow = async (page: Page, x: number, y: number) => {
  const view = await page.evaluate(() => {
    const rect = document
      .querySelector(".fflow__pane")
      ?.getBoundingClientRect();
    const viewport = (
      document.querySelector("main.app")?.getAttribute("data-viewport") ??
      "0,0,1"
    )
      .split(",")
      .map(Number);
    return {
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      x: viewport[0] ?? 0,
      y: viewport[1] ?? 0,
      zoom: viewport[2] ?? 1,
    };
  });

  return {
    x: (x - view.left - view.x) / view.zoom,
    y: (y - view.top - view.y) / view.zoom,
  };
};

/** One handle's centre in flow space, from its live DOM box. */
const handleCenter = async (page: Page, nodeId: string, handleId: string) => {
  const box = await page
    .locator(
      `.fflow__node[data-nodeid="${nodeId}"] .fflow__handle[data-handleid="${handleId}"]`,
    )
    .boundingBox();
  if (box === null) throw new Error(`handle not found: ${nodeId}/${handleId}`);
  return toFlow(page, box.x + box.width / 2, box.y + box.height / 2);
};

const edgePath = (page: Page, edgeId: string) =>
  page
    .locator(`.fflow__edge[data-edgeid="${edgeId}"] path`)
    .getAttribute("d")
    .then((d) => d ?? "");

/** First and last point of an edge's `d`: where the path actually starts and
 *  ends, which is the only claim an endpoint assertion should make. */
const pathEnds = (d: string) => {
  const start = /^M([-\d.]+),([-\d.]+)/.exec(d);
  const end = /([-\d.]+),([-\d.]+)$/.exec(d);
  if (start === null || end === null) throw new Error(`unparsable path: ${d}`);
  return {
    start: { x: Number(start[1]), y: Number(start[2]) },
    end: { x: Number(end[1]), y: Number(end[2]) },
  };
};

const near = (
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) =>
  Math.abs(actual.x - expected.x) < 1.5 &&
  Math.abs(actual.y - expected.y) < 1.5;

/** Press at `from` and move to `to` in steps, so the subscription sees the
 *  moves a real pointer would send. Leaves the button down: a proof that asserts
 *  what the gesture is doing mid-flight has to hold it. */
const pressAndSlide = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
    );
    await page.waitForTimeout(16);
  }
};

const dragBetween = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
) => {
  await pressAndSlide(page, from, to, steps);
  await page.mouse.up();
};

const OUTWARD: Readonly<Record<string, { x: number; y: number }>> = {
  Left: { x: -1, y: 0 },
  Right: { x: 1, y: 0 },
  Top: { x: 0, y: -1 },
  Bottom: { x: 0, y: 1 },
};

/** Which way a handle faces, from the `data-handlepos` the renderer emits. The
 *  reconnect ring is an annulus, so the press has to be outside the handle and
 *  on the free side of it. */
const outwardOf = async (page: Page, nodeId: string, handleId: string) => {
  const position =
    (await page
      .locator(
        `.fflow__node[data-nodeid="${nodeId}"] .fflow__handle[data-handleid="${handleId}"]`,
      )
      .getAttribute("data-handlepos")) ?? "Left";
  return OUTWARD[position] ?? { x: -1, y: 0 };
};

const zoomOf = async (page: Page) =>
  Number((await attr(page, "data-viewport")).split(",")[2] ?? "1");

const screenBox = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`not rendered: ${selector}`);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
};

test("proof 17: dragging between two handles connects them at the handles", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = Number(await attr(page, "data-edges"));
  const source = await screenBox(
    page,
    '.fflow__node[data-nodeid="n0"] .fflow__handle[data-handleid="out"]',
  );
  const target = await screenBox(
    page,
    '.fflow__node[data-nodeid="n2"] .fflow__handle[data-handleid="in"]',
  );

  await pressAndSlide(page, source, target);
  expect(await attr(page, "data-gesture")).toBe("Connecting");
  // …over the handle it is aimed at, which is what makes the release below a
  // connection and not a coincidence.
  expect(await attr(page, "data-connection-target")).toBe("n2:in");
  await page.mouse.up();

  // The gesture has to have happened: the parent only mints an edge when the
  // flow reported `ConnectedHandles` (`docs/M1-FINDINGS.md` §10).
  await page.waitForFunction(
    (expected) =>
      document.querySelector("main.app")?.getAttribute("data-edges") ===
      String(expected),
    before + 1,
    WAIT,
  );
  expect(await attr(page, "data-last-edge")).toBe("n0:out>n2:in");
  expect(await attr(page, "data-gesture")).toBe("Idle");

  // The endpoint really is the handle: the path starts at n0's `out` centre and
  // ends at n2's `in` centre, both read from the live DOM.
  const newEdge = await page
    .locator(".fflow__edge")
    .last()
    .getAttribute("data-edgeid");
  if (newEdge === null) throw new Error("no edge rendered");
  const ends = pathEnds(await edgePath(page, newEdge));
  expect(near(ends.start, await handleCenter(page, "n0", "out"))).toBe(true);
  expect(near(ends.end, await handleCenter(page, "n2", "in"))).toBe(true);

  // …and it follows the node the moment the node moves, because the anchor is
  // the node position plus node-local handle bounds.
  const node = await screenBox(page, '.fflow__node[data-nodeid="n0"]');
  await dragBetween(page, node, { x: node.x + 45, y: node.y + 30 }, 6);
  await page.waitForTimeout(150);

  const movedEnds = pathEnds(await edgePath(page, newEdge));
  expect(near(movedEnds.start, await handleCenter(page, "n0", "out"))).toBe(
    true,
  );
  expect(movedEnds.start.x).toBeGreaterThan(ends.start.x + 20);
});

test("proof 18: a rejected connection leaves the graph alone", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = Number(await attr(page, "data-edges"));
  const out = await screenBox(
    page,
    '.fflow__node[data-nodeid="n3"] .fflow__handle[data-handleid="out"]',
  );
  const own = await screenBox(
    page,
    '.fflow__node[data-nodeid="n3"] .fflow__handle[data-handleid="in"]',
  );
  const taken = await screenBox(
    page,
    '.fflow__node[data-nodeid="n4"] .fflow__handle[data-handleid="in"]',
  );

  // A self-loop: the pointer really is over n3's own target handle, and the
  // predicate is what stops it becoming an edge.
  await pressAndSlide(page, out, own, 6);
  expect(await attr(page, "data-gesture")).toBe("Connecting");
  expect(await attr(page, "data-connection-target")).toBe("n3:in");
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await attr(page, "data-gesture")).toBe("Idle");
  expect(await attr(page, "data-edges")).toBe(String(before));
  expect(await attr(page, "data-last-edge")).toBe("");

  // A duplicate: the fixture already has n3 -> n4 on exactly these handles.
  await pressAndSlide(page, out, taken, 6);
  expect(await attr(page, "data-connection-target")).toBe("n4:in");
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await attr(page, "data-edges")).toBe(String(before));
  expect(await attr(page, "data-last-edge")).toBe("");
});

test("proof 19: dragging an edge end reconnects it", async ({ page }) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const edges = Number(await attr(page, "data-edges"));
  const before = pathEnds(await edgePath(page, "e1"));
  expect(near(before.start, await handleCenter(page, "n0", "out"))).toBe(true);

  const viewportTransform = () =>
    page
      .locator("[data-fflow-viewport]")
      .getAttribute("style")
      .then(
        (style) =>
          /translate\([^)]*\)\s*scale\([^)]*\)/.exec(style ?? "")?.[0] ?? "",
      );
  const viewportBefore = await viewportTransform();

  // The grab ring around e1's target end. It is an annulus: the handle at its
  // centre still starts a new connection, so the press has to land on the ring —
  // 10 flow units out along the side the handle faces, which for n1's `in`
  // handle is the gap between n0 and n1.
  const grab = await screenBox(
    page,
    '.fflow__edge[data-edgeid="e1"] [data-edgeend="Target"]',
  );
  const outward = await outwardOf(page, "n1", "in");
  const ring = await zoomOf(page).then((zoom) => ({
    x: grab.x + outward.x * 10 * zoom,
    y: grab.y + outward.y * 10 * zoom,
  }));
  const destination = await screenBox(
    page,
    '.fflow__node[data-nodeid="n5"] .fflow__handle[data-handleid="in"]',
  );

  await page.mouse.move(ring.x, ring.y);
  await page.mouse.down();
  await page.waitForFunction(
    () =>
      document.querySelector("main.app")?.getAttribute("data-gesture") ===
      "Reconnecting",
    undefined,
    WAIT,
  );
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      ring.x + ((destination.x - ring.x) * step) / 8,
      ring.y + ((destination.y - ring.y) * step) / 8,
    );
    await page.waitForTimeout(16);
  }
  // The press did not start a viewport pan (`.fflow__nopan` on the grab handle).
  expect(await viewportTransform()).toBe(viewportBefore);
  expect(await attr(page, "data-connection-target")).toBe("n5:in");

  await page.mouse.up();
  await page.waitForFunction(
    () =>
      (
        document
          .querySelector("main.app")
          ?.getAttribute("data-last-reconnect") ?? ""
      ).length > 0,
    undefined,
    WAIT,
  );

  expect(await attr(page, "data-last-reconnect")).toBe("e1:Target:n5:in");
  // Reconnect moves an end; it does not create or destroy edges.
  expect(await attr(page, "data-edges")).toBe(String(edges));
  expect(await attr(page, "data-gesture")).toBe("Idle");

  const after = pathEnds(await edgePath(page, "e1"));
  expect(near(after.start, before.start)).toBe(true);
  expect(near(after.end, await handleCenter(page, "n5", "in"))).toBe(true);
});

test("proof 20: a stylesheet-only handle move needs Flow.Remeasure", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const edge = "e1";
  const before = pathEnds(await edgePath(page, edge));
  expect(near(before.start, await handleCenter(page, "n0", "out"))).toBe(true);

  // External CSS moves the handle without touching the node's subtree or its
  // own size: neither the MutationObserver nor the ResizeObserver sees it.
  const handleSelector =
    '.fflow__node[data-nodeid="n0"] .fflow__handle[data-handleid="out"]';
  const handleBoxBefore = await screenBox(page, handleSelector);

  await page.addStyleTag({
    content: `main.app .fflow__node[data-nodeid="n0"] .fflow__handle.source { right: auto; left: 40px; top: 30px; }`,
  });
  await page.waitForTimeout(250);

  // The stylesheet took effect: the handle is somewhere else on screen…
  const handleBoxAfter = await screenBox(page, handleSelector);
  expect(near(handleBoxAfter, handleBoxBefore)).toBe(false);

  // The contract's third sentence: until a remeasure, the endpoint is stale.
  const stalePath = await edgePath(page, edge);
  expect(near(pathEnds(stalePath).start, before.start)).toBe(true);

  await page.locator("#remeasure").click();
  await page.waitForFunction(
    (previous) =>
      document
        .querySelector('.fflow__edge[data-edgeid="e1"] path')
        ?.getAttribute("d") !== previous,
    stalePath,
    WAIT,
  );

  // …and one `Flow.Remeasure` is the whole fix. The endpoint is back on the
  // handle, at its new position, without a remount or a reload.
  const recovered = pathEnds(await edgePath(page, edge));
  expect(near(recovered.start, await handleCenter(page, "n0", "out"))).toBe(
    true,
  );
  expect(await attr(page, "data-pane-mounts")).toBe("1");
  expect(await attr(page, "data-measured-nodes")).toBe("630");
});

test("proof 21: a connection started at a target handle keeps its orientation", async ({
  page,
}) => {
  await page.goto(DEMO);
  await waitForMount(page);

  const before = Number(await attr(page, "data-edges"));

  // Reversed drag direction: press a Target handle and release over a Source
  // handle. The fact is still `Source → Target`, so the parent gets an edge from
  // n1 to n3 rather than an edge shaped like n3 -> n1 on a target/source pair.
  const grabbed = await screenBox(
    page,
    '.fflow__node[data-nodeid="n3"] .fflow__handle[data-handleid="in"]',
  );
  const released = await screenBox(
    page,
    '.fflow__node[data-nodeid="n1"] .fflow__handle[data-handleid="out"]',
  );

  await pressAndSlide(page, grabbed, released);
  expect(await attr(page, "data-gesture")).toBe("Connecting");
  expect(await attr(page, "data-connection-target")).toBe("n1:out");
  await page.mouse.up();

  await page.waitForFunction(
    (expected) =>
      document.querySelector("main.app")?.getAttribute("data-edges") ===
      String(expected),
    before + 1,
    WAIT,
  );

  // `data-last-edge` is `source:sourceHandle>target:targetHandle`, so this fails
  // on the reversed pair the review found (`n3:in>n1:out`).
  expect(await attr(page, "data-last-edge")).toBe("n1:out>n3:in");
});
