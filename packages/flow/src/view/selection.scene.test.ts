// @vitest-environment jsdom
import { Option } from "effect";
import { describe, test } from "vitest";
import { Scene } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { Message } from "../message.js";
import { Message as MessageValue } from "../message.js";
import { init } from "../model.js";
import type { FlowEdge, FlowNode } from "../model.js";
import { OutMessage } from "../outMessage.js";
import { MountNode } from "../runtime/mountNode.js";
import { MountPane } from "../runtime/mountPane.js";
import { update } from "../update.js";
import { createRenderer } from "./view.js";
import type { NodeTools } from "./view.js";

/**
 * Rung 3 of `docs/TEST-STRATEGY.md`: the real view, the real `update`, no layout.
 *
 * The M6 claims that live *between* rungs 2 and 5: an edge is a press target that
 * dispatches `PressedEdge` (and a pane press that did not become a pane press), the
 * edge group is a named tab stop, and the layer stops being hidden from assistive
 * technology when the feature is on. Story cannot see any of them (they are wiring
 * in the view) and Playwright sees them only on a screen later (`tests/m6.spec.ts`).
 *
 * What is deliberately *not* here: the drag arithmetic (`state.test.ts`, rung 2) and
 * the minimap's screen mapping, because jsdom has no layout and `getScreenCTM()`
 * returns null — a green test there would prove nothing (`docs/TEST-STRATEGY.md`).
 * The minimap drag is proved at rung 5.
 */
const paneId = "selection-pane";

const nodes: ReadonlyArray<FlowNode<{ label: string }>> = [
  {
    id: "n1",
    position: { x: 0, y: 0 },
    size: { width: 160, height: 60 },
    data: { label: "Node one" },
  },
  {
    id: "n2",
    position: { x: 400, y: 0 },
    size: { width: 160, height: 60 },
    data: { label: "Node two" },
  },
];

const edges: ReadonlyArray<FlowEdge> = [
  { id: "e1", source: "n1", target: "n2", label: "flows to" },
];

const renderNode = (
  _node: FlowNode<{ label: string }>,
  tools: NodeTools,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("node-shell")],
    [
      h.span([h.Class("node-title")], ["Node"]),
      tools.handle({ id: "out", type: "Source", position: "Right" }),
      tools.handle({ id: "in", type: "Target", position: "Left" }),
    ],
  );

const renderer = createRenderer<{ label: string }, unknown>({
  paneId,
  renderNode,
  edgeSelection: true,
  accessibleName: (node) => node.data.label,
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

const { scene, given, pointerDown, expect, selector } = Scene;
const { expectNoOutMessage } = Scene;

const resolveMounts = () => [
  Scene.Mount.resolve(MountPane, MessageValue.MountedPane({ paneId })),
  Scene.Mount.resolve(
    MountNode,
    MessageValue.MeasuredNode({
      nodeId: "n1",
      size: { width: 160, height: 60 },
    }),
  ),
  Scene.Mount.resolve(
    MountNode,
    MessageValue.MeasuredNode({
      nodeId: "n2",
      size: { width: 160, height: 60 },
    }),
  ),
];

describe("an edge is a press target (§7 M6)", () => {
  test("pressing the edge's hit path selects the edge", () => {
    scene(
      { update: sceneUpdate, view },
      given(modelOf({ selectedNodeIds: ["n1"] })),
      ...resolveMounts(),
      pointerDown(".fflow__edge-interaction"),
      // The claim: the view dispatched the edge Message, and the node selection
      // went with it — one press selects one kind of thing.
      expect(selector(".fflow__edge--selected")).toExist(),
      Scene.expectOutMessage(
        OutMessage.SelectedElements({ nodeIds: [], edgeIds: ["e1"] }),
      ),
    );
  });

  test("the pane declines an edge press, so the selection survives", () => {
    scene(
      { update: sceneUpdate, view },
      given(modelOf({ selectedEdgeIds: ["e1"] })),
      ...resolveMounts(),
      // A press inside the edge group bubbles to the pane's own pointer handler.
      // Without the `isEdgeTarget` guard the pane would clear the selection the
      // edge press had just made, and the two would fight on every click.
      pointerDown(".fflow__edge-interaction"),
      expectNoOutMessage(),
    );
  });

  test("the edge is a named tab stop, not a picture", () => {
    scene(
      { update: sceneUpdate, view },
      given(modelOf({ selectedEdgeIds: ["e1"] })),
      ...resolveMounts(),
      expect(selector(".fflow__edge")).toHaveAttr("tabindex", "0"),
      expect(selector(".fflow__edge")).toHaveAttr("role", "button"),
      expect(selector(".fflow__edge")).toHaveAttr("aria-pressed", "true"),
      // The name comes from the consumer's own `accessibleName` hook, so the tab
      // order and the description region call the same nodes the same words.
      expect(selector(".fflow__edge")).toHaveAttr(
        "aria-label",
        "Edge from Node one to Node two: flows to",
      ),
    );
  });

  test("the edges layer is no longer hidden from assistive technology", () => {
    // A focusable descendant of an `aria-hidden` subtree is an ARIA violation, so
    // the attribute moves with the feature. With `edgeSelection` off it stays,
    // which `markers.test.ts` still asserts (`aria-hidden="true"`).
    scene(
      { update: sceneUpdate, view },
      given(modelOf()),
      ...resolveMounts(),
      expect(selector(".fflow__edges")).not.toHaveAttr("aria-hidden"),
    );
  });

  // Enter/Space on a focused edge is *not* here: the flow's keyboard handling is a
  // document-level Subscription (`runtime/subscriptions.ts`), not a handler on the
  // element, so Scene cannot see it — `Scene.Subscription.emit` would feed the
  // Message in and prove nothing about the guard. The fact is rung 2
  // (`state.test.ts`, "Enter on the focused edge"), and the wiring is rung 5
  // (`tests/m6.spec.ts`, which presses Tab and Enter on a real page).
});
