# Doorway-aware wall continuity and room topology recovery

**STAGE WEB-PIVOT-06A.** Stage 06 left two of its five targets unmet, and both
had one cause: a doorway was only ever found as a gap between two wall bands,
and the doorways that matter are exactly the ones that leaves no bands. This
stage reads the door instead.

---

## 1. HEAD

| | |
| --- | --- |
| starting HEAD | `9b78e438b498f1b1889fe1267df42f876173c3f3` |
| frozen at | `d94db119a840bf02164c05b1eee21d453b9bb694` — the last code commit |
| final HEAD | `b48413f` — this report; the last code commit is `d94db11`, which is what the freeze pins |
| worktree at the start | clean, no unknown changes |

| commit | what |
| --- | --- |
| `525963d` | §17 — the fresh holdout declared before any topology code |
| `6def25d` | §13 — the wall-coverage failure taken apart, before anything was touched |
| `e7c8bf2` | §4-§7 — the door read from its symbol |
| `feda524` | §3, §8-§11 — three truths about a doorway, kept apart |
| `9ddcf0f` | §11, §12 — what the source names, and what it does not divide |
| `27d0e15` | §15, §18 — the mutations, and the leakage guards |
| `355ca36` | §13, §14 — the acceptance table |
| `b4fb55a` | §19 — the diagnostics |
| `d94db11` | §17 — the freeze and the one-shot holdout command |

Branch `claude/new-session-pvd4ik`, pushed to `origin` after each commit.

## 2. The fresh holdout was declared before any of this was written

E is spent. It was run once under the Stage-06 freeze and its walls, openings,
rooms, adjacencies, owned dimensions and wall thicknesses were reported per
storey, so its extracted geometry has been looked at; a holdout is spent at
that moment whether or not anything was tuned on it. It is demoted to
`HISTORICAL_HOLDOUT_WEB06` alongside C and D, and the role union names all
three so none can quietly reclaim `HOLDOUT`.

**F — *Dom w malinówkach 58 (E)*** takes its place.

| | |
| --- | --- |
| canonical URL | `https://www.archon.pl/projekty-domow/projekt-dom-w-malinowkach-58-e-m87928f6e82dd1` |
| project id | `m87928f6e82dd1` |
| SourcePackage | `pkg_e75b59f95fe1f161` |
| hash | `e75b59f95fe1f161a72f2eb56f145b5608c33b8daa788c09c4c0b22bcaa26d18` |
| document hash | `c329df882fc316b0fe7ee557a29bae34a33ac2076645e2577b20ffa1385082ec` |

Selected on the presence of the drawing roles Stage 06A consumes and on nothing
else: dimensioned and area-labelled plans for both storeys, a section and four
elevations. **No plan image was decoded for inspection, no printed dimension
read, and no door, opening, wall or room value of any kind looked at.** The
declaration is committed at `research/holdout/web-pivot-06a-holdout.json` in
`525963d`, which is before the first line of doorway or topology code, so the
ordering is a fact about the history and not a claim in prose.

## 3. What Stage 06's failure was actually made of

§13 asks for the decomposition before any tuning, and `6def25d` is that
decomposition and no behaviour change at all. Of A's major gold walls:

| | ground | attic |
| --- | ---: | ---: |
| gold major wall length | 22.73 m | 30.84 m |
| of which the gold itself says is a doorway | 4.43 m | 4.86 m |
| candidate material | 15.95 m = **70.2%** of the length | 23.17 m = **75.1%** |
| the same, against the gold's *material* | **84.9%** | **88.3%** |
| of the gold's doorway span, reported as an opening | 3.22 m | 2.34 m |
| gold length no candidate wall reached at all | 3.37 m | 4.92 m |
| gold walls missing outright | 1 | 0 |

So the 70.2% was two different failures added together, and the larger one was
not a failure of the extraction at all: about four fifths of the shortfall was
doorway being counted as missing material by an evaluator that could not tell a
hole in the fabric from a hole in the wall. The rest was genuinely unfound wall,
and it was concentrated where a doorway leaves stubs too short to claim —
`gw_pantry_west` is 1.13 m of which 0.80 m is its door, and Stage 06 found
none of it.

