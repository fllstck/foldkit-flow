import { describe, expect, test } from "vitest";

import {
  blocksDrag,
  isChromeTarget,
  isDeleteKeyAllowed,
  isEdgeEndpointTarget,
  isEditableTarget,
  nudgedNodeId,
} from "./domTarget.js";

/**
 * The guards only need `closest`, so a stand-in that answers for a fixed set of
 * selector fragments exercises every branch without a DOM.
 */
const fakeTarget = (matches: ReadonlyArray<string>): EventTarget =>
  ({
    closest: (selector: string) =>
      matches.some((fragment) => selector.includes(fragment))
        ? { selector }
        : null,
  }) as unknown as EventTarget;
const fakeEvent = (target: EventTarget | null): Event => ({ target }) as Event;

describe("editable-target guard", () => {
  test.each([
    ["input", "input"],
    ["textarea", "textarea"],
    ["select", "select"],
    ["contenteditable", "[contenteditable]"],
    ["nokey", ".fflow__nokey"],
  ])("%s targets block Delete and Escape", (_name, fragment) => {
    expect(isDeleteKeyAllowed(fakeEvent(fakeTarget([fragment])))).toBe(false);
  });

  test("a plain target allows the keys", () => {
    expect(isDeleteKeyAllowed(fakeEvent(fakeTarget([])))).toBe(true);
  });

  test("a null target allows the keys", () => {
    expect(isDeleteKeyAllowed(fakeEvent(null))).toBe(true);
  });

  test("editable detection is independent of the nokey opt-out", () => {
    expect(isEditableTarget(fakeTarget(["input"]))).toBe(true);
    expect(isEditableTarget(fakeTarget([".fflow__nokey"]))).toBe(false);
  });
});

describe("drag guard", () => {
  test.each([
    ["button", "button"],
    ["input", "input"],
    ["nodrag", ".fflow__nodrag"],
  ])("%s targets do not arm a drag", (_name, fragment) => {
    expect(blocksDrag(fakeTarget([fragment]))).toBe(true);
  });

  test("a plain target arms a drag", () => {
    expect(blocksDrag(fakeTarget([]))).toBe(false);
  });
});

describe("edge endpoint guard", () => {
  test("an edge end is neither pane nor node", () => {
    // Matched by class or by the attribute the renderer emits, like the handle
    // and node guards, so Scene's attribute-only targets hit it too.
    expect(isEdgeEndpointTarget(fakeTarget([".fflow__edge-endpoint"]))).toBe(
      true,
    );
    expect(isEdgeEndpointTarget(fakeTarget(["[data-edgeend]"]))).toBe(true);
    expect(isEdgeEndpointTarget(fakeTarget([]))).toBe(false);
    expect(isEdgeEndpointTarget(null)).toBe(false);
  });
});

describe("chrome guard", () => {
  test("a press on chrome is not a pane press", () => {
    // One attribute covers controls, the minimap and consumer panels, so a panel
    // built without `classes` is exempt too.
    expect(isChromeTarget(fakeTarget(["[data-fflow-chrome]"]))).toBe(true);
    expect(isChromeTarget(fakeTarget([]))).toBe(false);
    expect(isChromeTarget(null)).toBe(false);
  });
});

describe("nudged node", () => {
  const nodeTarget = (nodeId: string): EventTarget =>
    ({
      closest: (selector: string) =>
        selector.includes("data-nodeid")
          ? { getAttribute: () => nodeId }
          : null,
    }) as unknown as EventTarget;

  test("the focused node is the one the event target belongs to", () => {
    expect(nudgedNodeId(nodeTarget("n1"))).toBe("n1");
  });

  test("a keystroke outside every node nudges nothing", () => {
    expect(nudgedNodeId(fakeTarget([]))).toBe(null);
    expect(nudgedNodeId(null)).toBe(null);
  });
});
