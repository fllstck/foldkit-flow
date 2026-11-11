import { Effect } from "effect";
import { Server } from "foldkit/experimental";
import { describe, expect, test } from "vitest";

import { Message } from "../message.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode, Model } from "../model.js";
import { createRenderer } from "./view.js";
import type { RendererConfig } from "./view.js";

type Data = Readonly<{ label: string }>;

const nodes: ReadonlyArray<FlowNode<Data>> = [
  {
    id: "a",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
    data: { label: "Alpha" },
  },
  {
    id: "b",
    position: { x: 400, y: 200 },
    size: { width: 100, height: 40 },
    data: { label: "Beta" },
  },
];

const edges: ReadonlyArray<FlowEdge> = [{ id: "e1", source: "a", target: "b" }];

const baseModel: Model = {
  ...init({ x: 40, y: 60, zoom: 1 }).model,
  pane: { width: 900, height: 600, left: 0, top: 0 },
};

const render = async (
  model: Model,
  config?: Partial<RendererConfig<Data, unknown>>,
): Promise<string> => {
  const renderer = createRenderer<Data, unknown>({
    paneId: "chrome-pane",
    renderNode: (node, tools, h) =>
      h.div(
        [h.Class("demo-node")],
        [
          node.data.label,
          tools.handle({ id: "out", type: "Source", position: "Right" }),
        ],
      ),
    ...config,
  });

  const view = (current: Model, h: Parameters<typeof renderer.view>[1]) => ({
    title: "chrome",
    body: renderer.view(
      {
        model: current,
        nodes,
        edges,
        toParentMessage: (message: Message) => message,
      },
      h,
    ),
  });

  const rendered = await Effect.runPromise(
    Server.renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false },
    ),
  );
  return rendered.html;
};

/** The `background-position` / `background-size` pair, which is the whole
 *  transform-awareness claim for the CSS pattern. */
const backgroundStyle = (html: string): string => {
  const match = /class="fflow__background"[^>]*style="([^"]*)"/.exec(html);
  return match?.[1] ?? "";
};

describe("Background", () => {
  test("is absent unless configured", async () => {
    expect(await render(baseModel)).not.toContain("fflow__background");
  });

  test("dots carry the viewport translate and the zoomed pitch", async () => {
    const html = await render(baseModel, { background: { variant: "dots" } });
    const style = backgroundStyle(html);

    expect(style).toContain("background-position: 40px 60px");
    // gap 20 × zoom 1
    expect(style).toContain("background-size: 20px 20px");
    expect(style).toContain("radial-gradient");
    expect(html).toContain('data-fflow-background="dots"');
  });

  test("lines are a second pattern, and both follow the transform", async () => {
    const zoomed: Model = {
      ...baseModel,
      viewport: { x: -80, y: 20, zoom: 2 },
    };
    const html = await render(zoomed, {
      background: { variant: "lines", gap: 30 },
    });
    const style = backgroundStyle(html);

    expect(style).toContain("linear-gradient");
    expect(style).toContain("background-position: -80px 20px");
    expect(style).toContain("background-size: 60px 60px");
  });

  test("the pattern is outside the transformed viewport", async () => {
    // Were it inside, the content transform would scale the dots themselves and
    // the background would double-apply the zoom.
    const html = await render(baseModel, { background: { variant: "dots" } });
    const backgroundIndex = html.indexOf("fflow__background");
    const viewportIndex = html.indexOf("fflow__viewport");
    expect(backgroundIndex).toBeGreaterThan(-1);
    expect(backgroundIndex).toBeLessThan(viewportIndex);
  });
});

describe("Controls", () => {
  test("render three buttons that dispatch library Messages", async () => {
    const html = await render(baseModel, { controls: true });

    expect(html).toContain('data-fflow-controls=""');
    expect(html).toContain('data-fflow-control="ZoomIn"');
    expect(html).toContain('data-fflow-control="ZoomOut"');
    expect(html).toContain('data-fflow-control="FitView"');
    // Accessible names, not glyph-only buttons.
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Fit view"');
  });

  test("chrome opts out of panning and of the pane's selection reset", async () => {
    const html = await render(baseModel, { controls: true });
    const controls = /class="fflow__controls[^"]*"/.exec(html)?.[0] ?? "";

    // `NoPan`: the d3 filter checks `target.closest`, so the buttons inherit it.
    expect(controls).toContain("fflow__nopan");
    // `data-fflow-chrome`: what the pane's own handler declines.
    expect(controls).toBeTruthy();
    expect(html).toContain("data-fflow-chrome");
  });

  test("are absent unless configured", async () => {
    expect(await render(baseModel)).not.toContain("fflow__controls");
  });
});