## 4. The DoorObservation

`src/core/extract/door-symbols.ts`. Evidence *about* an opening, never the
opening itself.

```
DoorObservation {
  id, assetId
  hingePx: { x, y }
  axis: 'X' | 'Y'                 the axis the host wall runs along
  fromPx, toPx, widthPx, widthM   the opening, measured between the two jambs
  swingRadiusM                    what the swing itself implies; evidence, not the opening
  atPx, thicknessPx               the host wall's line and thickness, read at the jambs
  swingSide: -1 | 1               which side of the wall the leaf is drawn on
  arc: ArcEvidence | null         centre, radius, from/to/span in degrees,
                                  residual px, coverage, confidence
  leaf: LeafEvidence | null       hinge, tip, length, direction, coverage, confidence
  jambM: { before, after }        material found beyond each end of the opening
  classification                  SINGLE_HINGED | DOUBLE_HINGED | WEAK_ARC |
                                  LEAF_ONLY | ARC_ONLY
  confidence
  evidence: string[]              every cue found, and every cue looked for and not found
}
```

Alongside it the detector returns every arc it fitted, every leaf it found, and
every hypothesis it rejected with the reason — which is what §19's first three
diagnostics are drawn from.

No remote model of any kind, at runtime or otherwise.

## 5. The arc detector

The drawing is first separated into **fabric** and **line work**. Ink that
survives an opening by one pixel is a band at least three across, which on any
sheet is a wall; what is left is what the publisher drew. A wall's own edge
answers a top-hat strongly and is removed with the fabric, which is what stops
every wall face becoming a candidate arc. That separation does the work
everywhere below: a swing is *drawn* and never built, so ink thick enough to be
fabric can never stand in for an arc nobody drew.

Arcs are then proposed two ways and verified one way.

**From the line work.** Each connected piece the size of a door symbol has a
centre searched for over its *own bounding box* — a few thousand candidates,
not a sheet-wide accumulator. For each centre the piece's points are binned by
distance, in a window that is a fraction of *that* radius rather than of the
widest door admitted: taking it from the maximum lets a straight stroke sixty
pixels long look like a circle of every radius at once, which is the false
positive §5 warns about.

**From the wall.** Every interruption in a line of fabric is found a pixel at a
time, and the swing is then *swept* from the closed position — along the wall,
towards the far jamb — into each side in turn, measuring how much of it is
inked and how far the ink sits off the circle.

Either way what comes back carries a centre, a radius, both ends and a span in
degrees, an RMS residual in pixels, an inked-coverage fraction and a
confidence, and either way it then has to survive §7's geometry. There is no
vote threshold anywhere: §6's objection to a Hough cut is that it is chosen on
one drawing, so nothing here is accepted for having many votes.

The radius range is stated in metres — 0.5 to 1.6 m — and converted by the
scale the dimension chains established. Without a scale nothing is claimed at
all, because a radius that cannot be tested as a door width is not evidence of
a door.

## 6. The leaf detector

A leaf is a straight stroke from the hinge, as long as the opening is wide,
drawn away from the wall. It is looked for along the end of the swing furthest
from the closed position, which is where a door drawn part-open puts it, and
its coverage is measured in *line work* only: fabric is not a leaf, which is
what makes §18's "doorway filled in with wall" fail here rather than later.

Where no arc survives, a piece of line work that fits a straight line, is a
door's length, and lies well away from its wall's own direction is offered as a
leaf on its own — §5's door whose arc the publisher drew faintly or not at all.
It is weaker, says so, and reads as `LEAF_ONLY` at a lower confidence.

## 7. The gap classifier

`src/core/extract/room-topology.ts`. Four classes, read in one direction only:
everything is `UNKNOWN_GAP` until evidence moves it, and nothing moves it back.

| class | what moved it there |
| --- | --- |
| `DOOR` | a door symbol is hung in this stretch of this wall |
| `EXTERIOR_OPENING` | the space around the building is on one side of it |
| `OPEN_PASSAGE` | more than any door's width of wall is missing between two interior spaces, and nothing is drawn in it |
| `UNKNOWN_GAP` | material stops and starts again, and nothing says why |

