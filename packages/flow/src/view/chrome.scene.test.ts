// @vitest-environment jsdom
import { Option } from "effect";
import { Scene } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { describe, test } from "vitest";

import { Message } from "../message.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode } from "../model.js";
import { SyncViewport } from "../runtime/command.js";
import { MountNode } from "../runtime/mountNode.js";
import { MountPane } from "../runtime/mountPane.js";
import { update } from "../update.js";
import { createRenderer } from "./view.js";
import type { NodeTools } from "./view.js";

/**
 * Rung 3 of `docs/TEST-STRATEGY.md`: the real view, the real `update`, no layout.
 *
 * These are the claims that sit *between* rungs 2 and 5 — a control drawn by the
 * library dispatching the library Message that reaches the engine, and a press on
 * chrome not becoming a pane press. Story cannot see them (they are wiring in the
 * view), and Playwright sees them only by watching the screen a few seconds later
 * (`chrome.spec.ts` proofs 23 and 25).
 *
 * What is deliberately *not* here: the zoom clamp itself (`state.test.ts`: "zoom
 * in stops at the Model's maxZoom, with no Command to run" — rung 2), and the
 * transform the engine ends up with (proof 23 — rung 5).
 */
const paneId = "chrome-pane";

const nodes: ReadonlyArray<FlowNode<{ label: string }>> = [
  {
    id: "n1",
    position: { x: 0, y: 0 },
    size: { width: 160, height: 60 },
    data: { label: "Node one" },
  },
];

const edges: ReadonlyArray<FlowEdge> = [];

const renderNode = (
  _node: FlowNode<{ label: string }>,
  tools: NodeTools,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("node-shell")],
    [
      h.span([h.Class("node-title")], ["Node one"]),
      tools.handle({ id: "out", type: "Source", position: "Right" }),
      tools.handle({ id: "in", type: "Target", position: "Left" }),
    ],
  );

const renderer = createRenderer<{ label: string }, unknown>({
  paneId,
  renderNode,
  controls: true,
});

const toParentMessage = (message: Message): Message => message;

const modelOf = (overrides?: Partial<ReturnType<typeof init>["model"]>) => ({
  ...init({ x: 0, y: 0, zoom: 1 }).model,
  pane: { width: 800, height: 600, left: 0, top: 0 },
  paneId: Option.some(paneId),
  ...overrides,
});

const view = (
  model: ReturnType<typeof modelOf>,
  h: HtmlBuilder<Message>,
): Html => renderer.view({ model, nodes, edges, toParentMessage }, h);

const sceneUpdate = (model: ReturnType<typeof modelOf>, message: Message) =>
  update(model, message, { nodes, edges });

const { scene, given, click, pointerDown, Command, expect, selector } = Scene;
const { expectNoOutMessage } = Scene;

/** Every Mount in the tree has to be acknowledged before Scene dispatches. */
const resolveMounts = () => [
  Scene.Mount.resolve(MountPane, Message.MountedPane({ paneId })),
  Scene.Mount.resolve(
    MountNode,
    Message.MeasuredNode({ nodeId: "n1", size: { width: 160, height: 60 } }),
  ),
];

describe("the library's own controls", () => {
  test("a zoom press reaches the engine, not only the Model", () => {
    scene(
      { update: sceneUpdate, view },
      given(modelOf()),
      ...resolveMounts(),
      click('[data-fflow-control="ZoomIn"]'),
      // The claim: the press produced a sync. Without it the Model would hold
      // 1.2 and the engine would stay at 1 — the divergence that made a pan jump
      // (`M5-FINDINGS` §8.2).
      Command.expectHas(SyncViewport),
      Command.resolve(
        SyncViewport,
        Message.CompletedSyncViewport({
          viewport: { x: 0, y: 0, zoom: 1.2 },
        }),
      ),
    );
  });

  test("a fit press asks the engine to sync to the fitted viewport", () => {
    scene(
      { update: sceneUpdate, view },
      given(modelOf({ viewport: { x: 40, y: 40, zoom: 1.5 } })),
      ...resolveMounts(),
      click('[data-fflow-control="FitView"]'),
      Command.expectHas(SyncViewport),
      Command.resolve(
        SyncViewport,
        Message.CompletedSyncViewport({
          viewport: { x: 40, y: 40, zoom: 1 },
        }),
      ),
    );
  });

  test("a press on chrome is not a pane press, so the selection survives", () => {
    scene(
      { update: sceneUpdate, view },
      given(modelOf({ selectedNodeIds: ["n1"] })),
      ...resolveMounts(),
      // A press on a control bubbles to the pane's own pointer handler, which
      // declines it because the control carries `data-fflow-chrome`. Without that
      // guard the pane handler would clear the selection and emit
      // `SelectedElements`, which the parent would apply.
      pointerDown('[data-fflow-control="ZoomIn"]'),
      Scene.expectIgnored(),
      expectNoOutMessage(),
      Command.expectNone(),
    );
  });

  test("the controls carry the names a screen reader announces", () => {
    scene(
      { update: sceneUpdate, view },
      given(modelOf()),
      ...resolveMounts(),
      expect(selector('[data-fflow-control="ZoomIn"]')).toHaveAttr(
        "aria-label",
        "Zoom in",
      ),
      expect(selector('[data-fflow-control="ZoomOut"]')).toHaveAttr(
        "aria-label",
        "Zoom out",
      ),
      expect(selector('[data-fflow-control="FitView"]')).toHaveAttr(
        "aria-label",
        "Fit view",
      ),
    );
  });
});
