import { Effect } from "effect";
import { Server } from "foldkit/experimental";

import * as example from "./example/app";
import { createExampleApp } from "./examples/harness";
import * as examplesIndex from "./examples/indexApp";
import { exampleBySlug, exampleSlugs } from "./examples/registry";
import * as demo from "./main";
import { prerenderPathsFor, routeFor } from "./routes";

export const renderDocument = Server.renderDocument;

/**
 * Every page this app serves, prerendered from the routes the registry knows
 * (`src/routes.ts`): the playground, the pipeline, the examples index and one page
 * per example. A new example is a module plus a line in `registry.ts`.
 */
export const prerenderPaths: ReadonlyArray<string> =
  prerenderPathsFor(exampleSlugs);

/**
 * The same routing as the client entry, so hydration adopts the markup the server
 * sent. Each page is its own Foldkit application; the four are small.
 */
export const renderPage = (request: Request): Promise<Server.EntryResult> => {
  const route = routeFor(new URL(request.url).pathname);

  return Effect.runPromise(
    Effect.gen(function* () {
      if (route.kind === "examples-index") {
        const rendered = yield* Server.renderToString({
          init: examplesIndex.init,
          view: examplesIndex.view,
        });
        return Server.Rendered(rendered);
      }

      if (route.kind === "examples-example") {
        const entry = exampleBySlug(route.slug);
        if (entry !== undefined) {
          const app = createExampleApp(entry.spec, entry.sources);
          const rendered = yield* Server.renderToString({
            init: app.init,
            view: app.view,
          });
          return Server.Rendered(rendered);
        }
      }

      const rendered =
        route.kind === "pipeline"
          ? yield* Server.renderToString({
              init: example.init,
              view: example.view,
            })
          : yield* Server.renderToString({ init: demo.init, view: demo.view });

      return Server.Rendered(rendered);
    }),
  );
};
