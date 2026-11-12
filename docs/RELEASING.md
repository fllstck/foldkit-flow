# Releasing

The checklist for cutting a version of `@fllstck/foldkit-flow`. It exists because the
first two releases each cost a round trip on something avoidable: `0.1.0` shipped
without repository metadata and with a typo in its own README, and both releases
needed the owner to finish the publish by hand.

## Before the version bump

1. `pkill -f vite`, then `pnpm typecheck`, `pnpm build`, `pnpm check`, `pnpm bench` —
   in that order. Typecheck first because `vite build` does not typecheck; build
   before any browser run because the benchmark bundle inlines the library's CSS
   (`docs/verification.md` rule 4).
2. Every number in `docs/BENCHMARKS.md` has to come from a run at the commit being
   released. If the release changes no runtime code, say so in the changelog and in
   the table's footnote (that is what `0.1.1` did).
3. Check what a consumer will actually get — `packages/flow`:

   ```sh
   pnpm pack --dry-run          # every entry `files`/`exports` promises
   npm publish --dry-run        # the manifest, the size, the tag, the access
   ```

   `CHANGELOG.md`, `LICENSE`, `README.md` and `THIRD-PARTY-NOTICES.md` belong in
   `files`; the tarball is the only artefact nobody can inspect after the fact.

## The release commit

4. Bump `version` in `packages/flow/package.json`. Add an entry to
   `packages/flow/CHANGELOG.md` — Keep a Changelog sections, and say explicitly
   whether the runtime changed. Paths in that file name repository files rather than
   linking them, because a tarball has no tree around it.
5. Update the places that state the version: `README.md` (status line),
   `packages/flow/README.md`, `docs/CONTRACT.md`'s "published surface",
   `docs/M6-HANDOFF.md`'s state table. Where a measured table carries a version
   label, leave the label on the version that was *measured* and footnote the
   difference.
6. Commit, then **tag the commit that a publish can be reproduced from**:

   ```sh
   git tag -a v0.1.2 -m "0.1.2 — <one line>"
   ```

   Tags are not decoration: the changelog's compare links point at them, and
   `git checkout v0.1.2` is the only honest answer to "what is in 0.1.2?".

## Publishing

7. `cd packages/flow && npm publish --access public`. `prepublishOnly` runs
   `typecheck && test && build` first, so a stale `dist` cannot ship.
8. **The account needs either a one-time password or a granular token.** Three
   attempts have ended in `E401`/`E404` (an expired token), `EOTP` (2FA without a
   code), and then success via the owner. If `npm whoami` fails, or the publish asks
   for an OTP, it is the owner's step: complete the browser flow, or pass
   `--otp=<code>`.
9. Verify from the registry rather than from the terminal that printed "published":

   ```sh
   npm view @fllstck/foldkit-flow version dist-tags
   npm pack @fllstck/foldkit-flow@0.1.2 && tar -tzf fllstck-foldkit-flow-0.1.2.tgz | head
   ```

   And once, after a release that changes anything a consumer runs: install it into
   an empty project with its peers and `import` it. That is how both releases were
   checked — 79 exports, `fitViewport` called through the published bundle
   (`docs/M5-FINDINGS.md` §13 and §16).

   **Propagation is a real gap, not a formality.** For a few minutes after `npm view`
   starts answering the new version, `npm install <package>@<new version>` can still
   fail with `notarget`, because npm caches packuments. `npm install --prefer-online`
   skips the cache; a plain retry a few minutes later works too. Do not read that
   error as a broken release.

## After

10. Push the branch and the tags (`git push origin main --follow-tags`) when the
    owner says so: publishing is irreversible, pushing is visible.
11. Nothing published can be edited. A wrong README, a missing `repository` field or
    a typo in a code sample is fixed by the *next* version — which is exactly why
    `0.1.1` exists one day after `0.1.0`.

## Still manual, and known

- The changelog is written by hand from `git log` (the commits are conventional, so a
  generator would mostly agree). The tool choice and a `commit-msg` check are the
  open point in `docs/M5-FINDINGS.md` §7.1.
- `docs/RELEASING.md` is not enforced by anything. It is a checklist because the two
  avoidable mistakes above were both order-of-operations mistakes.
