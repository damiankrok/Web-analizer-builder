# STAGE WEB-PIVOT-07R — Automatic frame registration and coherent 3D scene recovery

**Result:** `PASS_STAGE_WEB_PIVOT_07R_COHERENT_AUTOMATIC_SCENE`

**Preview:** https://claude.ai/artifact/GKpqJCMY5JyukCVxNKNikT

---

## 1. Starting HEAD

| | |
| --- | --- |
| branch | `claude/new-session-pvd4ik` |
| HEAD at the start | `a95e198e04fed40e80f8bf47a66f169c3c1e1bbb` |
| underlying automatic candidate | `d53b289ec864e03d26155c29e1ec110030976b4a` |
| working tree at the start | clean, no unknown changes |
| HEAD at the end of the stage | `acbd968`, this report's own commit |

The baseline check in §0 of the brief passed: the branch, the commit and the
clean tree were all as expected, so nothing was stashed, reset or cleaned.

## 2. What the screenshots showed

Six symptoms were declared, and all six were real.

| symptom | what it actually was |
| --- | --- |
| a large Z offset on the ground plan | the ground sheet's frame was anchored on the rear terrace's screen wall, 4.796 m north of the house |
| the two storeys did not read as one building | each storey was placed at *its own sheet's* north-west corner, and those corners are 4.8 m apart |
| the roof stayed in a section-local frame | nothing registered the section's horizontal coordinate against a plan axis, so the roof was drawn in the section's own X and labelled `FRAME_UNREGISTERED` |
| the roof floated and overshot | a roof plane was drawn as an unbounded sheet across the *union* Z extent of everything on the ground sheet — 19.66 m, terrace included |
| wall fragments rendered as pillars | 68 of the ground and attic sheets' 129 wall runs are not this building's fabric: terrace screens, entrance steps, a site outline, stair treads and hatch strokes, all extruded to full storey height |
| the overlay showed a global frame disagreement | it did, and it was the same 4.8 m |

## 3. Candidate against adapter — where the fault was

**In the candidate:** the frame. `spec-candidate.ts`'s `frameOf` takes each
storey's origin to be the smallest near-face among its wall runs. That is a
reasonable rule for a sheet that carries only a building, and project A's
ground sheet carries a terrace with a screen wall 4.8 m north of the house. It
is not a measurement error — every wall, room, door and dimension in the
candidate was read correctly — it is that nothing decided *what on the sheet is
the building* before deciding where its corner is.

**In neither:** the section frame. Stage 07 registers the section vertically
against the level markers and never horizontally, and says so
(`horizontalMethod: UNRESOLVED`). The adapter drew the roof in the section's
own X because there was nothing else to draw it in.

**In the adapter:** the unbounded roof and the pillars. Given an unregistered
plane and a per-sheet extent, it did the only honest thing available and drew
what it had. Both stop being adapter problems once the frames are registered.

Nothing in Stage 06's OCR, dimension chains, metric scale, wall bands, room
topology, door topology, section datum solver, roof pitch, roof topology or
Stage 07's evidence and conflict model was changed. This stage is a layer over
the frozen candidate:

`EXISTING CANDIDATE EVIDENCE` → `FRAME REGISTRATION` → `COHERENT
BUILDING-LOCAL CANDIDATE` → `READ-ONLY 3D SCENE`.

## 4. The ground frame

`src/core/extract/plan-masses.ts` decides what on a plan sheet is the building,
and it asks three questions in order, each answered by the drawing.

**Is this a band at all?** A wall is fabric with two faces. Where the two faces
found are within the detector's own face tolerance of each other
(`DEFAULT_PLAN_MODEL.faceTolerancePx`, 2.5 px, already the width below which
this pipeline treats two faces as one line) what was found is a *line*: a
tread, a hatch stroke, a tiling pattern. It has no thickness to be a wall with.
On project A that is 40 runs at 2 px; the thinnest thing that survives is
115 mm.

**Does it touch the inside?** The candidate publishes where the enclosed space
is, as each room's own occupancy raster. A stretch of material with no enclosed
space within one occupancy cell of either face is not this building's fabric.
Asked per stretch rather than per run, because the band merger joins collinear
pieces across gaps and the terrace screen arrives merged with the house wall.

**Which faces bound it?** A face bounds the building when the inside is
*behind* it. What is in front decides nothing — a flood that leaked through a
balcony door puts enclosed space on both sides of a real external wall, and
that wall is still the wall.

