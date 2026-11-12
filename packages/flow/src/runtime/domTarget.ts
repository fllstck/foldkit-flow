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
/** An edge group that is a press target (§7 M6). Matched by attribute as well, so
 *  the guard is testable in Scene, which builds its targets from attributes. The
 *  reconnect ring carries `data-edgeid` too and `closest` finds it first, so the
 *  edge group has to be matched on its own class as well. */
const edgeSelector = `.${classes.Edge}[data-edgeid]`;
/** Reconnect grab handles sit in the edges layer, outside every node, so the
 *  pane handler has to decline them explicitly. Matched by attribute as well so
 *  the guard is testable in Scene (§M1-FINDINGS §2.2). */
const edgeEndpointSelector = `.${classes.EdgeEndpoint}, [data-edgeend]`;
/** Chrome — controls, minimap, consumer panels — is inside the pane, so a press
 *  on it reaches the pane's own handler. Matched by the attribute rather than the
 *  three classes so a consumer panel built without `classes` is still exempt. */
const chromeSelector = `[data-${classes.ChromeAttribute}]`;

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

/** Delete, Escape, and arrow keys only reach the graph when this guard passes. */
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

/** A press on a selectable edge belongs to the edge, not to the pane: without
 *  this the pane handler would clear the selection the edge press just made. */
export const isEdgeTarget = (target: EventTarget | null): boolean =>
  closestOrNull(target, edgeSelector) !== null;

/** A press on chrome belongs to the control, not to the pane (§7 M3). */
export const isChromeTarget = (target: EventTarget | null): boolean =>
  closestOrNull(target, chromeSelector) !== null;

/**
 * The node a keyboard event is about: the node wrapper that contains the focused
 * element, or nothing when focus is elsewhere. This is why focus needs no Model
 * state — the DOM answers "which node" at event time (§7 M3), and an arrow key
 * pressed while a parent control has focus nudges nothing. The same answer
 * decides whether Enter or Space activates a node.
 */
export const focusedNodeId = (target: EventTarget | null): string | null =>
  closestOrNull(target, nodeSelector)?.getAttribute("data-nodeid") ?? null;

/** The edge a keyboard event is about, by the same rule: the DOM answers "which
 *  edge", so an edge that survives a re-render keeps its focus and no Model state
 *  describes focus (§7 M6). */
export const focusedEdgeId = (target: EventTarget | null): string | null =>
  closestOrNull(target, edgeSelector)?.getAttribute("data-edgeid") ?? null;
