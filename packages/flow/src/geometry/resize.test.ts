import { describe, expect, test } from "vitest";

import type { Rect } from "../model.js";
import {
  minResizeHeight,
  minResizeWidth,
  resizeControls,
  resizeRect,
} from "./resize.js";

/** A 100×50 box at (200, 300). */
const start: Rect = { left: 200, top: 300, width: 100, height: 50 };

const at = (x: number, y: number) => ({ x, y });

describe("resizeRect (§7 M4)", () => {
  test("bottom-right grows from the top-left corner", () => {
    const rect = resizeRect(start, "bottom-right", at(260, 330));
    expect(rect).toEqual({ left: 200, top: 300, width: 60, height: 30 });
  });

  test("top-left grows from the bottom-right corner", () => {
    const rect = resizeRect(start, "top-left", at(220, 310));
    // The anchor is (300, 350): the new box starts where the pointer is and ends
    // where the corner was.
    expect(rect).toEqual({ left: 220, top: 310, width: 80, height: 40 });
  });

  test("an edge control only moves that edge", () => {
    // A `right` drag must not change the height, and an off-axis pointer must not
    // creep into it.
    const rect = resizeRect(start, "right", at(260, 9999));
    expect(rect).toEqual({ left: 200, top: 300, width: 60, height: 50 });

    const bottom = resizeRect(start, "bottom", at(-100, 330));
    expect(bottom).toEqual({ left: 200, top: 300, width: 100, height: 30 });
  });

  test("every control keeps the opposite edge fixed", () => {
    const cases = {
      "top-left": { left: 300, top: 350 },
      top: { left: 200, top: 350 },
      "top-right": { left: 200, top: 350 },
      right: { left: 200, top: 300 },
      "bottom-right": { left: 200, top: 300 },
      bottom: { left: 200, top: 300 },
      "bottom-left": { left: 300, top: 300 },
      left: { left: 300, top: 300 },
    } as const;

    resizeControls.forEach((control) => {
      const rect = resizeRect(start, control, at(260, 330));
      const anchor = cases[control];
      // The anchor corner/edge is where it was: `left` stays for controls that
      // move the left edge and the right edge stays for the ones that do not.
      if (control.endsWith("left")) {
        expect(rect.left + rect.width).toBe(anchor.left);
      }
      if (control.endsWith("right")) {
        expect(rect.left).toBe(anchor.left);
      }
      if (control.startsWith("top-") || control === "top") {
        expect(rect.top + rect.height).toBe(anchor.top);
      }
      if (control.startsWith("bottom") || control === "bottom") {
        expect(rect.top).toBe(anchor.top);
      }
    });
  });

  test("a node cannot be resized below the minimum, in either direction", () => {
    const tiny = resizeRect(start, "bottom-right", at(-500, -500));
    expect(tiny.width).toBe(minResizeWidth);
    expect(tiny.height).toBe(minResizeHeight);

    // From the other side the minimum is taken off the opposite edge, so the box
    // does not escape to the left of the anchor.
    const fromTopLeft = resizeRect(start, "top-left", at(1000, 1000));
    expect(fromTopLeft.width).toBe(minResizeWidth);
    expect(fromTopLeft.left).toBe(300 - minResizeWidth);
  });

  test("a snap grid moves the dragged edge onto multiples", () => {
    const rect = resizeRect(start, "bottom-right", at(263, 331), {
      snapGrid: { x: 20, y: 20 },
    });
    // The pointer snaps to (260, 340): the width is 60, the height 40? No —
    // (260, 340) is the snapped pointer, so the box ends there.
    expect(rect).toEqual({ left: 200, top: 300, width: 60, height: 40 });
    // Without a grid the same pointer gives the unsnapped box.
    expect(resizeRect(start, "bottom-right", at(263, 331)).width).toBe(63);
  });

  test("minWidth and minHeight are overridable", () => {
    const rect = resizeRect(start, "bottom-right", at(0, 0), {
      minWidth: 50,
      minHeight: 30,
    });
    expect(rect.width).toBe(50);
    expect(rect.height).toBe(30);
  });
});
