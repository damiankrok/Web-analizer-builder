# Testing the web analyzer yourself

This file is the owner's guide to running the camera-aware web analyzer. The
first half needs no development experience. The second half has the exact
commands, paths and environment-variable names a developer would want.

- **Repository:** `damiankrok/Web-analizer-builder`
- **Branch:** `claude/new-session-pvd4ik` (all of this work lives here; `main` is
  untouched)
- **Project directory:** the repository root — this is a single package, not a
  monorepo, so there is no sub-directory to `cd` into

---

## Part 1 — for the owner

### What the analyzer actually is

You give it an ARCHON project page. It reads that page's drawings and renders,
works out where the camera stood for each render, and builds a **3D building
model** that it then checks back against every drawing it has. It shows you the
model, the drawings, and its own reasoning — which dimensions it read off the
paper, which walls it is confident about, and where two sources disagree.

It runs entirely on your own machine or in your own browser. There is no remote
AI service, no API key, and nothing is uploaded anywhere.

### The fastest way to look at it: the preview link

The preview link opens in a normal phone browser. It contains the whole
analyzer plus a **cached copy of the Marcówki source package** — the twelve
drawings and renders from that ARCHON page, exactly the bytes the fetcher
downloaded. Paste the Marcówki URL into the box, press Analyze, and the real
pipeline runs in your browser: cameras, scoring, self-repair, 3D model.

Two honest limits of the preview, because they matter:

1. **It cannot fetch a new URL by itself.** ARCHON does not send the headers a
   browser needs (`Access-Control-Allow-Origin`) to let another website read its
   pages, and the download rules the analyzer enforces — a fixed list of allowed
   hosts, a re-check on every redirect, a size cap per file — are things only a
   server can enforce, not a browser tab. So the preview analyzes the source
   package that travels with it. Paste a *different* ARCHON URL and it will tell
   you so, and tell you which command caches that project.
2. **It is a build, not a live server.** When the code changes, the preview has
   to be rebuilt and republished. The dark strip at the top of the page shows the
   branch and the commit it was built from, so you can always tell whether the
   preview matches what is on GitHub.

If you want to analyze *any* ARCHON URL — not just the cached one — use Part 2.
That path fetches live and works for every project.

### Running it on your own computer