describe("MiniMap", () => {
  test("draws every node plus the plain viewport rectangle", async () => {
    const html = await render(baseModel, { minimap: true });

    expect(html).toContain('data-fflow-minimap=""');
    expect(html.match(/class="fflow__minimap-node"/g) ?? []).toHaveLength(2);
    // The viewport rect is the pane box in flow space — not the culling region,
    // which is three screens wide and a fifth of the pane.
    expect(html).toContain('width="900"');
    expect(html).toContain('height="600"');
    expect(html).toContain('x="-40"');
    expect(html).toContain('y="-60"');
  });

  test("the viewport rectangle follows the viewport", async () => {
    const panned: Model = {
      ...baseModel,
      viewport: { x: -400, y: -200, zoom: 2 },
    };
    const html = await render(panned, { minimap: true });

    // left = 400/2, top = 200/2, width = 900/2, height = 600/2
    expect(html).toContain('x="200"');
    expect(html).toContain('y="100"');
    expect(html).toContain('width="450"');
    expect(html).toContain('height="300"');
  });

  test("is absent unless configured", async () => {
    expect(await render(baseModel)).not.toContain("fflow__minimap");
  });

  test("a press on the minimap is a press target of its own", async () => {
    // It carries `NoPan` and the chrome attribute, so neither d3 nor the pane's
    // handler treats the press as a viewport gesture (§4.6, §7 M4).
    const html = await render(baseModel, { minimap: true });
    expect(html).toContain('class="fflow__minimap fflow__nopan"');
    expect(html).toContain('data-fflow-chrome=""');
  });
});

describe("focusable nodes", () => {
  test("a node is a named, focusable toggle button", async () => {
    const html = await render(baseModel, {
      accessibleName: (node) => node.data.label,
    });

    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Alpha"');
    expect(html).toContain('aria-label="Beta"');
  });

  test("the accessible name falls back to the node id", async () => {
    // The flow cannot read `node.data`, so an unconfigured flow still names the
    // node rather than leaving it anonymous.
    const html = await render(baseModel);
    expect(html).toContain('aria-label="a"');
  });

  test("selection is announced as the pressed state", async () => {
    const withSelection: Model = { ...baseModel, selectedNodeIds: ["a"] };
    const html = await render(withSelection);
    expect(html).toContain('aria-pressed="true"');
  });
});

describe("description region", () => {
  test("lists the nodes and their connections, visually hidden", async () => {
    const html = await render(baseModel, {
      accessibleName: (node) => node.data.label,
    });

    expect(html).toContain('data-fflow-description=""');
    expect(html).toContain('role="region"');
    expect(html).toContain('id="fflow-description-chrome-pane"');
    expect(html).toContain("Flow graph: 2 nodes and 1 connections.");
    expect(html).toContain("Node 1 of 2: Alpha, connects to Beta.");
    expect(html).toContain("Node 2 of 2: Beta, connected from Alpha.");
    // Visually hidden rather than removed: `display: none` would take it out of
    // the accessibility tree too.
    expect(html).toContain("clip-path: inset(50%)");
  });

  test("it is not a live region", async () => {
    // A live region that changed on every commit would be unusable, so the
    // region is described, not announced.
    const html = await render(baseModel);
    expect(html).not.toContain("aria-live");
  });

  test("it sits outside the transformed viewport", async () => {
    const html = await render(baseModel);
    const viewportIndex = html.indexOf("fflow__viewport");
    expect(html.indexOf("fflow__description")).toBeGreaterThan(viewportIndex);
  });
});

describe("panel", () => {
  test("renders consumer markup inside the pane, with the chrome opt-outs", async () => {
    const renderer = createRenderer<Data, unknown>({
      paneId: "panel-pane",
      renderNode: (node, _tools, h) => h.div([], [node.data.label]),
    });

    const view = (current: Model, h: Parameters<typeof renderer.view>[1]) => ({
      title: "panel",
      body: renderer.view(
        {
          model: current,
          nodes,
          edges,
          toParentMessage: (message: Message) => message,
          panel: h.div([h.Id("consumer-panel")], ["Consumer"]),
        },
        h,
      ),
    });

    const html = await Effect.runPromise(
      Server.renderToString(
        { init: () => ({ model: baseModel }), view },
        { isHydratable: false },
      ),
    );

    expect(html.html).toContain('id="consumer-panel"');
    // Inside the pane, after the viewport.
    expect(html.html.indexOf("consumer-panel")).toBeGreaterThan(
      html.html.indexOf("fflow__viewport"),
    );
  });
});

