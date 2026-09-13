# STAGE WEB-PIVOT-03 — unified SourcePackage, CLI/web source parity

| | |
| --- | --- |
| Starting HEAD | `6d40fbbb8e57f74f2d32fa45a7e44b82b9523dc5` |
| Final HEAD | `aa1cd261ecaf9867601f2020c82690af1d312855` |
| Branch | `claude/new-session-pvd4ik` |
| Previous stage | STAGE WEB-PIVOT-02A — eave / sloped-soffit wall-top closure |
| Result | `PASS_STAGE_WEB_PIVOT_03_UNIFIED_SOURCEPACKAGE_PARITY` |

## 0. Pre-flight — whole-shell audit

Run before touching source acquisition, and non-mutating: `npx tsx
scripts/shell-audit.ts`. No compiler was changed in this stage.

| check | result |
| --- | --- |
| Elements | 16 closed solids, all closed, orientable and positive volume; 177.782678 m³ total |
| Shared volume, 15 367 vertical rays | worst 2.274e-13 m of line inside two solids at once (~7e-13 m³) |
| Shared volume, 10 160 rays along X | worst 2.274e-13 m |
| Shared volume, 9 680 rays along Z | worst 1.137e-13 m |
| ground wall → attic wall | max void 2.274e-13 m, max overlap 0 |
| attic wall → gable roof | max void 1.679e-6 m (the gold file's own 5-decimal rounding, documented in STAGE WEB-PIVOT-02A), max overlap 0 |
| garage wall → flat roof | max void 0, max overlap 0 |
| ground walls + floor plate, across the main body | largest break 0 |
| main body + garage wing seam | largest break 0 |

The method is exact per ray: the sum of each element's material length along a
line can only exceed the union's where two solids share space, and the
difference is the shared length. Interior voids are asked about *interfaces*
rather than about the building, because the building is hollow and a line
through a room legitimately passes slab, air, roof.

One thing looked like a defect and is not: `manifoldReport` run over the whole
`roof_main_gable` element reports duplicate edges, because a gable roof is two
slabs meeting on the ridge and two coincident faces in contact traverse the same
edge twice. Each slab on its own is closed, orientable and 13.714537 m³, and the
ray scan says they share no volume. The audit now states that a multi-plane roof
is checked slab by slab.

**No compiler P1.** The stage continued.

## 1. The defect this stage removes

Three code paths decided which bytes an analysis would see:

- `src/node/source-loader.ts` parsed the page and then *probed* for a larger
  copy of each drawing, keeping one only if it decoded to more pixels;
- `scripts/build-standalone.ts` re-parsed the page and published whatever the
  markup named;
- `src/web/standalone-worker.ts` re-parsed it a third time and matched images by
  **filename**.

They disagreed. Measured on the pre-stage tree (`6d40fbb`), with the same fetch
cache, by running both paths side by side:

| project | assets | assets whose bytes differ | the one that differed |
| --- | ---: | ---: | --- |
| A — Dom w marcówkach (GE) | 12 | **1** | section: CLI `…__11256.jpg` **1138×854**, web `…__256.jpg` **400×300** |
| B — Dom w bakopach (G2E) | 24 | **1** | section: CLI `…__11256.jpg` **1138×854**, web `…__256.jpg` **400×300** |

The asset that differed was the section — the drawing that carries the storey
datums — on both projects, which is the class of mismatch the brief described.

### What it cost

`npx tsx scripts/source-mismatch-cost.ts A` runs the analyzer twice over one
package, changing exactly one thing: which published copy of the section it
selects. Everything else — the code, the other eleven assets, the repair budget
— is held fixed, so the difference is attributable to the section alone.

| | browser's old copy (400×300) | both hosts now (1138×854) | delta |
| --- | ---: | ---: | ---: |
| score, base | 0.2114 | 0.2176 | +0.0062 |
| score, final | 0.2113 | 0.2176 | +0.0063 |
| score, metric | 0.0592 | 0.0887 | **+0.0295** |
| score, elevation | 0.4910 | 0.4878 | −0.0032 |
| score, perspective | 0.1702 | 0.1598 | −0.0105 |
| printed dimensions corroborated | 0 of 12 read | **1 of 16 read** | +1 |
| roof area | 195.544 m² | 174.704 m² | **−20.841 m²** |
| wall area | 215.932 m² | 217.447 m² | +1.514 m² |
| resolved hypothesis | `bh_5caef49ff105__overhang+0.40` | `bh_f7cadd3b8827` | a different building |

The hosted preview was not showing a slightly worse version of the CLI's answer.
It was showing a different building, with a roof 10.7 % larger, and neither
output said so.

## 2. The contract

`src/core/contracts/source-package.ts`. Portable: no DOM, no Node stream, no
browser global, no React, no Three.js. Schema version **3.0.0**.

```ts
type SourcePackage = {
  schemaVersion: string            // '3.0.0'
  packageId: string                // pkg_<first 16 hex of contentHash>
  projectId: string                // vendor project code
  canonicalUrl: string
  identity: SourceIdentity
  document: SourceDocumentRecord   // the page, with its own byte hash
  assets: SourceAssetRecord[]
  missing: SourceMissingRecord[]
  discovery: SourceDiscoveryRecord[]
  facts: PublishedFact[]           // so no host has to re-parse the page
  rooms: RoomFact[]
  notes: Record<string, string>
  warnings: string[]
  toolVersions: Record<string, string>
  origin: 'LIVE_FETCH' | 'LOCAL_CACHE' | 'PREBUILT_BUNDLE'
  fetchedAt?: string
  contentHash: string
}
```

Each asset carries every field §5 of the brief requires:

```ts
type SourceAssetRecord = {
  assetId: string          // asset_<12 hex of sha256(projectId|discoveredUrl)>
  projectId: string
  selectedUrl: string      // the copy analysed
  discoveredUrl: string    // where it was first seen
  canonicalUrl: string     // the largest official copy known to exist
  exposedBy: string        // the page or endpoint whose markup exposed it
  channel: DiscoveryChannel
  label: string
  mediaType: string
  width: number            // DECODED pixels, never a markup attribute
  height: number
  byteLength: number
  contentHash: string      // SHA-256 of the bytes
  roles: AssetRoles        // four dimensions + the analyzer's own role
  analysable: boolean
  variants: SourceVariantRecord[]   // every published copy found
  relations: AssetRelation[]
  selectionReason: string
  status: 'OK' | 'FAILED' | 'NOT_FETCHED' | 'REGISTERED_ONLY'
  error?: SourceErrorRecord
}
```

### Roles in four dimensions

One enum could not answer four questions, so an asset could only ever mean one
thing — and on Marcówki that cost a real source: the dimensioned ground-floor
plan was demoted to `PLAN_OTHER` because a different ground-floor image was
chosen as the primary geometry view, and nothing downstream could tell it had
ever been a ground-floor plan.

| dimension | values |
| --- | --- |
| `document` | `FLOOR_PLAN` `SECTION` `ELEVATION` `PERSPECTIVE_RENDER` `SITE_PLAN` `PDF` `OTHER` |
| `storey` | `GROUND` `UPPER_ATTIC` `ALL` `UNKNOWN` |
| `annotation` | `DIMENSIONED` `AREA_LABELS` `CLEAN` `UNKNOWN` |
| `view` | `FRONT` `REAR` `LEFT` `RIGHT` `HERO` `GARDEN` `UNKNOWN` |
| `projection` | bridged to `ProjectionType`, the existing classifier's vocabulary |
| `analyzerRole` | the single-enum `AssetRole`, carried through **unchanged** |

The demoted plan is now `FLOOR_PLAN / GROUND / DIMENSIONED / UNKNOWN` with
`analyzerRole: PLAN_OTHER`, related to its area-labelled twin by
`SAME_DOCUMENT_AS`. The analyzer sees exactly what it saw before; the package
remembers what was lost.

### Relations

`SAME_DOCUMENT_AS` · `SAME_VIEW_AS` · `VARIANT_OF` · `DERIVED_FROM` ·
`DUPLICATE_OF`. Derived from the role dimensions, and — for floor plans —
corroborated by the publisher's own grouping: the public
`/product_fancybox_floor/<code>/<n>` fragment shows the dimensioned and the
area-labelled copy of one floor together, which is a stronger statement than any
filename comparison.

## 3. Canonical hash

`packageContentHash(pkg) = sha256(canonicalJson(canonicalPackageView(pkg)))`.

**Covered:** schema version · project id · canonical URL · identity · the page's
own byte hash and length · for every asset (sorted by id): id, project, selected
/ discovered / canonical URL, exposing document, channel, label, media type,
decoded width and height, byte length, content hash, `analysable`, status, error
code, all six role dimensions, every variant's URL / channel / media type /
decoded size / byte length / content hash, and every relation · the `missing`
list by `what` and error code · published facts by key, value, unit and
authority · rooms.

**Excluded, and why:** `fetchedAt`, `origin`, `toolVersions`, `packageId`,
`contentHash` itself, `document.status`, variant `status` / `note` / `error`,
`selectionReason`, `warnings`, and the whole `discovery` list. Every one of them
varies between two runs or two machines looking at the same published material —
a timestamp, a node version, a local path, or prose. A reworded explanation is
not a different source.

The exclusions are asserted, not asserted-by-eye: `tests/source-package.test.ts`
stamps a package with a different timestamp, origin, tool set, warning list and
an emptied discovery list and requires the hash not to move, then changes the
schema version, project id, canonical URL, page bytes, an asset byte hash, a
selected URL, a decoded size, a role, a relation and the asset count in turn and
requires it to move every time. Asset order does not matter.

## 4. Acquisition architecture

```
ARCHON page ─► discovery (pure) ─► fetch + decode ─► variant policy (pure) ─► sealed package
                                                                                   │
                            ┌──────────────────────────────────────────────────────┤
                            ▼                                                      ▼
          out/source-packages/<slug>/manifest.json            src/web/bundled/index.ts (inlined)
                   + assets/<contentHash>.<ext>                   + assets published beside the page
                            │                                                      │
                            ▼                                                      ▼
                 npm run analyze / bench                              the browser's worker
                            └──────────────► toParsedSource ◄─────────────────────┘
                                              (the one narrowing)
```

| module | role |
| --- | --- |
| `src/core/source/discovery.ts` | pure; enumerates every URL the markup exposes, once per channel, with the attribute it came from |
| `src/core/source/role-dimensions.ts` | pure; the four dimensions, from the same published text the existing classifier reads |
| `src/core/source/variant-policy.ts` | pure; deterministic best-variant selection with documented tie-breaks |
| `src/node/source-package.ts` | **the one authoritative builder** |
| `src/node/package-store.ts` | manifest and asset bytes on disk, named by content hash |
| `scripts/build-standalone.ts` | embeds a package; no parser, no filename matching |
| `src/web/run-source.ts` | loads a package (bundled, or from `out/source-packages/` in dev) and decodes its assets |
| `src/web/standalone-worker.ts` | checks the seal, calls `toParsedSource`, runs the pipeline |

`src/web/analyze-worker.ts` and `src/web/image-decode.ts` were deleted: the dev
server and the standalone build now take the same path, so the second worker had
nothing left to do that the first did not do identically.

`src/node/source-loader.ts` survives as a **thin adapter** — it builds the
package and narrows it — so the hand-run research commands
(`scripts/dimension-read.ts`, `dimension-project.ts`, `dimension-overlay.ts`,
`render-views.ts` and the `_`-prefixed scratch scripts) and the test helpers see
the same bytes the CLI and the browser do without each of them having to know
about packages. It used to parse the page itself, probe for larger copies and
decide which to keep: that second acquisition path is gone.

### Discovery channels

`IMG_SRC` · `IMG_SRCSET` · `IMG_LAZY_ATTR` · `FLOOR_PLAN_ATTR` · `ANCHOR_HREF` ·
`OG_IMAGE` · `FANCYBOX_AJAX` · `DOCUMENT_LINK` · `VARIANT_CONVENTION`.

All nine are implemented, including the two this publisher's markup does not
currently use (`srcset` and the lazy-loading attributes); a channel that finds
nothing costs one pass and records that it found nothing, which is a more useful
thing to be able to say than "we never looked". Only publicly served ARCHON
material is read, with no access control bypassed: the project page, the
`/product_fancybox_floor/` and `/product_fancybox_hotspot/` fragments the page
links, and the asset hosts.

Two findings came out of the AJAX fragments:

- the floor fragments **corroborate** the dimensioned/area-labelled pairing;
- the render fragment serves a **1600×900** hero from `cdn1.archon.pl`, against
  the 800×600 the page embeds. `cdn1.archon.pl` was added to the fetch
  allowlist — it is ARCHON's own host, and excluding it silently turned official
  material into a download failure. The 1600×900 copy is 16:9 against the page
  copy's 4:3, so the policy correctly refuses to treat it as a larger copy of
  the same view: it is registered as its own asset, related by `SAME_VIEW_AS`,
  and not analysed. See *Limitations*.

One bug was found and fixed while implementing this: ARCHON links a lightbox
original with a **root-relative** href (`/images/products/<code>/<file>.jpg`).
Resolved against the page it becomes a `www.archon.pl` URL that 404s and misses
the cache, splitting one asset into two. `productOrigin()` resolves a relative
product path against a product image the document already names absolutely,
which is the rule the parser has always used and which needs no host written
down anywhere.

### Best-variant policy, and its tie-breaks

Source-neutral: nothing in it mentions a filename, a project, a role or a
publisher. It sees measured candidates.

1. **Decoded pixel count**, largest first — among candidates whose aspect ratio
   matches the reference crop (within 2 %). A larger image with a different
   shape is a different drawing, and is rejected by name.
2. **Byte-identical duplicates collapse**: the same content at two URLs is one
   candidate, and the higher-trust channel names it.
3. **Channel trust**, highest first: `ANCHOR_HREF` 90 · `FLOOR_PLAN_ATTR` 85 ·
   `OG_IMAGE` 80 · `FANCYBOX_AJAX` 75 · `IMG_SRCSET` 60 · `IMG_SRC` 50 ·
   `IMG_LAZY_ATTR` 45 · `DOCUMENT_LINK` 40 · `VARIANT_CONVENTION` 10. A URL
   guessed from a naming convention loses every tie it is in.
4. **URL**, lexicographically, so the result is a function of the input and not
   of iteration order. Reaching this rule is reported as `ambiguous` and
   recorded in `missing` with `AMBIGUOUS_VARIANT`.

The reference crop is the highest-trust candidate rather than the largest: the
page's own `<img>` is the copy the descriptive filename and the alt text belong
to, so it is what defines what this asset *is*.

**No fake resolution.** Dimensions are decoded from downloaded bytes; a `width`
attribute is a layout instruction and never reaches the policy. Nothing
resamples. Where no larger copy exists, the package says so: the hero's
conventional `__11289` guess 404s and is recorded as a `FAILED` variant reading
*"no larger copy is published at the conventional address"*.

## 5. Reproducible package command

```sh
npm run source:package A              # build from the cache
npm run source:package -- A --online  # fetch anything the cache lacks
npm run source:package A B
```

Writes `out/source-packages/<slug>/manifest.json` and
`assets/<contentHash>.<ext>`, and prints the audit in §6 below. `npm run fetch`
remains as an alias so existing muscle memory still works.

Running it twice against unchanged cached inputs produces the identical package:
measured three times for A (two offline, one online) — `pkg_29b62d3714de8bc4`,
hash `29b62d37…` every time. The parity audit repeats the check from a fresh
build and compares the canonical view field for field.

## 6. Source inventories

`*` marks an asset handed to the analyzer; the rest are registered as evidence
and related to the asset that stands in for them. CLI and web columns are
identical by construction — both read the same manifest — and are verified in
§8.

#### A — Dom w marcówkach (GE)  `pkg_29b62d3714de8bc4`

| logical source | selected variant | decoded | bytes | sha256 | analyzer role | alternates | CLI | web |
| --- | --- | --- | ---: | --- | --- | --- | :-: | :-: |
| ELEVATION / ALL / CLEAN / FRONT | `…__11264.jpg` | 1280×597 | 501412 | `130edece` | ELEVATION_FRONT | `__264.jpg 550×256`<br>`__11264.jpg 1280×597` | ✓ | ✓ |
| ELEVATION / ALL / CLEAN / LEFT | `…__11265.jpg` | 1280×597 | 402646 | `93e15087` | ELEVATION_LEFT | `__265.jpg 550×256`<br>`__11265.jpg 1280×597` | ✓ | ✓ |
| ELEVATION / ALL / CLEAN / REAR | `…__11267.jpg` | 1280×598 | 493637 | `84ebf5b3` | ELEVATION_REAR | `__267.jpg 550×255`<br>`__11267.jpg 1280×598` | ✓ | ✓ |
| ELEVATION / ALL / CLEAN / RIGHT | `…__11266.jpg` | 1280×598 | 386559 | `0015dfde` | ELEVATION_RIGHT | `__266.jpg 550×255`<br>`__11266.jpg 1280×598` | ✓ | ✓ |
| FLOOR_PLAN / GROUND / AREA_LABELS / UNKNOWN | `…__11915.gif` | 853×853 | 94087 | `87ab5a71` | PLAN_GROUND | — | ✓ | ✓ |
| FLOOR_PLAN / GROUND / DIMENSIONED / UNKNOWN | `…__11815.gif` | 853×853 | 92426 | `abfdb262` | PLAN_OTHER | — | ✓ | ✓ |
| FLOOR_PLAN / UPPER_ATTIC / AREA_LABELS / UNKNOWN | `…__11917.gif` | 853×853 | 71843 | `a1b96ef3` | PLAN_UPPER | — | ✓ | ✓ |
| FLOOR_PLAN / UPPER_ATTIC / DIMENSIONED / UNKNOWN | `…__11817.gif` | 853×853 | 71733 | `06af9e91` | PLAN_OTHER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / GARDEN | `…__290.jpg` | 800×600 | 351077 | `5b9c3937` | GARDEN_RENDER | `__11290.jpg (none)` | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / HERO | `…__259.jpg` | 200×150 | 8260 | `18fc65ea` | HERO_RENDER | `__11259.jpg (none)` | · | · |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / HERO | `…__289.jpg` | 800×600 | 301066 | `d32a9a41` | HERO_RENDER | `__11289.jpg (none)` | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / HERO | `…__49832.jpg` | 1600×900 | 501607 | `685a5d68` | HERO_RENDER | — | · | · |
| SECTION / ALL / CLEAN / UNKNOWN | `…__11256.jpg` | 1138×854 | 77410 | `2201a9c1` | SECTION | `__256.jpg 400×300` | ✓ | ✓ |
| SITE_PLAN / UNKNOWN / CLEAN / UNKNOWN | `…__11255.jpg` | 734×854 | 212208 | `331087c2` | SITE_PLAN | `__255.jpg 344×400`<br>`__11255.jpg 734×854` | ✓ | ✓ |

12 analysed, 2 registered as evidence. Missing: none.

#### B — Dom w bakopach (G2E)  `pkg_1022b43a09afde05`

| logical source | selected variant | decoded | bytes | sha256 | analyzer role | alternates | CLI | web |
| --- | --- | --- | ---: | --- | --- | --- | :-: | :-: |
| ELEVATION / ALL / CLEAN / FRONT | `…__11264.jpg` | 1280×411 | 489760 | `ead9b9aa` | ELEVATION_FRONT | `__264.jpg 550×181`<br>`__11264.jpg 1280×411` | ✓ | ✓ |
| ELEVATION / ALL / CLEAN / LEFT | `…__11265.jpg` | 1280×411 | 453775 | `0e96b5bd` | ELEVATION_LEFT | `__265.jpg 550×179`<br>`__11265.jpg 1280×411` | ✓ | ✓ |
| ELEVATION / ALL / CLEAN / REAR | `…__11267.jpg` | 1280×410 | 474264 | `d19de640` | ELEVATION_REAR | `__267.jpg 550×185`<br>`__11267.jpg 1280×410` | ✓ | ✓ |
| ELEVATION / ALL / CLEAN / RIGHT | `…__11266.jpg` | 1280×415 | 392346 | `5ce58f7a` | ELEVATION_RIGHT | `__266.jpg 550×180`<br>`__11266.jpg 1280×415` | ✓ | ✓ |
| FLOOR_PLAN / GROUND / AREA_LABELS / UNKNOWN | `…__11915.gif` | 853×853 | 111742 | `74ba39be` | PLAN_GROUND | — | ✓ | ✓ |
| FLOOR_PLAN / GROUND / DIMENSIONED / UNKNOWN | `…__11815.gif` | 853×853 | 114769 | `66f417c4` | PLAN_OTHER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / GARDEN | `…__290.jpg` | 800×600 | 398089 | `9f14eb6f` | GARDEN_RENDER | `__11290.jpg (none)` | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / HERO | `…__259.jpg` | 200×150 | 8897 | `c189f597` | HERO_RENDER | `__11259.jpg (none)` | · | · |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / HERO | `…__289.jpg` | 800×600 | 366027 | `3092ae77` | HERO_RENDER | `__11289.jpg (none)` | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / HERO | `…__51422.jpg` | 1600×900 | 534012 | `904478bd` | HERO_RENDER | — | · | · |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52409.jpg` | 1600×1066 | 1186041 | `bef6f75c` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52408.jpg` | 1600×1066 | 1442915 | `ed254e1e` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52410.jpg` | 1600×1066 | 1742725 | `7344e3d3` | OTHER_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__59762.jpg` | 1600×900 | 1050720 | `a51dc89d` | OTHER_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__59761.jpg` | 1600×900 | 991427 | `e66d1eea` | OTHER_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52400.jpg` | 710×1066 | 670334 | `7b2e95cb` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52406.jpg` | 1600×1066 | 1739786 | `e690aeb4` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52403.jpg` | 1600×1066 | 1290075 | `6e4e9902` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52404.jpg` | 1600×1066 | 1573945 | `ec173a35` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52399.jpg` | 1600×1066 | 1730663 | `d2775a97` | OTHER_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52407.jpg` | 1600×1066 | 1885408 | `68ce83c8` | OTHER_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52405.jpg` | 710×1066 | 547713 | `ff482262` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52402.jpg` | 710×1066 | 688412 | `fb70212b` | INTERIOR_RENDER | — | ✓ | ✓ |
| PERSPECTIVE_RENDER / UNKNOWN / CLEAN / UNKNOWN | `…__52401.jpg` | 710×1066 | 690514 | `3b45a496` | OTHER_RENDER | — | ✓ | ✓ |
| SECTION / ALL / CLEAN / UNKNOWN | `…__11256.jpg` | 1138×854 | 58959 | `9e65e451` | SECTION | `__256.jpg 400×300` | ✓ | ✓ |
| SITE_PLAN / UNKNOWN / CLEAN / UNKNOWN | `…__11255.jpg` | 734×854 | 234053 | `4bf68603` | SITE_PLAN | `__255.jpg 344×400`<br>`__11255.jpg 734×854` | ✓ | ✓ |

24 analysed, 2 registered as evidence. Missing: none.

No public PDF or other document link is exposed on either project page, so the
`DOCUMENT_LINK` channel found nothing to register. It is implemented and will
register such a document as `REGISTERED_ONLY` evidence rather than discard it.

## 7. Strict offline

`offline: true` means no network. A cache miss throws `OfflineCacheMissError`
and lands in the package as an `OFFLINE_CACHE_MISS` record; it is never repaired
by a quiet request.

This also fixed a live bug: `src/node/cli.ts` computed an `offline` flag and
used it only to choose between a local HTML file and a fetch — it never passed
it to the loader, so the probe for larger copies ran against the network on
every "offline" run.

Proved rather than asserted (`tests/source-package.test.ts`):

- with `globalThis.fetch` replaced by a function that throws and counts, a full
  offline build of A completes, makes **0** attempts, and reproduces the same
  package hash;
- `fetchWithCache(..., { offline: true })` on an uncached URL rejects with
  `OfflineCacheMissError` and makes **0** attempts;
- an offline build against an empty cache directory yields 0 images, records
  `OFFLINE_CACHE_MISS`, records `ROLE_MISSING` for the roles the analyzer
  expects, and no asset claims bytes it does not have.

## 8. Parity proof

`npx tsx scripts/source-parity-audit.ts --analyze` — 21 checks per project, all
passing for A and B. Three readers of one package: the manifest on disk (what
`npm run analyze` consumes), the manifest embedded in the web bundle (what the
browser consumes), and a fresh build.

| check | A | B |
| --- | :-: | :-: |
| the manifest matches its own seal | OK | OK |
| a fresh build reproduces the package hash | OK | OK |
| the canonical view is identical, field for field | OK | OK |
| a different timestamp, origin and tool set do not move the hash | OK | OK |
| changing one asset byte hash does move it | OK | OK |
| the web manifest matches its own seal | OK | OK |
| package hash | OK | OK |
| package id | OK | OK |
| schema version | OK | OK |
| asset count | 14 = 14 | 26 = 26 |
| asset ids | OK | OK |
| asset byte hashes, decoded sizes, roles and relations | OK | OK |
| only the origin differs, as it must (a bundled copy *is* prebuilt) | OK | OK |
| the analyzer receives the same asset list | OK | OK |
| ...and the same published facts | OK | OK |
| the browser worker module runs against this package | OK | OK |
| ...and reports the package the CLI used | OK | OK |
| ...and decoded every asset the package selects | 12 of 12 | 24 of 24 |
| ...and stamps that package into its exports | OK | OK |

The web reader is not a simulation: `runStandalone` from
`src/web/standalone-worker.ts` is the module the browser's worker runs, invoked
on the same bytes. For A it is additionally exercised end to end in a real
browser by `npm run standalone:verify`.

A package whose seal is broken is refused rather than analysed, on both hosts:
editing one `selectedUrl` makes `runStandalone` throw *"does not match its own
hash"*.

| project | package | hash |
| --- | --- | --- |
| A | `pkg_29b62d3714de8bc4` | `29b62d3714de8bc473b81f504518eb17efc4e6774dbde3448c86d839af4da940` |
| B | `pkg_1022b43a09afde05` | `1022b43a09afde05391ee77fb5770ce8141397b32285d3fd56b065c63c54e543` |

Only A is published in the shipped standalone artifact — B's analysable assets
are 20.9 MB of interior renders, which would make a phone preview unusable. B's
parity is proven at the package level and through the browser's own worker
module, which is where the claim actually lives; bundling is a distribution
choice, not a parity fact.

## 9. Failures and fallbacks

Structured, never silent. `SourceErrorCode`: `PAGE_UNAVAILABLE` ·
`DOWNLOAD_FAILED` · `REDIRECT_REJECTED` · `UNSUPPORTED_MEDIA_TYPE` ·
`DECODE_FAILED` · `ROLE_MISSING` · `AMBIGUOUS_VARIANT` · `OFFLINE_CACHE_MISS` ·
`ENDPOINT_CHANGED`.

An unrelated thumbnail is never substituted for a drawing that would not
download. A lower-resolution copy is used only when it is the same logical view,
and then the reason is on the record: every rejected variant carries a sentence
saying what it was and why it lost. A conventional guess that does not resolve
is recorded as the evidence for "no larger copy is published" rather than left as
a silence, and it never becomes a phantom asset of its own.

Both A and B currently build with **zero** missing records.

## 10. Analyzer output impact

No analyzer tuning: the WallSpec compiler, the roof compiler, the Marcówki gold
geometry, OCR thresholds, the dimension recognizer, the plan scaffold, the mass
solver, the opening detector, the camera solver, the repair loop and the score
weights are untouched. `analyzerRole` is still produced by `classifyByMetadata`,
`resolveRoleConflicts`, `preferDimensionedPlans` and `dedupeSameView`, unchanged.

**CLI:** numerically identical before and after, because the CLI was already
analysing the better copies.

| | before (`6d40fbb`) | after |
| --- | --- | --- |
| A footprint / ridge / eave / pitch | 12.14 × 12.67 m, 131.16 m², 7.92 m, 4.60 m, 40° | identical |
| A score | 0.2176 → 0.2176 | identical |
| B footprint / ridge / eave / pitch | 12.68 × 17.98 m, 227.89 m², 6.10 m, 3.33 m, 35° | identical |
| B score | 0.2118 → 0.2118 | identical |
| A export bundle hash | `bdb61e4798a80895` | `6b3fd8e431dbda1b` |
| B export bundle hash | `8711e1053978aa9f` | `3abff4dc7765d735` |

The bundle hashes moved because the exports now carry the source-package trace
(§11) and the asset records carry channel-tagged variants. No analysed number
moved.

**Web:** changed, and that is the correction. The figures are in §1: the browser
now produces the CLI's answer instead of one built on a 400×300 section.

## 11. Export traceability

`source-package.json`, `self-verification.json` and `benchmark-summary.json` each
carry:

```json
"sourcePackage": {
  "sourcePackageId": "pkg_29b62d3714de8bc4",
  "sourcePackageSchemaVersion": "3.0.0",
  "sourcePackageHash": "29b62d3714de8bc4...",
  "sourceOrigin": "LOCAL_CACHE"
}
```

## 12. Web preview truthfulness

The browser does not fetch archon.pl and the page no longer leaves room to
imagine otherwise. The **SOURCE PACKAGE** panel names the package, its schema,
the first 32 hex of its hash, its asset counts, anything missing, and states its
origin in words: *"package bundled with this page (no live fetch happened in the
browser)"* for a hosted build, *"built by a live Node-side acquisition"* or
*"built from the local Node fetch cache"* otherwise. The progress line says which
of the two package sources it is reading from.

The existing **SOURCE ASSETS** grid is unchanged in place and purpose, and now
loads each thumbnail by the same content-hash file name the analysis used — so a
thumbnail that resolves is itself evidence that the analysed bytes are the ones
on screen.

## 13. Gold compiler isolation

The STAGE WEB-PIVOT-02/02A gold fixture remains development-only, and
`tests/source-package.test.ts` now enforces it two ways: no file under `src/`
outside `src/core/wallspec/` mentions `marcowki-fixture` or `research/gold`, and
no analyzer module under `src/core/`, `src/node/` or `src/web/` mentions
`wallspec` at all. Their tests run unchanged and pass.

## 14. Gates

| gate | command | result |
| --- | --- | --- |
| STAGE 03 tests | `npx vitest run tests/source-package.test.ts` | 37 / 37 pass |
| STAGE 01 | `tests/wall-compiler.test.ts` | 15 / 15 pass |
| STAGE 01B | `tests/wall-junction.test.ts` | 17 / 17 pass |
| STAGE 01C | `tests/storey-ring.test.ts` | 52 / 52 pass |
| STAGE 02 | `tests/roof-compiler.test.ts`, `tests/marcowki-shell.test.ts` | 40 / 40 pass |
| STAGE 02A | `tests/eave-closure.test.ts` | 31 / 31 pass |
| existing analyzer tests | the rest of the suite | pass |
| full suite | `npm test` | **321 / 321 pass, 18 files** |
| typecheck | `npm run typecheck` | clean |
| build | `npm run build` | clean |
| standalone bundle | `npm run standalone:bundle` | clean, 12/14 assets published, 3.06 MB |
| standalone build | `npm run standalone:build` | clean, `dist-standalone/` 4.1 MB |
| browser verification | `npm run standalone:verify` | **11 / 11 pass** |
| CLI | `npm run analyze A`, `npm run analyze B`, `npm run bench` | pass (A, B, C) |

### Two fixes to the browser verification

Check 7 (*orbit and zoom work*) failed after this stage's UI change, and the
cause was the check, not the app:

1. **It compared stale frames.** `canvas.screenshot()` on a WebGL canvas can
   return a frame from before the render — the drawing buffer is not preserved
   between frames. Demonstrated by rotating the camera through 222° and watching
   the element capture stay byte-identical while a page capture showed the model
   turned. The check now clips a page screenshot to the canvas.
2. **It read the canvas position too early.** The app scrolls the model into
   view when a run finishes, and that scroll is smooth; two identical samples
   during the still moment before it starts look exactly like a scroll that has
   finished. It now waits for `window.scrollY` to hold across four samples.

One real, if small, app fix came out of the investigation: `touch-action: none`
was set on the viewer's wrapper but not on the canvas, and `touch-action` is not
inherited. On a touch device a drag on the canvas could pan the page instead of
turning the model.

### Production isolation

`dist-standalone/` is 4.1 MB and carries no HTML page string any more — the
package supersedes it. The analyzer, OCR, EvidenceGraph, repair loop and camera
scoring are unchanged; what changed is which bytes reach them, and on the CLI
even that did not change (§10).

## 15. Limitations

1. **The 1600×900 hero is registered, not analysed.** It is a different crop of
   the same view, so the variant policy correctly refuses to substitute it, and
   promoting it would change the analyzer's input set — outside this stage's
   remit. It is in the package with a `SAME_VIEW_AS` relation, waiting.
2. **`analysable` mirrors the parser's own selection**, so the assets
   `dedupeSameView` set aside are kept as evidence rather than analysed. That is
   deliberate — it keeps the analyzer's input identical to before — but it means
   the four-dimension roles are not yet *used* by anything downstream.
3. **Only A is in the shipped standalone artifact** (§8).
4. **`ENDPOINT_CHANGED` and `PAGE_UNAVAILABLE` are defined but not exercised** by
   either development project; the paths that would raise them are in the
   builder, but nothing here proves them.
5. **The fetch allowlist grew by one host** (`cdn1.archon.pl`). It is ARCHON's
   own asset host, reached only over HTTPS through the same policy; it is still
   a closed set of four and still not an open proxy.
6. **Asset bytes are not committed.** `fixtures/*/assets/` and
   `out/source-packages/` are git-ignored, so a fresh clone must run
   `npm run source:package -- A B --online` once before the offline tests and the
   parity audit can run.

## 16. Recommended next bounded step

**Let the analyzer use the dimensioned floor plans.** The package now
distinguishes `FLOOR_PLAN / GROUND / DIMENSIONED` from `FLOOR_PLAN / GROUND /
AREA_LABELS` and relates them as one document, but `toParsedSource` still hands
the analyzer the single-enum roles, so the dimensioned copy arrives as
`PLAN_OTHER` and the dimension reader never looks at it. The bounded step is to
select the plan for dimension reading by its role *dimensions* rather than by
`analyzerRole` — one selection site, no new contract, no new acquisition — and to
report what the printed-dimension stage finds when it is given the copy with the
dimension chains on it. On A that stage currently corroborates 1 dimension of 16
read; it has never been shown the drawing that carries them.

Nothing else. No new OCR engine, no dimension-to-wall association, no room
reconstruction, no internal walls, no stairs, no balcony geometry, no facade
recess reconstruction, no camera-verifier rewrite, no Kotlin port.

---

`PASS_STAGE_WEB_PIVOT_03_UNIFIED_SOURCEPACKAGE_PARITY`
