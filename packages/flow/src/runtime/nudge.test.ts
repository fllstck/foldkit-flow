import { Option } from "effect";
import { describe, expect, test } from "vitest";

import { nudgeDelta, nudgeLargeStep, nudgeStep } from "./nudge.js";

const plain = { shiftKey: false };
const shifted = { shiftKey: true };

describe("nudgeDelta", () => {
  test.each([
    ["ArrowUp", { x: 0, y: -nudgeStep }],
    ["ArrowDown", { x: 0, y: nudgeStep }],
    ["ArrowLeft", { x: -nudgeStep, y: 0 }],
    ["ArrowRight", { x: nudgeStep, y: 0 }],
  ])("%s moves one step", (key, expected) => {
    expect(nudgeDelta(key, plain)).toEqual(Option.some(expected));
  });

  test("Shift multiplies the step", () => {
    expect(nudgeDelta("ArrowRight", shifted)).toEqual(
      Option.some({ x: nudgeLargeStep, y: 0 }),
    );
  });

  test("every other key nudges nothing", () => {
    expect(nudgeDelta("Enter", plain)).toEqual(Option.none());
    expect(nudgeDelta("a", plain)).toEqual(Option.none());
    // Delete and Escape are handled elsewhere; they must not also be nudges.
    expect(nudgeDelta("Delete", plain)).toEqual(Option.none());
  });
});