Two rounds, because the questions depend on each other: how long a run of
material is decides whether its face is a facade, and where the faces are
decides how much of that run is the building. Clip to the loosest envelope every
face could support, measure again, take the envelope those faces settle, clip
to that.

| | |
| --- | --- |
| cause of the old offset | the ground sheet's outermost X-run is the rear terrace's screen wall at sheet Z 0.00–0.13 |
| ground origin, old | the sheet's own outermost band |
| ground origin, new | (0.000, 4.796) in the sheet's plan frame — the main body's north wall face |
| ground envelope | 11.94 × 14.16 m, against a printed 12.05 m across |
| runs kept out | 68 of 129 |
| project constant used | none. `4.82` and `4.796` appear nowhere in the code |

The correction is generic. On project B the same rules move nothing in Z and
recover a metre the flood alone had lost (§21).

## 5. Upper onto ground

All eight rigid placements are tried — four quarter-turns, each with and
without a mirror — and the one the most wall material agrees with wins. Every
pairing of a moving face with a fixed one proposes an offset; the offset the
most material votes for is taken, weighted by the length of wall behind each
face and by how much of it overlaps. The identity is preferred only to break a
tie.

| | |
| --- | --- |
| placement | 0° turn, not mirrored |
| translation | (0.014, 0.019) m |
| faces agreeing | 40 |
| residual | 73 mm rms |
| next best of the eight | 84% of the winning score |

Each axis is fitted twice. A face's line is measured on one axis and its extent
runs along the other, so the overlap term cannot be judged until the other axis
has been fitted; without the second pass a mirrored sheet scores as if none of
its walls overlapped anything, and §16's second mutation is missed. This was a
real bug, found by writing that mutation.

## 6. Section onto the building

The section is a cut, and every place its drawn fabric begins or ends is a wall
face seen edge-on. Those ends — the ends of every slab and of every fitted roof
plane's supported run — are matched against the plan's wall faces the same way
one storey is matched against another.

The offset alone cannot choose the *direction*: a house is nearly symmetric
about its own cut, and on project A both directions put nine of the ten cut
ends on a wall face. What chooses is a fact about buildings — a roof does not
pass through the storey standing under it. The garage's flat roof at 2.891 m
belongs over the part of the plan with nothing above it; putting it over the
two-storey part buries it 1.779 m inside the first floor.

| | |
| --- | --- |
| axis | X, forwards |
| shift | −1.848 m |
| ends landing on a wall face | 9 |
| residual | 59 mm rms |
| roof left below its storey | 169 mm, against 1779 mm for the mirror |

## 7. Roof footprint and support

Each component's registered span picks the mass it lands on; the mass then
supplies the extent along the ridge, because a roof covers what it sits on.
Across the cut, the eave is snapped onto the mass face only where the section's
supported end and the wall are within a registration residual of each other —
on A, 55 mm and 99 mm. Where they are metres apart the section is cutting a
roof that does not cover the whole mass, and stretching it would invent roof and
flatten its pitch (§21 found exactly that on B).

The ridge is where the section's own pitch puts it: each plane reaches the ridge
a run from its own eave, and the run is the rise over the tangent of the fitted
pitch. On A the two planes vote 5.715 m and 5.702 m in section coordinates, a
mean of 3.859 m in the building — 64 mm from the middle of the mass, which was
never assumed.

| | |
| --- | --- |
| `roof0` GABLE | host `mass0`, 7.82 × 12.49 m, ridge on Z at 3.86 m, eave 4.738 m, ridge 7.950 m |
| implied pitches | 39.87° and 38.94° against the stated 40.00° |
| `roof1` FLAT | host `mass1`, 4.10 × 9.09 m, level at 2.891 m |
| overhang | null on both — the section shows where the plane stops, not where the wall is |

No plane extends past the mass it bears on, and the check that says so is
measured against a 262 mm tolerance rather than asserted.

## 8. Wall host assembly

Stage-06A's semantics are kept: a logical host, its physical fabric intervals,
its openings. Sixty-one runs survive on project A — 24 envelope, 33 partition,
4 internal fabric — each compiled as one solid per fabric interval, with the
openings cut out rather than bridged. Ninety-five openings, none bridged, which
an oracle checks.

Where an elevation measured a head and a sill for an opening the candidate
matched to a plan gap, the wall keeps its lintel and its spandrel. Where
nothing states a head, the gap runs the full storey height, because that is
what a floor plan alone says. Eight of the 29 facade openings carry that
evidence.

