import type { Point, Rect } from "../model.js";

/** One direct child of a resized node, as the parent's graph holds it. */
export type CompensationChild = Readonly<{
  nodeId: string;
  /** The child's position **relative to its parent** — the space the flow
   *  received it in, and the space the fact comes back in. */
  position: Point;
}>;

/** A child's new relative position, ready to be persisted by the parent. */
export type CompensatedChild = Readonly<{
  nodeId: string;
  x: number;
  y: number;
}>;

export type CompensateInput = Readonly<{
  /** The parent's box when the resize began, in absolute flow space. */
  parentBefore: Rect;
  /** The parent's box after the resize, in the same space. */
  parentAfter: Rect;
  /** The parent's **direct** children. Grandchildren are not passed: they follow
   *  when their own parent is compensated. */
  children: ReadonlyArray<CompensationChild>;
}>;

/**
 * The child positions that keep a resize's children visually still (§7 M7).
 *
 * A child's position is relative to its parent, so moving the parent's top-left
 * moves the child on screen. This returns the relative positions that cancel that
 * move — upstream's `childChanges` arithmetic (`docs/M6-RESEARCH.md` §6), with the
 * origin fixed at the top-left because that is the only origin this library has
 * (`docs/M6-RESEARCH.md` §5):
 *
 * ```
 * child.x -= parentAfter.left - parentBefore.left
 * child.y -= parentAfter.top  - parentBefore.top
 * ```
 *
 * **It returns; it does not apply.** The fact the flow reports is one node's box
 * (`OutMessage.ResizedNodes`), and a consumer that does not fold these positions
 * would see its children compensate during the gesture and snap back on the next
 * render — the `docs/M4-FINDINGS.md` §14 shape. So the arithmetic is the library's
 * and the persistence is the parent's, which is the only place the graph exists.
 *
 * Three properties worth knowing:
 *
 * - **A bottom-right resize compensates nothing.** The parent's top-left did not
 *   move, so the children's relative positions are already right, and this returns
 *   them unchanged rather than pretending otherwise.
 * - **Take the parent's own `before`/`after` pair.** For a nested container that
 *   pair is in *its* parent's space — do not recompute the delta from an absolute
 *   grandparent position, or the answer is off by the grandparent's offset.
 * - **Direct children only.** A grandchild's relative position is measured from its
 *   own parent, so it is the grandchild's parent that compensates it.
 *
 * The inputs are read, never written: the Model is frozen and a helper that mutated
 * anything would be a second owner of the graph.
 */
export const compensateChildPositions = (
  input: CompensateInput,
): ReadonlyArray<CompensatedChild> => {
  const deltaX = input.parentAfter.left - input.parentBefore.left;
  const deltaY = input.parentAfter.top - input.parentBefore.top;

  return input.children.map((child) => ({
    nodeId: child.nodeId,
    x: child.position.x - deltaX,
    y: child.position.y - deltaY,
  }));
};
