# What Foldkit requires of a third-party integration

Notes from the Foldkit docs (foldkit.dev), the `foldkit` 0.170.0 npm tarball
(`dist/**/*.d.ts`), the `@foldkit/ui` 0.170.0 tarball, and the `examples/map`,
`examples/kanban`, `examples/charting` sources. Every API quoted below was read
from those files, not from memory.

## The five effect seams, and which one fits a canvas library

Foldkit has one rule: `update` and `view` are pure, and every effect happens at a
named seam. A flow canvas needs four different kinds of effect, and each has an
exact home:

| Cause of the work                            | Seam                                                           | Flow usage                                                                            |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `update` just handled a Message              | **Command** (`Command.define`)                                 | derive a fitted viewport, sync the pan/zoom handle, focus a node, measure via `Dom.*` |
| An element exists in the DOM                 | **Mount** (`Mount.define` / `Mount.defineStream`)              | own the pan/zoom instance, observe node size, read handle geometry                    |
| External event while a Model condition holds | **Subscription** (`Subscription.make` / `Dom.streamFromEvent`) | document-level pointermove/pointerup during a drag, keyboard delete                   |
| A stateful handle gated by the Model         | **ManagedResource**                                            | only if the handle must outlive a single element                                      |

The docs are explicit about choosing by _cause_, not timing: "Work that happens
when an element appears is not necessarily caused by that element… Reach for
Mount only when the work is inseparable from the live element and its lifetime."
Pan/zoom is inseparable from the pane element, so it is a Mount. "Focus the
search input after the dialog opened" is caused by the Message, so it is a
Command.

## Mount: the third-party-library seam

Two facts dominate the design:

1. **Mount args are captured at mount; they are not reactive props.** "Later
   renders create new MountActions, but a reused DOM node does not run `execute`
   again. Name values for that lifecycle, such as `initialScroll` or `seedValue`,
   rather than implying that they stay current." `update()`/`destroy()`-style
   reactivity is not part of Mount. Reactive work is a Command from the Message
   that changed the Model.
2. **Mounts re-run during DevTools time travel.** "Elements inserted during replay
   run their Mounts again… Keep Mount work replay-safe and local to the element."
   Live mounts receive `viewStateChanges: Stream<'Live' | 'Paused'>` so an
   integration can go read-only while a historical view is installed, and the
   docs say not to translate that signal into an application Message.
3. **A re-render is not a remount.** "A Mount follows the lifetime of a DOM node,
   not a VNode… the differ reuses an existing DOM node when its tag and identity
   still match. A reused node keeps its Mount running." So changing an element's
   `class`/attributes/children does **not** re-run its Mount; anything that must
   re-measure after a markup change needs an observer or a Message, not a re-render.
   This is the trap the first two plan revisions fell into.

Signatures (from `dist/mount/index.d.ts`):

```ts
Mount.define(name, { args?, messages, execute })      // Effect<Message>
Mount.defineStream(name, { args?, messages, execute }) // Stream<Message>
// execute receives { element, viewStateChanges, ...args }
```

`args` must be a `Schema.Struct` field map; `element` and `viewStateChanges` are
reserved names. `Mount.define`'s effect scope stays open until unmount, so
`Effect.acquireRelease` cleanup runs at the right time. Unmount interrupts the
fiber and discards later Messages.

## Keeping live instances out of the Model

Foldkit deep-freezes the Model in dev and expects Schema-decodable, immutable
data. A pan/zoom handle, `Map` of measured elements, or d3 zoom behavior cannot
live there. The `examples/map` integration solves it with a module-level host
registry:

```ts
// examples/map/src/mapHost.ts
const mapsByHostId = new Map<string, MapInstance>();
export const setMap = (hostId, instance) => {
  mapsByHostId.set(hostId, instance);
};
export const getMap = (hostId) =>
  Option.fromNullishOr(mapsByHostId.get(hostId));
export const removeMap = (hostId, map) => {
  map.remove();
  mapsByHostId.delete(hostId);
};
```

The Model holds `maybeMapHostId: Schema.Option(Schema.String)`; Commands look the
instance up by that id and return a `Failed*` Message when it is absent. The Mount
is assigned a `hostId` through `args`, registers the instance, and removes it in
`Effect.acquireRelease`'s release. This is the sanctioned shape: **the Model owns
identity, the module owns the handle, Commands cross the boundary by id.**

## Submodels: state boundary vs view boundary

- A Submodel owns Model, Message, update, optional Commands/Subscriptions/
  OutMessages, and optionally a view. "A child Submodel does not know which parent
  embeds it."