A door-width hole with no symbol in it stays `UNKNOWN_GAP`. It may be a door
this pipeline could not read, and saying so is more useful than guessing. Every
opening carries the reason it was classified as it was.

## 8. Logical host-wall continuity

A door is put on a host wall, and where there is no host wall the door makes
one. Three outcomes, and which one happens says something about the drawing:

- **MATCHED** — a wall already spans the doorway, and the stretch becomes an
  opening on it.
- **MERGED** — two runs stop either side of the doorway. Because a door is
  drawn between them, and they are collinear, of a compatible thickness, and
  terminate at the same opening, they are one wall with an opening in it. That
  is §9's test written out.
- **MADE** — nothing reaches the doorway, because the pieces either side were
  too short to be claimed. The door says the wall is there, the jambs say where
  its material is, and the host is built from those two facts and nothing else.

Separately, a wall's line does not stop where its material stops: it carries on
to the wall it runs into, and what lies between is an opening. The search steps
over the junction blob first — the band detector's own reason for stopping —
and refuses a band thicker than it is long, because that is a piece of wall
seen along the wrong axis and carrying its line would draw a boundary through
the middle of a room. Without this the garage drains into the street through
its own 2.9 m door.

On A's ground plan: 9 doors matched, 8 made, none unplaced, and 53 wall lines
carried. On the attic: 4 matched, 6 made, 1 unplaced, 75 carried.

## 9. Fabric and host, kept apart

Three fields, and the distinction is the whole design.

- **`solid`** is material. A doorway is never in it. The test is a property
  rather than a number: every pixel of every solid piece the model reports is
  asserted to be fabric in the raster (`tests/room-topology.test.ts`).
- **`openings`** are the stretches with no material, each with its class.
- The wall's **extent** spans both, and the *logical* length §14 measures is
  the material plus the openings the wall accounts for — never an opening it
  cannot explain, so a gap bridged on no evidence can raise nothing.

None of the topology work adds a millimetre of fabric anywhere. The
counterpart measurement is in §12 below: not one source-open passage on either
of A's floors is closed by candidate material.

## 10. The room barrier graph

§10 asks for the boundary model to be explicit, and it is:

| piece | is it material? |
| --- | --- |
| `FABRIC` | yes — the drawing has material here |
| `DOOR` | no — a door is drawn here, it stops one room becoming the next |
| `EXTERIOR_OPENING` | no — the outside is on one side, a room does not continue through it |
| `UNKNOWN_GAP` | no — nothing says what is here; keeping the rooms apart asserts least |

An `OPEN_PASSAGE` gets no separator at all, which is how the spaces either side
of it come back as one region. A carried stretch may keep the outside out and
may not cut a room in two on nothing more than the fact that a wall stopped
there. And the whole line is walked, so the reveal a publisher draws inside a
doorway is still boundary — one unpainted pixel is a room draining into the
garden.

Two other things follow from getting this right. Rooms are flooded against
*material* rather than ink, because a stair tread, a worktop, a car and a
dimension line are all ink and none of them stops a room: flooding against ink
returns A's attic staircase as slivers of a tenth of a square metre each. And
an adjacency that rests only on an unexplained gap is marked `unresolved` with
the reason, so §10's "no confident topology decision without evidence" is a
field and not an intention.

## 11. Open-plan semantics

§11 forbids splitting an intentional open plan into fake rooms, and nothing
here does. An `OPEN_PASSAGE` joins; no wall is ever invented to divide a
region; and where the source's own labels say one region holds several named
spaces, the region stands and the question is recorded.

On A's ground floor that is the salon, the kitchen and the hall, which the gold
itself joins with notional edges rather than with doors. The candidate returns
them as one region, marks it `segmentation: 'UNRESOLVED'`, and carries an
`OPEN_PLAN_SEGMENTATION_UNRESOLVED` conflict naming what was seen and what
cannot be decided:

> whether these are one open space the source gives several names, or spaces
> divided by something this reading did not find. Nothing in the drawing
> separates them, and a wall put here to make the count come out would be a
> wall no source shows (§11). The region stands and the question does not.

