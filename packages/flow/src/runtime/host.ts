import { Option } from "effect";

import type { PanZoomInstance } from "./adapter.js";

/** Live handles for one mounted pane. The Model owns identity (`paneId`); this
 *  module owns the objects that cannot live in a frozen Model (§4.3). */
export type PaneHost = Readonly<{
  paneId: string;
  element: HTMLElement;
  root: Document | ShadowRoot;
  panZoom: PanZoomInstance;
}>;

const paneHosts = new Map<string, PaneHost>();

export const registerPane = (host: PaneHost): void => {
  paneHosts.set(host.paneId, host);
};

export const getPane = (paneId: string): Option.Option<PaneHost> =>
  Option.fromNullishOr(paneHosts.get(paneId));

export const getPaneRoot = (
  paneId: string,
): Option.Option<Document | ShadowRoot> =>
  Option.map(getPane(paneId), (host) => host.root);

export const getPaneElement = (paneId: string): Option.Option<HTMLElement> =>
  Option.map(getPane(paneId), (host) => host.element);

/** Identity-safe release: a remount under the same paneId must not be deleted by
 *  the old mount's finalizer. */
export const releasePane = (paneId: string, panZoom: PanZoomInstance): void => {
  panZoom.destroy();
  const host = paneHosts.get(paneId);
  if (host !== undefined && host.panZoom === panZoom) paneHosts.delete(paneId);
};

export const clearPaneHosts = (): void => {
  paneHosts.clear();
};