You need [Node.js](https://nodejs.org) version 20 or newer. Installing Node is
the only setup step. Then, in a terminal:

```sh
git clone https://github.com/damiankrok/Web-analizer-builder.git
cd Web-analizer-builder
git checkout claude/new-session-pvd4ik
npm install
```

Now download the Marcówki source package once (this is the only step that needs
the internet, and it only ever talks to `archon.pl`):

```sh
npm run fetch A
```

And run the analysis:

```sh
npm run analyze A
```

It prints the footprint, the ridge and eave heights, the roof pitch, how
confident it is about each camera, and where it wrote its results. The results
are ten JSON files in `out/A-marcowki/` — see *Where the results go* below.

To see it in a browser instead of the terminal:

```sh
npm run ui:dev
```

Then open **http://localhost:5173** and paste the Marcówki URL:

```
https://www.archon.pl/projekty-domow/projekt-dom-w-marcowkach-ge-m2fa281446a8ca
```

### Reading it on your phone from your own computer

If your phone is on the same Wi-Fi as your computer:

```sh
npm run standalone:build
HOST=0.0.0.0 npm run standalone:serve
```

Then, on the phone, open `http://<your-computer's-IP>:4173`. On macOS the IP is
in System Settings → Network; on Windows, run `ipconfig`.

### What is *not* trustworthy, on purpose

The analyzer separates what it **read** from what it **guessed**, and it will
tell you which is which. Only two of its seven confidence classes —
`SOURCE_EXACT` and `SOURCE_CORROBORATED` — mean "this number is printed on the
drawing and the drawing's own geometry agrees with it". Everything else is an
estimate. When two drawings disagree about the same dimension it keeps both and
records the conflict rather than averaging them, and it never fills in a missing
printed number by arithmetic.

The hand-built reference model of Marcówki is used for nothing automatic. Its
weight in every score is zero, asserted by a test.

---

## Part 2 — for a developer

### Repository layout

| What | Path |
| --- | --- |
| Package / workspace root (single package) | `package.json` |
| Web app HTML entry point | `index.html` |
| Web app JS entry point | `src/ui/main.tsx` |
| React UI (panels, URL input, controls) | `src/ui/App.tsx`, `src/ui/styles.css` |
| Three.js viewer | `src/ui/Viewer.tsx` |
| Analyzer core — portable, no DOM, no React, no Three.js | `src/core/` |
| Pipeline entry (`analyze`) | `src/core/pipeline/analyze.ts` |
| Exported JSON documents | `src/core/pipeline/exports.ts` |
| Frozen weights, thresholds and hashes | `src/core/config/weights.ts` |
| ARCHON page parser (pure) | `src/core/source/archon-parser.ts` |
| Source-fetch **policy** (pure, portable) | `src/core/source/fetch-policy.ts` |
| Source-fetch **I/O adapter** (Node only) | `src/node/fetch-adapter.ts` |
| Source loader — fetch, cache, decode, resolution probe | `src/node/source-loader.ts` |
| CLI | `src/node/cli.ts` |
| Dev/holdout project list (A, B, C, D) | `src/node/projects.ts` |
| Browser worker (dev build) | `src/web/analyze-worker.ts` |
| Browser worker (standalone build) | `src/web/standalone-worker.ts` |
| Standalone source resolution | `src/web/run-source.ts` |
| Generated cached-source bundle | `src/web/bundled/index.ts` (git-ignored) |
| Dev build output | `dist-ui/` (git-ignored) |
| Standalone build output | `dist-standalone/` (git-ignored) |
| CLI export output | `out/<project-slug>/` (git-ignored) |
| Cached source packages | `fixtures/<slug>/page.html` (tracked), `fixtures/<slug>/assets/` (git-ignored) |
| WEB-01 research report | `docs/WEB_ANALYZER_CAMERA_AWARE_RESEARCH_REPORT.md` |
| WEB-02 research report | `docs/WEB_ANALYZER_DIMENSION_OCR_HARDENING_REPORT.md` |
| Kotlin / Android porting guide | `docs/KOTLIN_PORTING_GUIDE.md` |
| Export schemas | `docs/SCHEMAS.md` |

### Commands

```sh
npm install                 # dependencies; no postinstall, no native build
npm run typecheck           # tsc --noEmit
npm test                    # vitest run — 129 tests, 11 files, ~110 s
```

Analysis:

```sh
npm run fetch A             # cache one project's page + assets (needs network)
npm run fetch A B C D       # cache all four
npm run analyze A           # analyze from cache, write out/A-marcowki/
npm run analyze A --online  # fetch live instead of using the cache
npm run analyze A --no-repair
npm run bench               # A and B, with a summary table
npm run freeze              # write out/freeze.json (code SHA + config hashes)
npm run holdout             # the WEB-02 holdout (D); refuses unless the freeze still matches HEAD
```

Dev server:

```sh
npm run ui:dev              # http://localhost:5173
npm run ui:build            # -> dist-ui/
```

The dev server serves the cached assets straight out of `fixtures/`, so the
browser runs the same pipeline the CLI does with no proxy involved. It needs
`npm run fetch A` to have been run first.

Standalone (hostable, self-contained) build:

```sh
npm run standalone:bundle   # inline fixtures/A-marcowki into src/web/bundled/index.ts
npm run standalone:build    # bundle + vite build + artifact page -> dist-standalone/
npm run standalone:serve    # static server on http://localhost:4173
npm run standalone:verify   # Playwright, Pixel 5 viewport, 11 checks -> out/preview/
STRICT_CSP=1 npm run standalone:verify   # same, under the artifact host's CSP
PAGE=hosted.html STRICT_CSP=1 npm run standalone:verify   # the published preview's own shape
```

`standalone:bundle` takes project keys (`npm run standalone:bundle -- A B`) and
defaults to `A`. `dist-standalone/` has no absolute paths and no external
requests, so it can be served from any static host or subdirectory — including
straight out of an unzipped archive with `node scripts/serve-standalone.mjs`,
which uses only Node built-ins and needs no `npm install`.

### Environment variables

There are no secrets, no API keys and no credentials anywhere in this project.
The complete set of variables it reads:

| Variable | Read by | Meaning |
| --- | --- | --- |
| `VITE_STANDALONE` | `src/ui/App.tsx` | `"1"` selects the bundled-source build. Set by `vite.standalone.config.ts` at build time; you do not set it by hand. |
| `STRICT_CSP` | `scripts/verify-standalone.mjs` | `1` serves the build under a CSP mirroring the artifact host (`connect-src 'none'`, `worker-src blob:`). |
| `PAGE` | `scripts/verify-standalone.mjs` | Which page to drive. Empty (default) is `index.html`, the plain build. `hosted.html` wraps `artifact.html` in the document skeleton the artifact host supplies, which is what the published preview actually serves. |
| `HOST` | `scripts/serve-standalone.mjs` | Bind address for the static server. `0.0.0.0` to reach it from another device. Default `127.0.0.1`. |
| `PORT` | `scripts/serve-standalone.mjs` | Static server port. Default `4173`. |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright | Only needed if Chromium is installed somewhere non-standard. |

Nothing else is read. There is no `.env` file and none is needed.

### How ARCHON fetching works

Fetching is split so that the decision is portable and the I/O is not:

- **`src/core/source/fetch-policy.ts`** is pure and decides. HTTPS only; host on
  a closed allowlist (`www.archon.pl`, `archon.pl`, `assets.archon.pl`); no
  embedded credentials; no non-443 port; at most 3 redirects with the policy
  re-checked at every hop; 8 MB per page, 12 MB per image, 40 assets, 4
  concurrent, 30 s timeout; declared image types only. It is not an open proxy.
- **`src/node/fetch-adapter.ts`** performs the request under that policy.
- **`src/node/source-loader.ts`** caches each response under a
  `sha256(url).slice(0, 24)` key in `fixtures/<slug>/assets/`, decodes it, and
  runs the source-resolution probe that looks for a higher-resolution variant of
  each drawing — accepting one only if the fetched candidate really decodes to
  more pixels in both axes. Nothing is ever upscaled.

A browser cannot do this. ARCHON sends no CORS headers, so a page on another
origin cannot read its responses at all, and a browser cannot enforce the
redirect and size rules even if it could. That is why live fetching is a Node
path (`npm run fetch`, `npm run analyze --online`) and the browser reads a cache
the Node path produced. The standalone build carries that cache inside itself.

Adding a project: append it to `PROJECTS` in `src/node/projects.ts`, then
`npm run fetch <key>`.

### Where the results go

`npm run analyze A` writes ten JSON documents to `out/A-marcowki/`. They are
plain data — no class instances, no `NaN`, no `Infinity`, every float rounded —
so two runs over the same assets produce byte-identical files, and the JVM port
can read them with no bespoke reader. Schemas are in `docs/SCHEMAS.md`.

| File | Contents |
| --- | --- |
| `source-package.json` | the parsed page: identity, published facts, rooms, assets with their classified roles and projections |
| `evidence-graph.json` | every claim, what it rests on, and what contradicts it |
| `camera-hypotheses.json` | per-view camera candidates, their scores and their ambiguity analysis |
| `building-hypotheses.json` | the metric scaffold and the base hypothesis |
| `resolved-building-geometry.json` | **the deliverable** — masses, roofs, openings, appearance, constraints, with units and coordinate frames stated on every field |
| `self-verification.json` | hard-constraint checks, score breakdown, camera confidence classes, freeze hashes |
| `repair-trace.json` | every repair proposed, accepted or rejected, and why |
| `benchmark-summary.json` | timings, counts and scores |
| `metric-audit.json` | every metric value with its fidelity class, provenance and any retained conflict |
| `printed-dimensions.json` | the printed-dimension read: source resolution audit, harvested glyph alphabet, solved scales, dimensions with their fidelity |

The browser build shows the same data in its panels and does not write files.

`npm run standalone:verify` writes screenshots to `out/preview/`.

### Verification

`npm run standalone:verify` drives the built page in Chromium at a Pixel 5
viewport and checks, in order: the page loads at phone width; the URL input is
editable; the Marcówki URL can be submitted; source fetching works in the
deployed environment; the analysis runs and its hard constraints are satisfied;
the 3D model renders; orbit and zoom respond; all twelve source thumbnails
decode; the camera and debug panels populate; no request leaves the published
origin; and an unbundled URL is refused with a reason.

Run it three ways, because each catches something the others do not: plain
(`npm run standalone:verify`); under the host's Content-Security-Policy
(`STRICT_CSP=1 …`), which exercises the worker-blob and no-network paths instead
of assuming them; and against the published preview's own document shape
(`PAGE=hosted.html STRICT_CSP=1 …`), which is `artifact.html` wrapped in the
skeleton the host supplies rather than the plain `index.html`. The last one is
the closest thing to testing the deployed page without being signed in to it.

A single console 404 for `/favicon.ico` is expected when serving locally: the
build does not carry one and the host supplies it.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm run analyze A` reports no assets | the cache is empty | `npm run fetch A` |
| Thumbnails are blank in `npm run ui:dev` | same | `npm run fetch A`, then reload |
| `npm run holdout` refuses to run | the freeze does not match `HEAD` | `npm run freeze` — but read §28–29 of the WEB-02 report first; re-freezing to make the holdout run defeats its purpose |
| The preview refuses a URL you pasted | that project is not bundled into the build | use `npm run ui:dev` or the CLI, which fetch live |
| `standalone:verify` cannot launch a browser | Chromium is not where Playwright expects | `npx playwright install chromium`, or set `PLAYWRIGHT_BROWSERS_PATH` |