## 9. Storey assembly

| storey / mass | from | to | settled |
| --- | ---: | ---: | --- |
| GROUND on `mass0` | 0.000 | 3.060 | yes — the floor above |
| GROUND on `mass1` (garage) | 0.000 | 2.891 | yes — the flat roof the section measured bears there |
| UPPER_ATTIC on `mass0` | 3.060 | 4.670 | **no** — no source states a knee-wall top, so it is drawn to the eave and marked unresolved |

A mass whose roof bears below its storey's nominal top stops there: the garage
is a storey by the level table and a 2.891 m box by its own roof, and the roof
is the thing that was measured.

The stair void is **not** cut. A flight of stairs and a tiled floor are drawn
the same way — a run of parallel lines a going apart — and project A's attic
sheet carries four such runs of which one is the stair. A void is declared only
where two storeys draw a flight in the same place; they do not, so none is, and
it is listed in `unresolved`. Inventing a hole where a bathroom is would be
worse than leaving the slab whole.

## 10. Terrace, balcony, wing and artifact

| kept out of the building | count on A |
| --- | ---: |
| `LINE_ONLY` — two faces within the face tolerance (treads, hatch, tiling) | 40 |
| `OUTSIDE_MASS` — no enclosed space within a cell of either face (terrace screens, entrance steps and porch, site outline, balcony edge) | 28 |

and what is kept:

| mass | role | footprint | storeys |
| --- | --- | --- | --- |
| `mass0` | PRIMARY | 7.82 × 12.49 m | GROUND, UPPER_ATTIC |
| `mass1` | WING | 4.10 × 9.09 m | GROUND |

A mass is a part of the plan with its own stack of storeys, which is read off
the storeys rather than off a list of what garages look like. A strip of the
base storey outside the stack becomes a wing only if a room stands in it — a
stretch of wall with nothing enclosed behind it is a corner of the drawing, and
giving it a roof is how a phantom gets one.

## 11. Scene bounds

