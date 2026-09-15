# Automatic floor plan → ArchitecturalSpec candidate

**STAGE WEB-PIVOT-06.** The first automatic path from a published `SourcePackage`
to a metric, provenance-carrying architectural candidate — with no hand
transcription anywhere in it, and no remote model of any kind.

---

## 1. HEAD

| | |
| --- | --- |
| starting HEAD | `ce3bbbf76ed1efa19e87dae3698f5889fb7e38a6` |
| final HEAD | recorded in §26 below, after the last commit |
| worktree at the start | clean, no unknown changes |

Commits, in order:

| commit | what |
| --- | --- |
| `b4bec20` | §4 — the fresh holdout declared before any implementation |
| `4ebb1bd` | §6 — the recogniser measured, and replaced |
| `c66e8b1` | §7-§10 — dimension geometry, association, and the sheet's own scale |
| `88d0fe0` | §11-§21 — walls, rooms, the candidate, and the gold evaluation |

## 2. Branch

`claude/new-session-pvd4ik`, pushed to `origin` after each commit.

## 3. The holdout was chosen before anything was built

Project D — *Dom w kruszczykach 22* — was **spent**. It had been run twice under
the WEB-02 freeze, its footprint, ridge, eave and pitch were reported, and a
missing-gable-wall defect was found and fixed against it. A holdout is spent the
moment its extracted geometry has been looked at, whether or not anything was
tuned on it, so it could not be presented as untouched again. It is demoted to
`HISTORICAL_HOLDOUT_WEB02` alongside C, and the role union now names both spent
holdouts so neither can quietly reclaim `HOLDOUT`.

**E — *Dom w wisteriach 21*** takes its place.

| | |
| --- | --- |
| canonical URL | `https://www.archon.pl/projekty-domow/projekt-dom-w-wisteriach-21-m42a2875282921` |
| project id | `m42a2875282921` |
| SourcePackage | `pkg_153cb4240fa560e2` |
| hash | `153cb4240fa560e292c7b5fef3dd44a22c5d52058384ceee6b8281f4ec7872e8` |

It was selected on the presence of the drawing roles Stage 06 consumes and on
nothing else: dimensioned and area-labelled plans for both storeys, a section,
and four elevations. **No plan image was decoded, no printed dimension read, and
no geometric value of any kind transcribed.** The declaration is committed at
`research/holdout/web-pivot-06-holdout.json` in `b4bec20`, which is *before* the
first line of extraction code, so the ordering is a fact about the history and
not a claim in prose.

## 4. Extraction architecture

```
SourcePackage
  └─ selectPlanAsset                 FLOOR_PLAN / {GROUND,UPPER_ATTIC} / DIMENSIONED, by role
     └─ inkChannel                   ink as the darkest channel, not luminance
        ├─ detectTextRegions         runs of same-sized ink components sharing a baseline
        ├─ detectDimensionStructures baselines by local contrast; anchors; callout rings
        │   └─ reachableBaselines    which lines each run is near enough to label
        ├─ buildTextCrops            geometry-chosen boxes, enlarged and padded
        │   └─ PlanTextEngine        ← Tesseract adapter (swappable, local, no network)
        ├─ buildObservations         propose scales → fit chains → own the numbers
        ├─ detectWallBands           solid bands with two faces, thickness in metres
        │   └─ buildPlanModel        runs + openings, flooded rooms, adjacency
        └─ buildSpecCandidate        ArchitecturalSpecCandidate (never canonical)
```

Portable core is `src/core/extract/**`; the only Node-specific part is the OCR
adapter in `src/node/ocr/` and the runner that wires them.

## 5. OCR: what was measured, and what was chosen

The brief said stop hand-authoring glyph prototypes and evaluate a mature local
engine. Both arms were given the **same boxes**, so what was compared is the
recogniser and not the detector, and the built-in arm additionally got
everything its design asks for — its whole-drawing alphabet harvest and a scale
estimate.

