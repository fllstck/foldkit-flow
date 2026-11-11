import { describe, expect, test } from "vitest";

import { edgePath } from "./paths.js";

describe("edgePath", () => {
  test("straight produces the engine d string", () => {
    expect(
      edgePath("Straight", {
        sourceX: 0,
        sourceY: 0,
        targetX: 100,
        targetY: 100,
      }).d,
    ).toBe("M 0,0L 100,100");
  });

  test("bezier produces the engine d string", () => {
    expect(
      edgePath("Bezier", {
        sourceX: 0,
        sourceY: 0,
        targetX: 100,
        targetY: 100,
        sourcePosition: "Bottom",
        targetPosition: "Top",
      }).d,
    ).toBe("M0,0 C0,50 100,50 100,100");
  });

  test("smooth step and step produce the engine d strings", () => {
    const input = {
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 100,
      sourcePosition: "Bottom" as const,
      targetPosition: "Top" as const,
    };
    expect(edgePath("SmoothStep", input).d).toBe(
      "M0 0L 0,45Q 0,50 5,50L 95,50Q 100,50 100,55L100 100",
    );
    expect(edgePath("Step", input).d).toBe(
      "M0 0L 0,50Q 0,50 0,50L 100,50Q 100,50 100,50L100 100",
    );
  });
});
