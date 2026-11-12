import { Runtime } from "foldkit";

import * as example from "./example/app";
import { createExampleApp } from "./examples/harness";
import * as examplesIndex from "./examples/indexApp";
import { exampleBySlug } from "./examples/registry";
import * as demo from "./main";
import { routeFor } from "./routes";
import "./styles.css";

/**
 * Two pages, one build: `/` is the instrumented 630-node playground the browser
 * proofs measure, `/example/` is the presentable pipeline (M5). They are separate
 * Foldkit applications and this entry picks by pathname.
 *
 * Both are imported statically. A dynamic import splits the bundle, and a split
 * that gives the second chunk its own copy of `foldkit` breaks the render frame —
 * the element constructors then throw "foldkit was loaded as more than one
 * instance". The unused module costs one renderer object and no DOM.
 *
 * `container` is `null` on a server-rendered page: the application *is* the
 * document, and `Runtime.hydrate` finds its root by `data-foldkit-app`.
 */
const container = document.getElementById("root");
const route = routeFor(window.location.pathname);

if (route.kind === "examples-index") {
  Runtime.hydrate(
    Runtime.makeApplication({
      Model: examplesIndex.Model,
      init: examplesIndex.init,
      update: examplesIndex.update,
      view: examplesIndex.view,
      container,
    }),
  );
} else if (route.kind === "examples-example") {
  const entry = exampleBySlug(route.slug);
  if (entry !== undefined) {
    const app = createExampleApp(entry.spec, entry.sources);
    Runtime.hydrate(
      Runtime.makeApplication({
        Model: app.Model,
        init: app.init,
        update: app.update,
        view: app.view,
        subscriptions: app.subscriptions,
        container,
      }),
    );
  }
} else if (route.kind === "pipeline") {
  Runtime.hydrate(
    Runtime.makeApplication({
      Model: example.Model,
      init: example.init,
      update: example.update,
      view: example.view,
      subscriptions: example.subscriptions,
      container,
    }),
  );
} else {
  Runtime.hydrate(
    Runtime.makeApplication({
      Model: demo.Model,
      init: demo.init,
      update: demo.update,
      view: demo.view,
      subscriptions: demo.subscriptions,
      container,
    }),
  );
}