| | automatic | source |
| --- | ---: | --- |
| width across the sheet | 11.92 m | printed chain 12.05 m |
| depth down the sheet | 14.14 m | printed chain 14.60 m |
| ridge | 7.950 m | printed `+7,95` |
| eave | 4.738 m | printed `+4,67` (the plane's low edge sits 68 mm above the marker) |
| first floor | 3.060 m | printed `+3,06` |

The printed figures are the candidate's own readings, summed per chain line:
the longest chain across the ground sheet is 12.05 m and the longest down it is
14.60 m (1260 + 100 + 100 on line `vl_547_208`). Both are on the preview.

## 12. Hard sanity oracles

Eleven, each measured against a stated tolerance and reported with it, so a
PASS can be disbelieved and a FAIL understood.

| check | A | B |
| --- | --- | --- |
| every source frame used in 3D has a resolved registration | PASS — 3 frames | PASS — 2 frames |
| every storey stands inside the one below it | PASS — −14 mm | open — B publishes one storey |
| the upper storey is centred on the footprint it shares | PASS — 0 mm | open — same |
| every roof component bears on a mass and stays inside it | PASS — 2 components | PASS — 1 |
| the ridge runs along its mass, not across it | PASS | PASS |
| each slope works out at the pitch the sources state | PASS — 1.06° at worst | PASS — 0.01° |
| the ridge falls inside the mass it covers | PASS | PASS |
| the section shows a roof over the whole of every mass | open — `mass1` 83% | open — `mass0` 55% |
| no stub of wall stands with nothing touching it | PASS — 61 walls | PASS — 29 |
| no printed dimension is longer than the building it is printed on | PASS | PASS — 21.25 against 21.25 |
| every envelope face has the building behind it | PASS — 8 faces | PASS — 4 faces |
| no material is drawn across an opening | PASS — 95 openings | PASS — 47 |
| every floor opening is clear of the fabric around it | open — none settled | open — none settled |

"Open" is `UNRESOLVED`, which is not a pass and is not a failure: it is the
sources not answering. **No check fails on either project.**

## 13. Mutations

Twelve, in `tests/frame-registration.test.ts`, against a synthetic building
whose correct answer is known exactly, so a check going red is the mutation
rather than the noise in a real drawing. None is committed.

| # | mutation | caught by |
| ---: | --- | --- |
| 1 | reintroduce a large ground-origin shift | registration absorbs it — the same masses and the same roofs come out |
| 1b | place a storey at the old offset | `storeys-stack` FAIL |
| 2 | mirror the upper floor | reported as mirrored, and it stacks |
| 3 | rotate the upper floor 90° | reported as turned |
| 4 | shift the stair void onto a wall | `voids-clear-of-fabric` FAIL |
| 5 | leave the section roof frame unregistered | SECTION `UNRESOLVED`, roof unplaced and listed, `frames-registered` and `roof-on-mass` FAIL |
| 6 | rotate the ridge onto the wrong axis | `ridge-on-axis` FAIL |
| 7 | move the roof 1 m off its supports | `roof-on-mass` FAIL |
| 8 | enlarge the roof beyond its host | `roof-on-mass` FAIL |
| 9 | classify a terrace edge as the envelope | `origin-from-structure` FAIL |
| 10 | split a wall into disconnected pillars | `no-isolated-pillars` FAIL |
| 11 | fill a doorway with material | `openings-stay-open` FAIL |
| 12 | alter the reference only | the registration modules name nothing under `research/`, and two runs agree to the byte |

## 14. Automatic-only views

`node scripts/owner-checkpoint-views.mjs` drives the page a reader actually
opens — not a second viewer written to flatter it — and writes six views of the
automatic model alone to `out/owner-checkpoint/`:

`auto-1-front-three-quarter` · `auto-2-rear-three-quarter` ·
`auto-3-ground-roof-off` · `auto-4-attic-roof-off` ·
`auto-5-side-orthographic` · `auto-6-front-orthographic`

They show one house: a 40° gable on the body with the ridge running its length,
a lower flat-roofed wing beside it, two storeys that stack, walls that enclose
rooms on both floors, and no plane hanging over the garden. The front
orthographic silhouette is a gable over the body and a lower block to its right
— which is what the front elevation draws.

## 15. Automatic against the development reference

Read once, after registration had finished, in a development script, and used
for nothing else. The reference may measure a difference; it may not supply a
transform, and it did not.

| measure | automatic | reference | Δ |
| --- | ---: | ---: | ---: |
| west face | 0.014 m | 0.000 m | +0.014 m |
| east face | 11.937 m | 12.050 m | −0.113 m |
| north face | 0.019 m | 0.000 m | +0.019 m |
| south face | 14.157 m | 12.600 m | **+1.557 m** |
| width | 11.923 m | 12.050 m | −0.127 m |
| depth | 14.138 m | 12.600 m | **+1.538 m** |
| orientation | long axis Z | long axis Z | the same way round |
| ridge level | 7.950 m | 7.950 m | 0.000 m |
| ridge position across the body | 3.859 m | 3.950 m | −0.091 m |
| first-floor level | 3.060 m | 3.060 m | 0.000 m |
| envelope wall faces | 48 | 38 reference lines | median 104 mm, worst 1.743 m |

Everything agrees to about 100 mm except the depth. The two models disagree
about where the garage wing stops: the automatic reading carries it 1.5 m past
the main body's south wall, the reference does not. Three things favour the
automatic reading — the ground plan's own chain down that sheet sums to
14.60 m and the reference's 12.60 m is the intermediate bracket on that same
chain; the garage door opening is drawn in the wall at the far end; and the two
side elevations measure 13.64 m and 16.18 m, which bracket 14.16 m and not
12.60 m. This is a finding, not something either model may quietly adopt, and
it is §20's recommended next step.

## 16. Preview

https://claude.ai/artifact/GKpqJCMY5JyukCVxNKNikT

Default mode AUTOMATIC, with GOLD and OVERLAY available; orbit, pan, pinch
zoom, roof toggle, ground and attic toggles, reset camera. The truth panel
carries the building frame and a row per source frame with its transform and
residual; the source overall dimensions beside the registered building; the
masses with what bears on each and the pitch each roof plane works out at; the
eleven checks with their tolerances; the 27 things the sources describe that
could not be placed, each with its reason; the open cross-source conflicts; and
the reference comparison above.

Rebuild it with `npm run checkpoint:build`, verify it at phone width with
`npm run checkpoint:verify`.

## 17. Gates

| gate | command | result |
| --- | --- | --- |
| registration, envelope and mutation tests | `npx vitest run tests/frame-registration.test.ts` | **22 pass** |
| checkpoint isolation | `npx vitest run tests/owner-checkpoint-isolation.test.ts` | **9 pass** |
| all Stage 01–07 regressions | `npx vitest run` | unchanged and passing |
| full suite | `npx vitest run` | **703 tests, 703 pass, 34 files** |
| typecheck | `npm run typecheck` | clean |
| build | `npm run build` | clean |
| standalone build | `npm run standalone:build` | clean |
| browser verification | `npm run standalone:verify` | **11/11** on a 393 px viewport |
| owner-checkpoint verification | `npm run checkpoint:verify` | **14/14** on a 400 px viewport |
| project B regression | `npm run shell:spec -- B` then registration | runs, no check failing (§12) |
| production benchmark | `npm run bench` | unchanged, §18 |

## 18. Production isolation

Nothing in the URL→model production path was changed. No camera solver, no
repair loop, no production score, no threshold, no Android code, no legacy
module. The registration modules live under `src/core/extract` and are imported
by nothing the analyzer runs; the checkpoint renderer is under `src/checkpoint`
and a test asserts that nothing in `src/core`, `src/node`, `src/web` or
`src/ui` imports it.

| project | Stage-07 report | now |
| --- | ---: | ---: |
| A — Dom w marcówkach (GE) | 0.2176 | **0.21756** |
| B — Dom w bakopach (G2E) | 0.2118 | **0.21175** |
| C — Dom w kosaćcach 44 | 0.1957 | **0.19570** |
| D — Dom w kruszczykach 22 | 0.1576 | **0.15758** |
| E — Dom w wisteriach 21 | 0.1992 | **0.19920** |
| F — Dom w malinówkach 58 (E) | — | 0.12899 |

## 19. Holdout policy

**No fresh holdout is spent, and H is preserved for Stage 07A.**

This stage adds a layer and changes no extraction semantics. Every number the
candidate carries — walls, faces, rooms, adjacency, doors, dimensions, levels,
slabs, roof planes, pitch, elevations, facade openings, conflicts — is
byte-identical to what the frozen Stage-06A and Stage-07 runs wrote, and
`out/shell/A-marcowki/spec-candidate.json` was not regenerated. What is new is
a pure function of that candidate. The Stage-06 and Stage-07 evaluations, the
plan gold comparison and the shell pass targets are therefore unchanged, which
is what §17's condition turns on. Project B was run as the regression and
generalisation check, and §21 below records what it found.

## 20. Remaining unresolved geometry

| | |
| --- | --- |
| knee-wall top | no source states it; every attic wall is drawn to the eave and marked unresolved |
| eave overhang | the section shows where a plane stops, not where the wall is; null on both gable planes |
| `plane2` | whether the level run is a roof or a slab the section cuts is not settled by the section alone |
| floor opening | no void is cut: the two storeys do not draw a flight in the same place |
| `mass1` roof coverage | 83% — the flat run's fit stopped 0.68 m short of the east wall |
| 21 facade openings | no plan wall was matched to them, so nothing says which wall they are in or how deep it is |
| 3 rooflights, 1 chimney, 2 railings | listed with their reasons; none is placed |

## 21. What project B found

Running the regression project through registration turned up two places where
the rule was too narrow, and both were fixed by widening the rule rather than
by tuning B.

A flight of stairs is drawn as lines, and the flood cannot fill lines. On B the
southernmost wall of the house is on the far side of an internal flight, so
asking the flood alone dropped it and lost a metre of building. A flight the
drawing shows now counts as the building being there, and the envelope-face
oracle accepts the same evidence, recomputed, so it keeps its teeth against a
terrace edge — which has neither rooms nor a flight behind it.

A face of the building is a face a facade stands on. A 0.66 m stub beyond a
flight of steps is a step, and letting it set the envelope moves the corner onto
the garden path. "Long enough" is a tenth of the longest run of material the
storey has on the same axis — the drawing's own scale, not a metre picked here.

B now measures 14.98 × 21.25 m against the 21.25 m its own plan prints.

## 22. One recommended next bounded step

**Settle where the garage wing stops, from the sources, before any facade work
continues.**

It is the one geometric disagreement left between the automatic model and the
development reference that is larger than a tolerance — 1.54 m of building
depth — and it is decidable from drawings both already have: the ground plan's
chain down the right-hand sheet line, the garage door's position in the wall on
the front elevation, and the two side elevations' silhouette widths. Whichever
way it goes, one of the two models is 1.5 m wrong about the size of the house,
and every facade measurement Stage 07A places on that wall inherits it.

Nothing else should start until it is settled. Do not begin 07A.