| project A | boxes offered | tokens read | matched truth | precision |
| --- | --- | --- | --- | --- |
| ground, built-in glyph templates | 57 | 3 (`288 22 8847`) | **0 of 38** | 0% |
| ground, Tesseract 5.3.4 | 57 | 23 | **20 of 38** | 87% |
| attic, built-in glyph templates | 45 | 2 (`99 95`) | **0 of 28** | 0% |
| attic, Tesseract 5.3.4 | 45 | 17 | **17 of 28** | 100% |

On project B the built-in recogniser reads **no tokens at all**; Tesseract reads
34. Truth is `research/eval/ocr-plan-digits-v1.json` — every printed dimension
token on A's two dimensioned plans, read by eye at magnification, evaluation
only. Matching is by multiset of strings and says so: a correct number read in
the wrong place counts here, and whether a number found its right owner is
measured separately in §16.

The measurement without any hand truth at all: the ground plan prints
`790 + 415 = 1205` across its top margin as three separate labels. Tesseract's
reading set reproduces that sum; the built-in recogniser's does not.

**Tesseract was chosen over PaddleOCR and Surya on portability, not accuracy.**
It is a C++ library with no Python or GPU runtime, packaged everywhere this
project cares about, and — the point that decides it for a codebase with a
Kotlin port ahead of it — the same engine and the same `traineddata` run on
Android through `Tesseract4Android`. A Python adapter would have to be replaced
wholesale on the phone. The seam (`PlanTextEngine`) is owned by this codebase,
batches crops, and carries a confidence on every reading, so a second engine can
be added and disagreements kept visible rather than averaged.

No remote OCR, no remote LLM, no network call of any kind at runtime.

`npm run ocr:benchmark -- A` repeats the measurement.

## 6. Dimension geometry

Three things had to be got right before any number could mean anything.

**A stroke is what is darker than its own surroundings.** A published plan has
three tones, not two: paper, tinted rooms, and line work. A global ink threshold
loose enough to catch a dimension line drawn over a room catches the whole room,
and every row of the drawing then reads as one enormous line — which is exactly
why the attic plan's interior chains were invisible to the previous detector. A
directional top-hat answers for a hairline over a tint and stays silent through
the body of a wall, which also keeps walls out of the set of dimension
baselines.

**A dimension line ends at its terminators.** A wall edge, a paving joint or a
counter front crosses other strokes wherever it happens to and then keeps going;
a dimension line is drawn between its own ticks. Requiring the outermost anchors
to sit at the stroke's ends is what separates the two.

**Text is not a tick.** The upright of a `1` and the stem of a `4` are short
perpendicular strokes, and a label printed above its own baseline puts several
within a tick's reach. Left in, the overall dimension across A's ground plan
collects ten anchors instead of two and states nothing. The text is already
known, so the fix is to not look where it is.

## 7. OCR observations

A reading is what a recogniser returned. It carries the token, a confidence in
0..1, the engine that made it, and the crop it came from. Readings are never
treated as measurements, and a label read several ways keeps every reading.

One bug worth recording because it is invisible to any string-level metric:
Tesseract's batch TSV numbers its pages **from one**, and reading that as an
index attributes every number to the crop before it. The benchmark scores were
unaffected — they compare sets of strings — and every single association was
wrong. A regression test now puts a blank crop beside a written one in both
orders, because that is the arrangement the mistake cannot survive.

## 8. Physical association

Not by proximity. A plan stacks its chains in bands and draws a great many lines
that are not chains, so the baseline nearest a label is often the wrong one and
nothing in the pixels around the label says which is right.

Reading direction is not used either. It is tempting — surely a rotated label
belongs to a vertical chain — and it is wrong: A's attic plan prints its top
chain, which measures across the sheet, with every label rotated.

What decides is arithmetic, in §9. Until it does, a text run has only *reach*:
the set of baselines it is close enough to be labelling. A run that reaches
nothing, or that reaches baselines whose chains cannot place it, becomes an
observation with `owner.kind = 'NONE'` and the reason it has none. Nine such
readings are reported on A's ground plan and six on its attic. **A number
without a physical owner is not a metric constraint**, and it is also not thrown
away.

## 9. The chain solver

A chain is a partition. Its segments run end to end along one line, each
starting where the last finished, in the order the labels are printed.