Three such conflicts on A, one on B, two on F.

## 12. Room labels as evidence

`src/core/extract/room-labels.ts`. A publisher issues each floor twice: chains
on one copy, room names and areas on the other. The second copy knows how many
spaces the source thinks there are, and that is the only thing asked of it.

The two copies are aligned by sliding one's **material** over the other's —
the part they share — and the shift is reported with how much of it agreed;
an alignment that explains too little is refused and there is then no label
evidence rather than label evidence in the wrong place. On A both storeys align
at a shift of 0, 0 px with 100% agreement.

The labels are then found by **difference**: the labelled copy's ink that the
dimensioned copy has nothing at. Asking instead for "ink that is not the
building" returns every worktop and every sanitary fitting, which cluster into
one enormous block that means nothing. Eight labels come out of A's ground plan
and nine out of its attic, each inside the space it names; fifteen out of B.

Nothing is read. A name would need an alphabet this pipeline does not have, and
the question does not need one. And nothing is moved: §12's limit is that a
label may not redefine a wall, and the only thing a label does here is raise
the question in §11.

## 13. A — wall target

Measured by `npm run extract:evaluate -- A`, Tesseract 5.3.4, at the frozen
commit.

| | ground | attic |
| --- | ---: | ---: |
| gold major wall length | 22.73 m | 30.84 m |
| of which the gold says is a doorway | 4.43 m | 4.86 m |
| candidate material | 16.86 m | 25.32 m |
| the same, against the gold's material | 89.5% | 96.0% |
| **logical host wall (§14's number)** | **21.04 m = 92.5%** | **30.57 m = 99.1%** |
| of the gold's doorway span, reported open | 3.94 m | 4.56 m |
| gold length no candidate wall reaches | 1.69 m | 0.27 m |
| gold walls missing outright | 0 | 0 |
| gold walls carried in pieces but carried | 2 | 6 |
| source-open passages closed by candidate material | **0** | **0** |
| gold openings with some material across them, at the jambs | 4, 0.49 m | 2, 0.61 m |

Stage 06 was 70.2% and 75.1% on the fabric figure and had no logical figure at
all. The fabric figure is now 74.2% and 82.1%; the rest of the gold's length
is doorway, and it is reported as doorway.

## 14. A — room and adjacency target

| | ground | attic |
| --- | ---: | ---: |
| gold rooms | 9 | 9 |
| covered by a candidate region | **9** | **9** |
| candidate regions | 7 | 9 |
| regions covering more than one gold room | 1 | 2 |
| of those, marked `UNRESOLVED` by the candidate | 1 | 2 |
| positive room overlap | 0 (structural) | 0 (structural) |
| gold adjacency edges | 10 | 8 |
| **agreed** | **9 = 90.0%** | **8 = 100.0%** |
| of which, edges the gold carries a door on | 6/6 | 6/6 |
| of which, edges the gold marks as one open space | 3/4 | 2/2 |
| missing | 1 | 0 |

The one missing ground edge is `g_hall | g_stair_void`, and it cannot be
agreed by anything: `g_stair_void` is named in the gold's notional edges and is
not one of the gold's rooms, so no region can stand for it. 9 of 10 is the
ceiling on that floor.

**On how the two kinds of gold edge are counted.** An edge the gold carries a
*door* on says the two rooms are separate spaces joined by a door; merging them
is a failure and is counted as one. An edge the gold marks `notional` says the
opposite — these two labelled spaces run into each other with nothing between
them — and a candidate that returns them as one region has got that connection
right. §11 is explicit that inventing a wall to split them would be wrong, so
such an edge agrees either way, and what is lost is counted separately as a
merge and is required to be marked unresolved. Five of A's seventeen gold
edges are satisfied that way and the table says which. Stage 06's own count is
also still printed, so nothing is hidden behind the change.

## 15. A — direct-door target

| | ground | attic |
| --- | ---: | ---: |
| gold doors | 6 | 6 |
| found at all | 6 | 6 |
| **read as `DOOR`, not as a generic gap** | **6 = 100%** | **6 = 100%** |
| **on the host wall the gold names** | **6 = 100%** | **6 = 100%** |
| width within four pixels of this drawing (0.105 m) | 6/6 | **4/6** |
| width within five pixels (0.131 m) | 6/6 | 6/6 |

Stage 06's figure was "4 detected, 2 explicitly unresolved" on the ground floor
and "3 detected, 3 unresolved" on the attic, under a target that accepted
either. Every one of the twelve is now read as a door, on the wall the gold
says hosts it.

The two attic widths that miss are `ud_pralnia` (gold 0.76 m, read 0.87 m) and
`ud_bathroom` (gold 0.75 m, read 0.87 m): 4.2 and 4.6 pixels of this drawing.
Both are the same thing — the publisher draws the wall's two faces across the
reveal as hairlines, so the material stops a pixel or two before the doorway
the gold transcribed by eye does. Reporting one tolerance would have meant
choosing which made the row read better, so both are reported.

## 16. Project B

The frozen extractor, run on B — *Dom w bakopach (G2E)*, a single-storey house
with a double garage, deliberately unlike A, with no hand gold.

| | Stage 06 | 06A |
| --- | ---: | ---: |
| scale | 0.30453 px/cm | **0.30453 px/cm** |
| wall runs | 95 | 103 |
| fabric | 114.8 m | 130.0 m |
| openings | 30 | 138 |
| rooms | 13 | **17** |
| adjacencies | 19 | **39** |
| dimensions owned | 22 | 22 |
| readings with no owner | 13 | 13 |

Within the 06A run itself, before any door was placed: 13 rooms, 25
adjacencies, 95 wall runs; after: 17, 39 and 103. So the door evidence is what
divided four more spaces and found fourteen more adjacencies, and the same code
without it reproduces Stage 06's room and wall-run counts exactly.

What it read: 238 interruptions in a wall line, 51 with a door drawn in them,
654 arcs fitted, 104 readings hung in a wall and resolved to **24 doors** — 12
on a wall already found, 2 joining two collinear walls, 10 making their own
host. Openings: 24 door, 29 open passage, 26 onto the outside, 59 unexplained.
Fifteen room labels, one region carrying more than one, recorded unresolved.
Twelve of the 39 adjacencies run through a doorway and three are left
unresolved.

The scale is unchanged to every digit, and so are the owned and unowned
dimension counts: the dimension stage was not touched.

**Nothing was tuned against B.** It was run after the A work was done, its
figures are reported as they came out, and no threshold was moved afterwards.

## 17. Holdout F, run once, under the freeze

| | |
| --- | --- |
| project | F — *Dom w malinówkach 58 (E)* |
| frozen at | `d94db119a840bf02164c05b1eee21d453b9bb694` |
| config hash | `f451ba9a7f6a0c8636fec41f775c5003947e2ca896b3b66a289938aadecb7fe9` |
| engine | Tesseract 5.3.4 |
| SourcePackage | `pkg_e75b59f95fe1f161` |
| ran at | 2026-09-15T19:58:42Z, 7.9 s |
| runs | one; the result file is now the record that F is spent |

| | ground | attic |
| --- | ---: | ---: |
| scale | 0.53462 px/cm | 0.53462 px/cm |
| walls | 40 runs, 51.4 m of fabric | 24 runs, 54.1 m |
| openings | 48 | 32 |
| of which door | 9 | 8 |
| open passage | 8 | 9 |
| onto the outside | 24 | 10 |
| unexplained | 7 | 5 |
| door symbols read | 9 | 8 |
| rooms | 6 | 7 |
| adjacencies | 13, 6 through a doorway | 16, 6 through a doorway |
| regions carrying more than one room label | 1 | 1 |
| dimensions owned | 10 | 11 |
| readings with no owner | 11 | 11 |
| conflicts | 2 × `OPEN_PLAN_SEGMENTATION_UNRESOLVED` | |

The command refused to start until the freeze existed and both the commit and
the configuration hash still matched it. It also refuses to run twice.

**What can honestly be said.** The pipeline read a project it had never seen,
end to end, in eight seconds. It established a scale, read seventeen door
symbols across the two storeys, classified every opening, produced rooms and
adjacencies on both floors with more than a third of the adjacencies running
through a doorway it found, and recorded two segmentation questions rather than
forcing them. Nothing crashed, nothing came back empty, and no geometry was
claimed without a scale.

One thing the run itself reports and that is worth repeating rather than
smoothing over: the two storeys **disagreed about their scale**, the ground
plan reading 16% more labels at its own than at the set's, and the
disagreement is in the notes rather than averaged away.

**What cannot.** There is no gold for F and there will not be one, so its
accuracy is not measured — only its behaviour. No sheet was rendered for it:
rendering one would mean a second pass over the holdout, and §17 allows one.

The result is **non-catastrophic generalization**. It is not evidence of
accuracy.

## 18. Mutations

Twelve cases in `tests/topology-mutations.test.ts`, each on a drawing built
pixel by pixel, each required to move the right oracle and leave the others
alone — a mutation every metric notices is not evidence that any of them
measures what it claims to.

| # | injected | the oracle that has to notice | result |
| --- | --- | --- | --- |
| 1 | the swing arc removed, the leaf kept | the door is still read, its arc is `null`, it says so, and its confidence drops | pass |
| 2 | the leaf removed, the arc kept | the door is still read, its leaf is `null`, it says so, and its confidence drops | pass |
| 3 | a furniture arc of a door's radius in open space | no door there, and the doors that are there are unchanged | pass |
| 4 | one wall piece beside a real door broken away | the door still makes a host, with less material in it | pass |
| 5 | the gap widened past any door width | no door read there | pass |
| 6 | the wall thickened on one side of the doorway only | the two sides are not one wall, so no door is hung in it | pass |
| 7 | the door turned into an open passage | the two spaces become one, and the barrier has nothing across it | pass |
| 8 | the separator removed while the opening stays | the rooms merge and the room count says so | pass |
| 9 | the doorway filled in with wall fabric | no door read, and no room divided by one | pass |
| 10 | a room label moved across the doorway | the unresolved question moves with it, and disappears when the labels are one each | pass |
| 11 | the whole plan mirrored | the same building the other way round, to the door's width and the side it swings | pass |
| 12 | the gold fixture altered and nothing else | the evaluation moves; the reading is byte-identical | pass |

## 19. Leakage

§15 is the load-bearing claim of the stage, so the guards are structural.

| guard | what it asserts |
| --- | --- |
| coverage | the sweep covers ≥ 8 real files and names `door-symbols`, `room-topology` and `room-labels`, so a rename that moved one out of it fails rather than quietly stopping the check |
| imports | no file under `src/core/extract/**`, `src/node/ocr/**` or `src/node/extract-runner.ts` imports anything under `research/` or `tests/` |
| identifiers | none of them mentions `research/gold`, `research/eval` or any gold id |
| projects | none of them mentions any development project by name, id or slug — including `malinowkach` and `m87928f6e82dd1`, added for F |
| signatures | the three 06A modules mention no gold type, no gold identifier and no evaluation option: there is nowhere in any of them for an answer to be passed in |
| output | a built candidate contains no gold identifier and no project name |

Changing a value in the gold cannot alter the candidate, and mutation 12 is the
behavioural half of the same statement: the gold moved, the score moved, the
reading did not change by a byte.

## 20. Diagnostics

`npx tsx scripts/topology-diagnostic.ts A [GROUND|UPPER_ATTIC]` writes five
sheets per storey under `out/extract/<slug>/` and prints three listings.

| § | asked for | where |
| --- | --- | --- |
| 1 | detected arcs | `doors-*.png`, every fitted arc in pale green |
| 2 | door leaves | `doors-*.png`, in pale blue |
| 3 | doorway candidates and confidence | printed per door, with its outcome |
| 4 | gap classes | `barrier-*.png`, coloured by class; counts printed |
| 5 | logical host-wall continuity | the wall listing: extent, material, openings |
| 6 | physical fabric intervals | the same listing |
| 7 | pre-refinement room flood | `flood-*.png` — the regions before any door |
| 8 | post-refinement topology | `rooms-*.png` |
| 9 | adjacency graph | printed, with what is unresolved and why |
| 10 | automatic vs gold doors | `npm run extract:evaluate -- A` |
| 11 | automatic vs gold room topology | the same |
| 12 | wall-coverage decomposition | the same, §13 block |

Plus `labels-*.png`, the room labels the area-labelled copy prints, placed by
the shift the two copies were aligned at.

Two development-only tools sit beside them: `scripts/_pngcrop.ts`, which cuts a
magnified crop out of any of the sheets, and `scripts/_cache-engine.ts`, which
puts a cache in front of the OCR engine keyed by the exact bytes of each crop.
The cache exists because Tesseract dominates the wall clock of every run and
this stage changes nothing an engine sees, so an iteration is seconds rather
than minutes. **No figure in this report came from it**: every number above was
produced by a run through the real engine, and the freeze and the holdout have
no path to it at all.

For B, the same command writes the same sheets and the before/after figures
§16 reports. For F, the one-shot command printed the figures in §17 and no
sheet was rendered.

## 21. Timing

Per plan, at the frozen commit, on this machine.

| stage | A ground | A attic | B |
| --- | ---: | ---: | ---: |
| wall bands | 43 ms | 32 ms | 62 ms |
| door symbols | 1523 ms | 941 ms | 1491 ms |
| room labels | 664 ms | 602 ms | 633 ms |
| topology and rooms | 460 ms | 357 ms | 406 ms |
| **06A total** | **2.7 s** | **1.9 s** | **2.6 s** |

The whole holdout run, both storeys including OCR, was 7.9 s. Stage 06's own
figure for A was about 70 s and for B several minutes, almost all of it
Tesseract on enlarged crops; that has not changed and is not what this stage
touched. What 06A adds is a few seconds per plan.

The door search is bounded by construction: a centre is looked for inside one
symbol's own bounding box, and a swing is swept from one known starting angle.
There is no sheet-wide accumulator and no global search.

## 22. Gates

Every gate below was run at the frozen commit. None is claimed unrun.

| gate | command | result |
| --- | --- | --- |
| tests | `npx vitest run` | **28 files, 608 tests, all pass** (499 s) |
| typecheck | `npm run typecheck` | clean |
| build | `npm run build` | clean |
| standalone build | `npm run standalone:build` | built |
| browser | `npm run standalone:verify` | **11/11 checks pass**, one pre-existing console 404 |
| production benchmark | `npm run bench` | unchanged, below |

06A adds 49 tests across three files: `tests/door-symbols.test.ts` (15),
`tests/room-topology.test.ts` (21), `tests/topology-mutations.test.ts` (13).
The A regression test now asserts §14's targets themselves, so a regression on
the logical wall length, the doors read as doors, the adjacency, the gold-room
coverage or the merged-room allowance fails the suite.

Production scores, same command as before the stage:

| project | before | now |
| --- | ---: | ---: |
| A | 0.2176 | **0.2176** |
| B | 0.2118 | **0.2118** |
| C | 0.1957 | **0.1957** |
| D | 0.1576 | **0.1576** |
| E | — (was the holdout) | 0.1992 |

Unchanged to every reported digit. E appears for the first time because it is a
regression project now rather than the holdout, exactly as D did in Stage 06.

## 23. Production isolation

Nothing in the current URL→model production path was changed.

- `src/core/pipeline/**`, the camera fitting, the repair loop, the scoring
  weights, the roof and facade compilers are untouched; no threshold, weight or
  tolerance in them was moved.
- The 06A code is reachable only from the research commands
  (`extract:spec`, `extract:sheet`, `extract:evaluate`, `extract:freeze`,
  `extract:holdout`, `topology-diagnostic`). `npm run analyze`, `npm run bench`
  and the browser build do not import it.
- The one change with an effect outside 06A is that E, now a regression project
  rather than the holdout, is included in `npm run bench`.
- Nothing converts a candidate into a `BuildingSpec`. It is still a candidate.

## 24. Limitations

1. **The attic's two narrow doors read 0.11-0.12 m wide.** The publisher draws
   the reveal as hairlines and the material stops before the opening does;
   trimming to the clear span was tried and is worse elsewhere, so it is
   reported rather than tuned around (§15 above).
2. **The detector reads more openings than the gold models.** On A's ground
   plan seventeen doors are read where the gold names six — the front door, the
   garage side door and stretches of the stair enclosure among them. Most are
   real openings the gold does not model, but the precision of the door set as
   a whole is not measured, because there is no gold for the ones outside it.
3. **`g_stair_void` caps the ground floor at 90.0%.** The gold names it in a
   notional edge and does not give it a room, so nothing can stand for it.
4. **Stairs are still not extracted** as stairs. Flooding against material
   rather than ink stops them being chopped into slivers, which is what the
   room topology needed, but no tread, direction or rise is read.
5. **The open-plan question is raised, never answered.** Three regions on A
   carry more than one of the source's labels and all three are recorded
   unresolved. Nothing in this stage attempts semantic subregions.
6. **Label evidence needs a second published copy.** Where a project publishes
   only one variant of a floor there is no label evidence at all, and the
   unresolved-segmentation question cannot be raised.
7. **One engine.** The seam supports several; only Tesseract is wired.
8. **Performance is still dominated by OCR**, which this stage did not touch.

## 25. The one recommended next bounded step

**Measure the doors the gold does not model, by transcribing A's remaining
openings and nothing else.**

Limitation 2 is the one thing in this report that is genuinely unmeasured: the
door detector is at 100% recall and 100% host accuracy on the twelve doors the
gold names, and its behaviour on the other eleven readings it makes on the same
two plans is described only as "most of them are real". That is the gap a
reader should not have to take on trust, and it is the gap that decides whether
the door set can be used for anything beyond room topology.

The bounded step is to extend `research/gold/marcowki-interior-v1.json` with
every remaining opening on A's two plans — exterior doors, the garage door, the
stair enclosure — transcribed by hand the way the existing openings were, and
to report precision alongside the recall already reported. It touches no
extraction code, it cannot move any threshold, and it turns the one soft
sentence in §24 into a number.

---

## Result

Every §14 target is met on both of A's floors except one row, and the exception
is named rather than absorbed.

| §14 requirement | ground | attic |
| --- | --- | --- |
| ≥ 90% of gold major logical wall length matched | 92.5% ✓ | 99.1% ✓ |
| physical doors and passages remain gaps | 3.94 of 4.43 m reported open ✓ | 4.56 of 4.86 m ✓ |
| zero invented wall fabric closing a source-open passage | 0 closed ✓ | 0 closed ✓ |
| zero positive room overlap | 0, structural ✓ | 0, structural ✓ |
| ≥ 90% gold room-adjacency edge agreement | 90.0% ✓ | 100.0% ✓ |
| at most one merged room, or explicitly unresolved | 1, marked unresolved ✓ | 2, both marked unresolved ✓ |
| ≥ 90% of major doors read as `DOOR` | 100% ✓ | 100% ✓ |
| ≥ 90% on the host wall the gold names | 100% ✓ | 100% ✓ |
| width within the source tolerance where readable | 6/6 ✓ | **4/6 at four pixels, 6/6 at five** |

The two wall and adjacency targets Stage 06 failed are met, and they are met by
reading the door rather than by filling the opening: not one source-open
passage on either floor is closed by candidate material, the fabric figure
rose only from 84.9% to 89.5% of the gold's material on the ground floor, and
the whole of the rest of the gain is doorway now reported as doorway. The door
target is met outright — twelve of twelve read as doors, on the right walls —
where Stage 06 met only the weaker "detected or unresolved" version of it.

The one row that is not met is the attic's door widths at a four-pixel
tolerance, where two of six miss by 4.2 and 4.6 pixels of the drawing and all
six are within five. That is a measurement at the resolution limit of the
source, not a topology failure, and moving the tolerance to make the row read
better is exactly what §13 forbids.

`PARTIAL_STAGE_WEB_PIVOT_06A_DOORWAY_ROOM_TOPOLOGY`
