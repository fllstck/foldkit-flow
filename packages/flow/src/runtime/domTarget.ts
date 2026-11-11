import * as classes from "../view/classes.js";

const editableSelector = "input, textarea, select, [contenteditable]";

/** Where a press must not arm a drag: form controls, editable content, links,
 *  and the explicit `.fflow__nodrag` opt-out (§4.6). */
const dragBlockedSelector = `${editableSelector}, button, a, .${classes.NoDrag}`;

/** Handles and node wrappers are matched by class *or* by the data attribute the
 *  renderer already emits. The data attribute keeps the guard testable in Scene,
 *  which simulates a pointer target from attributes only. */
const handleSelector = `.${classes.Handle}, [data-handleid]`;
const nodeSelector = `.${classes.Node}, [data-nodeid]`;
/** Reconnect grab handles sit in the edges layer, outside every node, so the
 *  pane handler has to decline them explicitly. Matched by attribute as well so
 *  the guard is testable in Scene (§M1-FINDINGS §2.2). */
const edgeEndpointSelector = `.${classes.EdgeEndpoint}, [data-edgeend]`;

const closestOrNull = (
  target: EventTarget | null,
  selector: string,
): Element | null => {
  if (target === null) return null;
  // SAFETY: `closest` is exactly the capability these guards need, and testing
  // for it is narrower than `instanceof Element`: it also keeps the guard usable
  // from a Node test environment, where `Element` does not exist.
  const maybeElement = target as {
    closest?: (selector: string) => Element | null;
  };
  return maybeElement.closest === undefined
    ? null
    : maybeElement.closest(selector);
};

/** `isInputDOMNode` from §2.5.8: keys are ignored while the user is typing. */
export const isEditableTarget = (target: EventTarget | null): boolean =>
  closestOrNull(target, editableSelector) !== null;

/** Delete and Escape only reach the graph when this guard passes. */
export const isDeleteKeyAllowed = (event: Event): boolean =>
  !isEditableTarget(event.target) &&
  closestOrNull(event.target, `.${classes.NoKey}`) === null;

export const blocksDrag = (target: EventTarget | null): boolean =>
  closestOrNull(target, dragBlockedSelector) !== null;

export const isHandleTarget = (target: EventTarget | null): boolean =>
  closestOrNull(target, handleSelector) !== null;

/** A press on an edge end starts a reconnect and must not clear the selection. */
export const isEdgeEndpointTarget = (target: EventTarget | null): boolean =>
  closestOrNull(target, edgeEndpointSelector) !== null;

/** A press inside a node belongs to the node, not to the pane: the pane handler
 *  bubbles after it, so it has to decline to clear the selection. */
export const isNodeTarget = (target: EventTarget | null): boolean =>
  closestOrNull(target, nodeSelector) !== null;