- `h.submodel({ slotId, model, view, viewInputs, toParentMessage })` creates the
  _view_ boundary; `Update.foldChild({ update, read, write, toParentMessage })`
  creates the _update_ boundary; `update` may return `outMessage` for facts the
  parent acts on (named as past-tense facts, e.g. `SucceededLogin`).
- **`viewInputs` functions must be top-level.** "Functions nested inside an object
  or array in `viewInputs` throw when Foldkit builds the view… Move the function
  to the top level so Foldkit can run it in the parent's boundary." A
  `Record<NodeType, ViewFn>` cannot be threaded through `viewInputs`; a single
  `renderNode` callback can.
- Top-level `viewInputs` callbacks run in the **parent's** boundary, so handlers
  they build dispatch parent Messages. `childAttributes([...])` is the opposite
  direction: it snapshots the child dispatcher so child-owned attributes can be
  spread into parent markup.
- Reusable widget with its own state and a consumer-provided renderer: the
  `renderer(model, toParentMessage, h)` helper shape (`SnippetCopy.renderer`,
  `DragAndDrop.draggable(config, h)`, `Button.view({onClick, toView}, h)`).
- `DragAndDrop` is the closest precedent for a gesture-heavy component: it has
  **no view function**, only `draggable()/droppable()/sortable()` attribute
  bundles, `subscriptions` for document-level pointer/keyboard listeners, and
  `Reordered` / `Cancelled` OutMessages. Its pointermove handling lives in a
  Subscription, not in per-element handlers.
- State the parent owns must not be copied into the child: "Pass it through
  `viewInputs` instead"; for update-side context, add a third `context` argument
  or an `inform*` helper (the _Informing Submodels_ pattern).

## Subscriptions

```ts
Subscription.make<Model, Message>()((entry) => ({
  name: entry(
    { dep: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ dep: model.dep }),
      dependenciesToStream: (deps) => Stream<Message>,
    },
  ),
}));
```

Equivalent dependencies keep the stream alive; a change tears the scope down and
restarts it. `keepAliveEquivalence` is the escape hatch for a stream that needs
the latest dependency mid-flight without restarting (Foldkit UI uses it for
auto-scroll reading the current pointer position). `Subscription.lift(childSubs)
<ParentModel, ParentMessage>({ read, toParentMessage })` and
`Subscription.aggregate(...)` compose child subscriptions; `Subscription.persistentEntry(stream)`
wraps a stream directly.

`Dom.streamFromEvent` / `streamFromEventFilterMap` /
`streamFromEventFilterMapPreventDefault(target, { type, mapEvent })` turn DOM
events into Streams with correct typing, read inside the acquire effect, mapper
running synchronously (so `preventDefault()` works, `passive: false` enforced).

## Commands

```ts
Command.define('Name', { args: {…Schema…}, messages: [Message.A, Message.B],
  execute: ({ arg }) => Effect<Message> })
```

Each Command declares the Messages it may produce, appears by name in DevTools,
and must convert its own failures into Messages. `Command.interruptible` and
`Command.resolve`/`Command.expectExact` exist for interruption and tests.

## View

- `view(model, h)` returns `Html` or `Document`; handlers are values, never
  closures over mutable state. View is **pure**: it describes HTML, and it must not
  mutate application state or run effects while building the tree. A consumer
  callback invoked during view construction (a `renderNode`, a slot callback) is
  bound by the same rule, so a library cannot ask it to _record_ anything into a
  mutable collection — and a memoized subtree never re-invokes it anyway.
- There is **no public VNode traversal** in `foldkit/html` (the public surface is
  `createLazy`/`createKeyedLazy`, `childAttributes`, click options, and types), so
  anything a renderer wants to know about an element's markup has to come from the
  DOM after insertion, not from the VNode it just built.
- The builder covers the whole SVG element set (`h.svg`, `h.path`, `h.rect`,
  `h.circle`, `h.g`, `h.marker`, `h.defs`, …) plus `h.ViewBox`, `h.Style(record)`,
  `h.Attribute(key, value)` and `h.DataAttribute(key, value)` for arbitrary
  attributes, and `h.keyed(tag)(id, attrs, children)` for stable identity.
- `h.OnPointerDown(f)` receives `(pointerType, button, screenX, screenY,
timeStamp, clientX, clientY, pointerId, target)` and returns
  `Option<Message>`; `h.OnPointerMove` receives `(screenX, screenY, pointerType)`;
  `h.OnWheel`, `h.OnKeyDown`, `h.OnClick(message, ClickOptions)` with
  `EventPropagation.Bubble | Stop` and `defaultAction: Allow | Prevent`.