describe("description memo identity", () => {
  /**
   * The review of M3 raised the possibility that the description rebuilds on
   * every render — which a pan would pay for once per frame — because a memo
   * input might be rebuilt per render. It is not: `accessibleNameOf` is created
   * once per renderer (`view.ts`), the other inputs are the parent's arrays, and
   * the slot therefore survives a viewport-only render.
   *
   * Counted through the public hook rather than by inspecting VNodes: with N
   * nodes, one render calls `accessibleName` N times for the node wrappers and —
   * only when the description is rebuilt — N more for its text.
   */
  const nameCallsOverTwoRenders = async (
    first: Model,
    second: Model,
  ): Promise<ReadonlyArray<number>> => {
    const counts: Array<number> = [];
    const renderer = createRenderer<Data, unknown>({
      paneId: "memo-pane",
      renderNode: (node, _tools, h) => h.div([], [node.data.label]),
      accessibleName: (node) => {
        counts.push(1);
        return node.data.label;
      },
    });

    const view = (current: Model, h: Parameters<typeof renderer.view>[1]) => ({
      title: "memo",
      body: renderer.view(
        {
          model: current,
          nodes,
          edges,
          toParentMessage: (message: Message) => message,
        },
        h,
      ),
    });

    const renderOnce = (current: Model) =>
      Effect.runPromise(
        Server.renderToString(
          { init: () => ({ model: current }), view },
          { isHydratable: false },
        ),
      );

    await renderOnce(first);
    const afterFirst = counts.length;
    await renderOnce(second);

    return [afterFirst, counts.length - afterFirst];
  };

  test("a viewport-only render does not rebuild it", async () => {
    // nodes.length names per render, plus names for the description's text on a
    // rebuild only. Two nodes here.
    const [first, second] = await nameCallsOverTwoRenders(baseModel, {
      ...baseModel,
      viewport: { x: -300, y: -200, zoom: 2 },
    });

    expect(first).toBe(4);
    expect(second).toBe(2);
  });

  test("selection and node sizes are not description inputs", async () => {
    const [first, second] = await nameCallsOverTwoRenders(baseModel, {
      ...baseModel,
      selectedNodeIds: ["a"],
    });

    // Selection is not a description input either: it is a node-wrapper
    // concern, so the text is reused here too.
    expect(first).toBe(4);
    expect(second).toBe(2);

    const [, afterGraphChange] = await nameCallsOverTwoRenders(baseModel, {
      ...baseModel,
      nodeSizes: [{ nodeId: "a", width: 120, height: 60 }],
    });
    // `nodeSizes` alone does not change the description's text either.
    expect(afterGraphChange).toBe(2);
  });

  test("a different graph rebuilds it", async () => {
    const counts: Array<number> = [];
    const renderer = createRenderer<Data, unknown>({
      paneId: "memo-pane-2",
      renderNode: (node, _tools, h) => h.div([], [node.data.label]),
      accessibleName: (node) => {
        counts.push(1);
        return node.data.label;
      },
    });

    const view = (
      current: { model: Model; nodes: ReadonlyArray<FlowNode<Data>> },
      h: Parameters<typeof renderer.view>[1],
    ) => ({
      title: "memo",
      body: renderer.view(
        {
          model: current.model,
          nodes: current.nodes,
          edges,
          toParentMessage: (message: Message) => message,
        },
        h,
      ),
    });

    const renderOnce = (current: {
      model: Model;
      nodes: ReadonlyArray<FlowNode<Data>>;
    }) =>
      Effect.runPromise(
        Server.renderToString(
          { init: () => ({ model: current }), view },
          { isHydratable: false },
        ),
      );

    await renderOnce({ model: baseModel, nodes });
    const first = counts.length;
    // A new nodes array is a new graph: the description is rebuilt, so the hook
    // is called once more per node than a reuse would.
    await renderOnce({ model: baseModel, nodes: [...nodes] });

    expect(first).toBe(4);
    expect(counts.length - first).toBe(4);
  });
});