Allowing a label to claim any pair of anchors instead lets a dense baseline
supply a plausible span for almost any value, and a scale 42% too large then
finds a self-consistent reading of a whole sheet — eleven labels' worth on A's
attic plan, entirely wrong. Requiring the segments to tile removes it: at the
wrong scale they do not join up.

The fit is an exact dynamic program over (label, anchor), not a greedy walk,
because a greedy walk commits to an early segment a later one cannot follow. It
is scored by **labels read**, each weighted by how squarely its segment lands,
rather than by pixels claimed — every partition between the same two ends
accounts for the same pixels, so pixel length cannot tell a fit that lands
squarely from one that merely stays inside tolerance.

## 10. Metric registration

Candidate scales are proposed by the labels themselves, then *tested* by fitting
real chains to every baseline. The winner must then survive two more
corroborations.

**One scale for both axes is tried before two.** A sheet is drawn at one scale,
so distortion is claimed only when letting the axes differ reads materially more
of the drawing. A's ground plan is the case in point: its vertical chains fitted
alone settle 3.7% away from its horizontal ones, which at face value is a
distortion finding; fitting them at the horizontal scale reads essentially as
much, so the 3.7% was slack in a loose fit and not a property of the raster. A
publication stretch would not give way like that — and where it does not, the
distortion is reported and never averaged (§10 of the brief).

**Drawings of one set corroborate each other.** A project's plans are published
together at one size, so a plan whose own chains are too few to decide is read
at the scale its sibling established. That is what finally settles A's attic,
whose five readable vertical labels alone prefer a scale 25% off.

| | scale recovered | hand calibration from earlier stages | error |
| --- | --- | --- | --- |
| A ground | 0.38118 px/cm | 0.37759 px/cm | +0.95% |
| A attic | 0.38118 px/cm | 0.37747 px/cm | +0.98% |
| B ground | 0.30170 px/cm | — (no hand calibration exists) | — |

The hand calibration is quoted for comparison only; the extraction has never
read it.

## 11. Wall extraction

A wall is a **band** with two parallel faces, a thickness a wall could
plausibly have, and a length worth calling a wall. Thickness is bounded in
metres (0.05..0.8 m), not pixels, once the chains have given a scale — a
statement about buildings rather than about one publisher's export size. It must
also be *solid*: a published plan tints its rooms and draws its fabric at full
strength, and that tone separates them without knowing any publisher's palette.

A dimension line has no thickness. A hatch stroke has no length. A 1.1 m slab is
not a wall. All three are rejected by the same three rules, and a test asserts
each.

Bands that share a line and a thickness are joined into one wall, and **what
separates them is kept**: those stretches are doorways and passages, reported as
openings and never as fabric. Each wall is then carried to the walls it plainly
meets, because a junction is a blob of ink belonging to neither and each wall is
found stopping short of the other — leaving the corner with a hole the size of a
wall's thickness, through which every room drains into the garden.

Faces are the measurement. A centre line is offered as a derived field and is
never what a dimension is converted to (§12 of the brief).

## 12. Room extraction

A room is what is enclosed, found by flooding the space between the walls rather
than by assembling rectangles. The flood is stopped by the drawing's own solid
fabric **plus each wall's whole line, doorways included** — a doorway is a hole
in the fabric and not a hole in the boundary, and a flood that runs through
every door returns one region for the storey.

Rooms are therefore a partition of the pixels: a pixel belongs to one region or
to none, so §13's no-overlap requirement is structural rather than checked
afterwards. A test asserts that each reported room's area is exactly its label's
pixel count, so no room was assembled from anywhere else.

A region touching the sheet's border is the space around the building, not a
room in it.

## 13. Doors and stairs

**Doors** are the openings above: a gap in a wall line narrow enough for a door
to hang in (≤ 1.4 m) is `DOORWAY`, anything wider is `WIDE` — a glazed bay, a
garage front, an opening between two spaces. That is a width and not a claim
about what is in it. Where an opening lies on a wall separating two regions, it
is reported on that adjacency, which is how "these two rooms are connected by a
door" becomes a statement about the drawing.

**Stairs are not extracted.** The drawing shows them as a run of parallel thin
treads with an arrow, and nothing in this stage looks for them. They are listed
in §25 as a limitation rather than reported as absent geometry.

