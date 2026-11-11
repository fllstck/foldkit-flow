import type { Viewport } from "../model.js";

export type ViewportThrottle = Readonly<{
  offer: (viewport: Viewport) => void;
  cancel: () => void;
}>;

/** Coalesces viewport reports to one per animation frame. `cancel` drops the
 *  pending frame *and* the pending value, so a terminal Message can never be
 *  overtaken (§4.1). */
export const createViewportThrottle = (
  emit: (viewport: Viewport) => void,
): ViewportThrottle => {
  let pending: Viewport | undefined;
  let frame: number | undefined;

  const flush = () => {
    frame = undefined;
    if (pending === undefined) return;
    const next = pending;
    pending = undefined;
    emit(next);
  };

  return {
    offer: (viewport) => {
      pending = viewport;
      if (frame === undefined) frame = requestAnimationFrame(flush);
    },
    cancel: () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      pending = undefined;
    },
  };
};
