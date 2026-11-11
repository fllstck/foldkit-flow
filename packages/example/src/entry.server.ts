import { Effect } from "effect";
import { Server } from "foldkit/experimental";

import { init, view } from "./main";

export const renderDocument = Server.renderDocument;

export const prerenderPaths: ReadonlyArray<string> = ["/"];

export const renderPage = (_request: Request): Promise<Server.EntryResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const renderedApplication = yield* Server.renderToString({ init, view });

      return Server.Rendered(renderedApplication);
    }),
  );