## 14. ArchitecturalSpecCandidate

`architectural-spec-candidate-1.0.0`, in `src/core/extract/spec-candidate.ts`.

```
{ schemaVersion, kind: 'CANDIDATE', notCanonical: true,
  project, sourcePackageId, sourcePackageHash, engine,
  frame: { originPx, pxPerCm, axes, note },
  storeys: [{ storey, assetId, pxPerCm, frame,
              walls:      [{ axis, fromM, toM, nearM, farM, thicknessM,
                             solidM, openings[], centreM, confidence, provenance }],
              rooms:      [{ areaM2, box, centroid, confidence, provenance }],
              adjacency:  [{ a, b, wallId, sharedM, doorways[] }],
              dimensions: [{ text, valueM, status, owner, confidence, provenance }],
              unownedReadings: [{ text, why }] }],
  conflicts: [{ kind, observations[], unresolved, confidence }],
  notes }
```

Three habits keep `notCanonical` from being decoration. Walls are reported by
their two faces. A `solidM` never includes an opening, so bridging a gap to
bound a room cannot inflate a wall length. And every piece carries where it came
from and how sure the pipeline is.

Each storey has **its own** origin, in its own sheet's pixels. A publisher lays
each drawing out on its own page: A's attic plan sits 11 px left and 64 px above
its ground plan, and one origin for the set would put every attic room two
metres out of place. Aligning each storey on its own outermost wall corner is
what puts them in one building frame, and the candidate says that it assumed the
storeys share that corner.

Nothing in this codebase converts a candidate into a `BuildingSpec`.

## 15. Conflicts and unresolved

§2 of the brief names the case: Stage 05A recorded a genuine lower-storey
chimney/flue ambiguity, and the instruction is not to build another manual stage
that forces continuity.

The automatic behaviour implemented here is the one the brief asks for. Where a
small enclosed void appears at the same plan position on two storeys, the
candidate records a `VERTICAL_CONTINUITY_UNRESOLVED` conflict carrying **both
observations**, what cannot be decided, and a confidence:

> whether these are one shaft running between the storeys or two unrelated
> voids. A floor plan cannot say: it shows what is cut at one level and nothing
> about what passes through. Joining them would be asserting a route no source
> shows, so no route is asserted.

On project A no such pair was found, because neither storey's flue enclosure was
segmented as a region of its own (§25). The mechanism is exercised by a test on
a synthetic two-storey case rather than by A, and that is stated rather than
papered over.

A reading with no owner is the other half of the same discipline: it is kept,
with the reason, and cannot become a constraint.

## 16. Project A, field by field, against the hand gold

Gold is `research/gold/marcowki-interior-v1.json`, read **only** by
`tests/candidate-evaluator.ts`. Alignment is fitted rather than assumed — the
candidate's origin is its own drawing's outermost faces and the gold's is a
corner someone chose by hand — so the evaluator finds the translation that best
explains the walls and reports it.

### Ground floor (aligned dx +0.036 m, dz −4.822 m)

| dimension | result |
| --- | --- |
| major gold walls | 10, totalling 22.73 m |
| matched | **15.95 m = 70.2%** |
| fabric across a gold opening | 3 openings, 0.34 m total (0.10-0.13 m each: jamb width) |
| candidate regions | 6, for 9 gold rooms; 5 sit inside one gold room, 1 covers more than one |
| adjacency | 10 gold edges: **1 agreed**, 5 merged away, 4 missing |
| doors | 6 gold doors: **4 detected, 2 explicitly unresolved, 0 lost** |

Least-covered gold walls: `gw_pantry_west` 0% of 1.13 m, `gw_bath_east` 43%,
`gw_pantry_north` 43%, `gw_entry_north` 51%, `gw_boiler_west` 67%.

### Attic (aligned dx +0.052 m, dz −0.032 m)

| dimension | result |
| --- | --- |
| major gold walls | 10, totalling 30.84 m |
| matched | **23.17 m = 75.1%** |
| fabric across a gold opening | none |
| candidate regions | 8, for 9 gold rooms; 6 sit inside one, 2 cover more than one |
| adjacency | 8 gold edges: **3 agreed**, 5 merged away, **0 missing** |
| doors | 6 gold doors: **3 detected, 3 explicitly unresolved, 0 lost** |

