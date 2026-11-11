import { Predicate } from "effect";

import { galleryFixtureNames, galleryFixtures } from "./fixtures";

/**
 * The gallery's index (M5): one row per fixture, with a link into both libraries
 * and into each fixture's "feature off" state.
 *
 * It is built from `fixtures.ts` rather than written out by hand, so a fixture
 * cannot exist without a link and a link cannot point at a fixture that was
 * renamed. `tests/gallery.spec.ts` asserts the same thing from the outside.
 */
const link = (href: string, label: string, isPrimary: boolean): HTMLElement => {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = label;
  anchor.className = isPrimary
    ? "gallery-index-link primary"
    : "gallery-index-link";
  anchor.dataset["galleryLink"] = href;
  return anchor;
};

const cell = (children: ReadonlyArray<string | HTMLElement>): HTMLElement => {
  const td = document.createElement("td");
  children.forEach((child) => {
    td.append(
      Predicate.isString(child) ? document.createTextNode(child) : child,
    );
  });
  return td;
};

const row = (name: (typeof galleryFixtureNames)[number]): HTMLElement => {
  const fixture = galleryFixtures[name];
  const query = `?fixture=${encodeURIComponent(name)}`;
  const tr = document.createElement("tr");
  tr.dataset["fixture"] = name;

  const title = document.createElement("th");
  title.scope = "row";
  title.textContent = fixture.name;
  const description = document.createElement("p");
  description.className = "gallery-index-description";
  description.textContent = fixture.description;
  title.append(description);

  tr.append(
    title,
    cell([fixture.feature]),
    cell([
      `${fixture.nodes.length} node${fixture.nodes.length === 1 ? "" : "s"}, ` +
        `${fixture.edges.length} edge${fixture.edges.length === 1 ? "" : "s"}`,
    ]),
    cell([
      link(`/gallery-foldkit.html${query}`, "ours", true),
      link(`/gallery-react.html${query}`, "React Flow", true),
    ]),
    cell([
      link(`/gallery-foldkit.html${query}&variant=off`, "ours", false),
      link(`/gallery-react.html${query}&variant=off`, "React Flow", false),
    ]),
  );
  return tr;
};

const root = document.getElementById("root");

if (root !== null) {
  const page = document.createElement("main");
  page.className = "gallery-index";

  const heading = document.createElement("h1");
  heading.textContent = "Fixture gallery";

  const lede = document.createElement("p");
  lede.className = "gallery-index-lede";
  lede.textContent =
    "One fixture definition, rendered by React Flow and by @fllstck/foldkit-flow on separate pages. The test compares geometry — path d strings and node boxes — and each library's own paint with one thing changed. It never compares our pixels to their stylesheet.";

  const note = document.createElement("p");
  note.className = "gallery-index-note";
  note.textContent =
    "“Feature off” is the same graph with the feature under test removed and nothing else changed: that pair is what the paint assertions screenshot. `hidden` is the one deliberate divergence — ours collapses a subtree, React Flow hides one node — so that row compares each library's own behaviour rather than asserting they match.";

  const table = document.createElement("table");
  table.className = "gallery-index-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["fixture", "feature", "size", "rendered by", "feature off"].forEach(
    (label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.append(th);
    },
  );
  head.append(headRow);

  const body = document.createElement("tbody");
  galleryFixtureNames.forEach((name) => body.append(row(name)));
  table.append(head, body);

  const footer = document.createElement("p");
  footer.className = "gallery-index-note";
  footer.textContent =
    "Measured output: packages/benchmark/results/gallery.json. Not shipped cross-library: the resize gesture (React Flow uses NodeResizer), chrome (minimap, controls, description), and everything on the M6 list.";

  page.append(heading, lede, note, table, footer);
  root.append(page);
}
