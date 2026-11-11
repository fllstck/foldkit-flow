import type { HandlePosition } from "../model.js";
import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  toUpstreamPosition,
} from "../runtime/adapter.js";

export type EdgePathKind = "Bezier" | "Straight" | "Step" | "SmoothStep";

export type EdgePathInput = Readonly<{
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: HandlePosition;
  targetPosition?: HandlePosition;
  curvature?: number;
}>;

export type EdgeGeometry = Readonly<{
  d: string;
  labelX: number;
  labelY: number;
  offsetX: number;
  offsetY: number;
}>;

type UpstreamPositionValue = ReturnType<typeof toUpstreamPosition>;

type Positions = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: UpstreamPositionValue;
  targetPosition?: UpstreamPositionValue;
};

type PathTuple = [string, number, number, number, number];

const toGeometry = ([
  d,
  labelX,
  labelY,
  offsetX,
  offsetY,
]: PathTuple): EdgeGeometry => ({
  d,
  labelX,
  labelY,
  offsetX,
  offsetY,
});

export const edgePath = (
  kind: EdgePathKind,
  input: EdgePathInput,
): EdgeGeometry => {
  const positions: Positions = {
    sourceX: input.sourceX,
    sourceY: input.sourceY,
    targetX: input.targetX,
    targetY: input.targetY,
  };
  if (input.sourcePosition !== undefined) {
    positions.sourcePosition = toUpstreamPosition(input.sourcePosition);
  }
  if (input.targetPosition !== undefined) {
    positions.targetPosition = toUpstreamPosition(input.targetPosition);
  }

  const builders: Record<EdgePathKind, () => PathTuple> = {
    Straight: () => getStraightPath(positions),
    Step: () => getSmoothStepPath({ ...positions, borderRadius: 0 }),
    SmoothStep: () => getSmoothStepPath(positions),
    Bezier: () =>
      input.curvature === undefined
        ? getBezierPath(positions)
        : getBezierPath({ ...positions, curvature: input.curvature }),
  };

  return toGeometry(builders[kind]());
};
