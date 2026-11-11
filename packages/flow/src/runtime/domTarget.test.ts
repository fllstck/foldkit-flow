import { describe, expect, test } from "vitest";

import {
  blocksDrag,
  isDeleteKeyAllowed,
  isEditableTarget,
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