The attic's `dz` of −0.03 m is the honest one; the ground's −4.82 m is the
distance from the building's north wall to the rear terrace edge, which the
extraction took as the outermost wall face. That is an origin-convention
difference, not a geometry error, and it is exactly what a fitted alignment is
for.

`npm run extract:evaluate -- A` reproduces both tables.

## 17. PASS targets

| target (§21) | ground | attic | met |
| --- | --- | --- | --- |
| ≥ 90% of gold major interior-wall length matched | 70.2% | 75.1% | **no** |
| no invented wall closing a source-open passage | 0.34 m across 3 jambs | none | **borderline — see below** |
| zero positive room overlap | 0 (structural) | 0 (structural) | **yes** |
| ≥ 90% adjacency edge agreement | 10.0% | 37.5% | **no** |
| ≥ 90% door hosts detected or explicitly unresolved | 100% | 100% | **yes** |

On the second row: the 0.34 m is three jamb-width overlaps of 0.10-0.13 m where
a candidate wall's solid piece extends a little past the gold's opening edge. No
passage is closed — every gold door is still reported as an opening on the same
wall — but the figure is not zero and is reported as it is.

**Two of five targets are met. The stage result is PARTIAL.**

The dominant failure is a single one: under-segmentation. Rooms whose shared
doorway the extraction did not bridge come back as one region, which is why the
adjacency figure is low while almost nothing is actually *wrong* — on the attic,
every one of the 8 gold edges is either agreed or merged, and none is missing.
Wall coverage has the same root: the walls least covered are the short
partitions around the pantry, bathroom and boiler room, whose doorways leave
pieces too short to survive the minimum-length rule.

## 18. Project B

*(B section pending — filled in below once the frozen run completes.)*

## 19. Holdout E, run once, under the freeze

*(E section pending — filled in below.)*

## 20. Mutations and fault injection

Ten cases, in `tests/extract-isolation.test.ts`, all on drawings built pixel by
pixel so that what is tested is the rule rather than one publisher's style.

| # | injected | required behaviour | result |
| --- | --- | --- | --- |
| 1 | a blank sheet | no walls, no rooms, no claims | pass |
| 2 | no scale established | no geometry at all, rather than geometry in pixels | pass |
| 3 | the same drawing at twice the resolution | the same building to within a pixel of rounding | pass |
| 4 | the drawing moved on its sheet | the same building exactly | pass |
| 5 | a long thin line added | not a wall, however long | pass |
| 6 | a whole room tinted darker | still not fabric | pass |
| 7 | a doorway widened past what a wall can span | the wall splits; no fabric invented across the gap | pass |
| 8 | the engine returns nothing | no observations, no scale | pass |
| 9 | a confident reading with nothing to measure | kept, unowned, with the reason | pass |
| 10 | the same drawing twice | byte-identical runs and rooms | pass |

## 21. Leakage proof

§1 is the load-bearing claim of the stage, so the guards are structural rather
than behavioural: *"it did not read the gold this time"* is an observation and
*"it cannot read the gold"* is a property.

| guard | what it asserts |
| --- | --- |
| coverage | the sweep covers ≥ 8 real files including the observation builder and the OCR adapter, so an empty sweep cannot pass |
| imports | no file under `src/core/extract/**`, `src/node/ocr/**` or `src/node/extract-runner.ts` imports anything under `research/` or `tests/` |
| identifiers | none of them mentions `research/gold`, `research/eval`, or any gold id (`gw_*`, `gd_*`, `uw_*`) |
| projects | none of them mentions any development project by name, id or slug — `marcowki`, `bakopach`, `kosaccach`, `kruszczykach`, `wisteriach`, `m2fa281446a8ca`, `asset_8fda78f8654c` |
| output | a built candidate contains no gold identifier and no project name |

Changing a value in the gold cannot alter the candidate, because no code path
reaches the gold from the extraction: the import guard is the proof, and it is
checked on every run of the suite.

## 22. Diagnostics