- Coordinate-level pointer data on `pointerdown` is what a drag needs for its
  origin; `pointermove` is coarse (screen coords only), which is enough for a
  delta-based drag.
- Memoization: `createLazy()` and `createKeyedLazy()` are **slot** caches, not hash caches. `createKeyedLazy()(key, fn, args)` — `key` only selects a slot; a VNode is recomputed when the function reference, the dispatcher, the Mount render owner, or **any argument changes by reference**. Cached VNodes must render at exactly one position, and "entries are never evicted", so keys must be bounded. The docs also say:
  "Profile it before adding `createKeyedLazy`." — which is why the benchmark harness
  lands before the memoization decision.
- DOM observation has no wildcard: `MutationObserver.observe` takes
  `attributeFilter` as exact attribute names (MDN), so a plan that writes
  `data-handle*` is describing something the platform cannot do. Either enumerate
  the names or observe unfiltered and coalesce — the latter is what the Flow plan
  does, because the per-frame coalescer absorbs the extra notifications.
- Parent context in a child update: the docs add a third `context` argument to a
  child's `update`, but `Update.foldChild`'s `update` is `(childModel, input)` with no
  context slot. The parent closes over per-dispatch context and rebuilds the fold per
  dispatch (`foldSettings(model.currentUser)(model, message)` in the docs): one
  allocation per Message, and no stored copy of parent state.
- Subscription targets may be thunks: `Dom.streamFromEvent*` accepts
  `target: Target | (() => Target)` and resolves it inside the acquire effect, so a
  listener can attach to the mounted element's root (`getRootNode()`) instead of
  `document`.
- `Canvas` module exists for imperative 2D canvas scenes with pointer Messages —
  not applicable to interactive HTML nodes, but useful if a low-zoom layer ever
  needs to be canvas-rendered.

## Testing

- **Story** (`foldkit/story`): pure update tests — `story(update, given(model),
message(M), model(...), Command.expectExact(...), Command.resolve(...))`.
- **Scene** (`foldkit/scene`): view tests with accessible locators —
  `click`, `pointerDown(target, {clientX, clientY, button, pointerType})`,
  `pointerUp`, `hover`, `keydown`, `change`, `inside`, `expect`,
  `Command.expectExact`, `Mount.expectHas` / `Mount.resolve`,
  `Subscription.*` helpers, `expectOutMessage`.
  **There is no `pointerMove` helper**, and every `OnMount` in the rendered view
  is recorded as a pending Mount that the test must acknowledge or resolve.
- Because gesture math would otherwise be untestable, keep it in pure functions
  that Story can drive, and keep DOM-facing adapters thin.

## Friction points for a flow canvas

1. **Frequency.** Pointermove-driven state transitions mean one Message per frame
   through `update` and `view`. React Flow avoids this by writing the viewport
   transform straight to the DOM and keeping the store out of render. A Foldkit
   integration can do the same for the _gesture_, then commit to the Model.
2. **Generics vs Schema.** The Model must be a concrete `Schema.Struct`. A
   library generic over user node data cannot put that data in its own Model
   without a factory-per-schema. Data belongs to the parent.
3. **Imperative measurement.** Node sizes and handle bounds come from DOM reads.
   They are facts about the browser and must enter through Mount (or a Command),
   never from `view`.
4. **No nested functions in `viewInputs`.** Node renderers must be one top-level
   callback, or the flow must be rendered through a `renderer()` helper in the
   parent's boundary instead of `h.submodel`.
5. **DevTools replay.** Any Mount that owns a library instance will be re-run
   under time travel and must be idempotent and DOM-local.

## Sources

- https://foldkit.dev/core/{architecture,mount,submodel,subscriptions,commands,canvas,view,freeze-model}
- https://foldkit.dev/patterns/{anti-patterns,informing-submodels}
- https://foldkit.dev/best-practices/{side-effects-and-purity,keying,messages}
- https://foldkit.dev/ui/drag-and-drop, https://foldkit.dev/testing/{scene,story}
- `foldkit@0.170.0` `dist/{mount,subscription,command,html,dom,test}/**.d.ts`
- `@foldkit/ui@0.170.0` `dist/dragAndDrop/index.d.ts`
- `examples/map/src/{main.ts,mapHost.ts}`, `examples/kanban/src/{subscription.ts,view/view.ts}`
