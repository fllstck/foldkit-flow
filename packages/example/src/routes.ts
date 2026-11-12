import { createExampleApp } from "./examples/harness";
import * as examplesIndex from "./examples/indexApp";
import { exampleBySlug } from "./examples/registry";

/**
 * The four pages this app serves, resolved from a pathname the same way on the
 * server and in the browser so that hydration adopts the markup the server sent.
 *
 * - `/examples` — the index, generated from the registry.
 * - `/examples/<name>` — one example: the same harness, parameterised by a spec.
 * - `/example/` — the presentable pipeline (`src/example/app.ts`).
 * - `/` — the instrumented 630-node playground the browser proofs measure.
 *
 * A trailing slash matters on a static host: `/example` falls back to `/`'s
 * document, while `/example/` is the prerendered page.
 */
export type Route =
  | Readonly<{ kind: "examples-index" }>
  | Readonly<{ kind: "examples-example"; slug: string }>
  | Readonly<{ kind: "pipeline" }>
  | Readonly<{ kind: "demo" }>;

export const routeFor = (pathname: string): Route => {
  if (pathname === "/examples" || pathname === "/examples/") {
    return { kind: "examples-index" };
  }
  if (pathname.startsWith("/examples/")) {
    const slug = pathname.slice("/examples/".length).replace(/\/$/, "");
    if (exampleBySlug(slug) !== undefined) {
      return { kind: "examples-example", slug };
    }
    return { kind: "examples-index" };
  }
  if (pathname.startsWith("/example")) return { kind: "pipeline" };
  return { kind: "demo" };
};

/** The prerendered paths. The example pages are generated from the routes the
 *  registry knows, so a new example is one line in `registry.ts` and nothing here. */
export const prerenderPathsFor = (
  slugs: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  "/",
  "/example",
  "/examples",
  ...slugs.map((slug) => `/examples/${slug}`),
];

export { createExampleApp, examplesIndex };