| command | what it shows |
| --- | --- |
| `npm run extract:spec -- A\|B` | the whole pipeline, per storey, and writes `observations.json` and `spec-candidate.json` |
| `npm run extract:sheet -- A [GROUND]` | one PNG per drawing: text runs owned and unowned, baselines, anchors, wall faces, openings, rooms |
| `npm run extract:evaluate -- A` | the §16 tables, and the least-covered gold walls |
| `npm run ocr:benchmark -- A\|B` | the §5 measurement |
| `npx tsx scripts/extract-diagnostic.ts A GROUND baselines` | every baseline, its anchors and the gaps between them |
| `… regions` | every text run and the baselines it is near enough to label |
| `… scale` | every scale proposed and tested, with what its chains accounted for, then every reading and what the fit made of it |
| `… walls` | wall bands with their two faces and thickness in metres |
| `… rooms` | wall runs, their openings, the rooms and what adjoins what |
| `… plan` | a PNG of wall faces, openings and tinted rooms |
| `… overlay` | a PNG of baselines, anchors and which readings found owners |
| `… row N` / `… col N` | the ink profile along one scanline, to see what a detector saw |

Outputs land under `out/extract/<slug>/`.

## 23. Gates

*(filled in below.)*

## 24. Production isolation

Nothing in the current URL→model production path was changed.

- `src/core/pipeline/**`, the camera fitting, the repair loop and the scoring
  weights are untouched; no threshold, weight or tolerance in them was moved.
- The new code is reachable only from the new commands
  (`extract:spec`, `extract:sheet`, `extract:evaluate`, `extract:freeze`,
  `extract:holdout`, `ocr:benchmark`). `npm run analyze`, `npm run bench` and
  the browser build do not import it.
- The one change with a side effect outside Stage 06 is that project D, now a
  regression project rather than a holdout, is included in `npm run bench`.
- `npm run holdout` (the legacy WEB-01/02 command) now finds E as the registered
  holdout and refuses to run it without a matching legacy freeze, which is the
  protection working: E must be run through the Stage-06 command, once.

## 25. Limitations

1. **Under-segmentation is the stage's main failure.** Rooms whose shared
   doorway was not bridged into a single wall run come back as one region. It
   costs adjacency most (1 of 10 gold edges agreed on the ground floor) and wall
   coverage some.
2. **Short partitions are missed.** A wall shorter than 0.2 m of solid fabric is
   not claimed, and around doorways the surviving pieces are often shorter than
   that. `gw_pantry_west` is matched at 0%.
3. **Stairs are not extracted at all** (§13).
4. **Callout rings are barely detected** — 2 on A's ground plan, 0 on its attic
   — so opening width/height callouts contribute nothing. The ring detector is
   the legacy one and was not rewritten here.
5. **The origin convention is fragile.** The ground plan's outermost "wall" is
   the rear terrace edge, 4.82 m north of the building's north wall. The fitted
   alignment absorbs it for evaluation, but the candidate's own metres are
   offset by it.
6. **Performance.** A's two plans take about 70 s; B's single dense plan takes
   several minutes, almost all of it in Tesseract on enlarged crops. This is not
   yet an interactive path.
7. **No roofs, no elevations, no sections, no facades.** Out of scope for this
   stage by §3, and not attempted.
8. **One engine.** The seam supports several and `ensembleCandidates` exists,
   but only Tesseract is wired, so no cross-engine disagreement is available.

## 26. The one recommended next bounded step

**Close the room partition at doorways, and measure adjacency again.**

Everything else on the list is smaller or further away. Under-segmentation is a
single mechanism with a single cause — a doorway whose two wall pieces were not
recognised as one wall — and it is what holds two of the five PASS targets down
at once. The bounded step is to detect doorways directly rather than only as a
by-product of merging: a door on these drawings is a gap in a wall with a leaf
and a swing arc drawn into the room it opens into, and both are findable with
what this stage already has (thin-stroke detection for the leaf, a circular arc
for the swing). A doorway found that way closes the wall line whether or not the
two pieces either side survived the minimum-length rule, which addresses
limitations 1 and 2 together.

It should be measured on the same table in §17, on A only, and it should not be
allowed to touch the holdout.

---

