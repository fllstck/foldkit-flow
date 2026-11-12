import { Array as Arr, Schema } from "effect";
import { Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import "./examples.css";
import { categories, examplesByCategory } from "./registry";

/**
 * The examples index: a page of links, generated from the registry.
 *
 * It is an Foldkit application rather than a plain DOM script because the route is
 * server-rendered like the others — the index has to exist in the HTML the server
 * sends, or a reader without JavaScript sees nothing.
 */
export const Model = Schema.Struct({});
export type Model = typeof Model.Type;

const Message = defineMessageUnion({ Noop: {} });
type Message = typeof Message.Type;

export const init = (): Update.Return<Model, Message> => ({ model: {} });

export const update = (
  model: Model,
  _message: Message,
): Update.Return<Model, Message> => ({ model });

export const view = (_model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Examples — Foldkit Flow",
  body: h.main(
    [h.Class("ex2-index"), h.DataAttribute("examples-index", "true")],
    [
      h.h1([], ["Examples"]),
      h.p(
        [h.Class("ex2-index-lede")],
        [
          "Each page is one small flow, and the source beside it is the file that produced it. The wiring is shared: every example runs the same Foldkit application, and the file on the right is what makes it that example.",
        ],
      ),
      ...categories.flatMap((category) => {
        const entries = examplesByCategory(category);
        if (Arr.isReadonlyArrayEmpty(entries)) return [];
        return [
          h.h2([], [category]),
          ...entries.map((entry) =>
            h.div(
              [
                h.Class("ex2-index-item"),
                h.DataAttribute("example-link", entry.spec.name),
              ],
              [
                h.a(
                  [
                    h.Class("ex2-link"),
                    h.Href(`/examples/${entry.spec.name}/`),
                  ],
                  [entry.spec.title],
                ),
                h.p([], [entry.spec.description]),
              ],
            ),
          ),
        ];
      }),
    ],
  ),
});
