# STAGE WEB-PIVOT-01C — closed storey wall ring proof

Development-only. Four walls, each stated only in its own frame, four explicitly
owned corners, two hosted openings, compiled into one globally consistent
rectangular storey ring.

No production module was modified. The shipped standalone bundle rebuilds to the
same hashes and the same byte counts as the one already published.

---

## 0. Baseline

| | |
| --- | --- |
| Branch | `claude/new-session-pvd4ik` |
| Starting HEAD | `b31edd30bf8e2c5eb40d991d294f109d0d46b8d4` |
| Final HEAD | recorded in the follow-up commit below — a commit cannot name its own hash |
| Working tree at start | clean — `git status --short` empty |

`git log --oneline --decorate -8` at the start showed `b31edd3` and `b6f0ed9`
(STAGE WEB-PIVOT-01B) ahead of `a7f8082` (STAGE WEB-PIVOT-01). Those two commits
were not produced in the session that ran this stage, but they are exactly the
predecessor the brief names, the tree was clean, and no unrelated dirty file was
present — so the baseline is the expected one, not an unsafe one. Nothing was
stashed, reset or cleaned.

## 1. Files changed

| File | Status | Role |
| --- | --- | --- |
| `src/core/wallspec/ring.ts` | new | ring topology check and `compileStoreyRing` |
| `src/core/wallspec/ring-fixtures.ts` | new | the 8 × 6 m storey, two ownership schedules, envelope planes |
| `tests/storey-ring.test.ts` | new | 52 acceptance checks |
| `tests/geometry-oracles.ts` | modified, additive only | whole-ring oracles (+144 lines, 0 deletions) |
| `scripts/storey-ring-diagnostic.ts` | new | console report and six renders |
| `docs/CLOSED_STOREY_RING_PROOF.md` | new | this report |

No file under `src/core` outside `src/core/wallspec/` was touched, and nothing
in `src/node`, `src/web`, `src/ui` or `fixtures/`. `git diff --stat` against the
starting HEAD reports one changed tracked file, purely additive, in `tests/`.

Stage 01 and Stage 01B semantics are unchanged. `WallSpec`, `OpeningSpec`,
`WallJunctionSpec` and `WallExtent` are used exactly as they were defined; no
contract was widened, and the only new types are the two ring-level diagnostics
below.

## 2. The two ownership schedules

Corners are named by the two walls that meet there. Both schedules give every
corner exactly one owner, and no wall end is claimed twice.

| Corner | Schedule A owner | Schedule B owner |
| --- | --- | --- |
| `corner_front_left` | FRONT | FRONT |
| `corner_front_right` | FRONT | **RIGHT** |
| `corner_right_rear` | REAR | REAR |
| `corner_rear_left` | REAR | **LEFT** |

- **Schedule A — the long walls run through.** FRONT and REAR keep their full
  8.0 m and own all four corners; LEFT and RIGHT are trimmed at both ends and
  fit between them. This is how a bricklayer would build it.
- **Schedule B — a pinwheel.** Every wall owns the corner at its own START and
  is trimmed at its END. No wall runs through, and no wall is trimmed twice.

Two of four corners change hands, and that is enough to change which wall is cut
back everywhere. The emitted extents differ completely:

```
A   front 0.00..8.00 | right 0.45..5.55 | rear 0.00..8.00 | left 0.45..5.55
B   front 0.00..7.55 | right 0.00..5.55 | rear 0.00..7.55 | left 0.00..5.55
```

Semantically different, physically identical — which is the claim the rest of
this report measures.

## 3. Whole-ring volume

Analytic, from the fixture's own dimensions:

```
outer prism      8 × 6 × 3                = 144.00 m³
inner void       7.10 × 5.10 × 3          = 108.63 m³
wall ring        144.00 − 108.63          =  35.37 m³
FRONT opening    2.0 × 1.5 × 0.45         =   1.35 m³
RIGHT opening    1.0 × 1.0 × 0.45         =   0.45 m³
final material   35.37 − 1.35 − 0.45      =  33.57 m³
```

Measured by the divergence theorem over the emitted triangles of each wall:

| | expected | Schedule A | Schedule B |
| --- | --- | --- | --- |
| without openings | 35.370000 m³ | **35.370000** | **35.370000** |
| with both openings | 33.570000 m³ | **33.570000** | **33.570000** |

Asserted to 9 decimal places. Every wall is separately a closed, consistently
outward-wound solid: zero boundary edges, zero duplicate edges, positive volume.

## 4. Cross-sections

Scan lines are cast across the ring and the material they meet is compared
against plan arithmetic — the outer rectangle minus the inner one, minus an
opening strip at heights where an opening is open. The compiler's own records
are not consulted.

At `y = 0.40` and `y = 2.60`, clear of both openings:

```
scan +X at z = 0.2   [0.000, 8.000]                     (rear band, solid)
scan +X at z = 3.5   [0.000, 0.450] + [7.550, 8.000]    (the two side walls)
scan +X at z = 5.8   [0.000, 8.000]                     (front band, solid)
scan +Z at x = 0.2   [0.000, 6.000]                     (left band, solid)
scan +Z at x = 7.8   [0.000, 6.000]                     (right band, solid)
```

At `y = 1.20`, through both openings:

```
scan +X at z = 5.8   [0.000, 2.000] + [4.000, 8.000]    FRONT opening open
scan +X at z = 3.5   [0.000, 0.450]                     RIGHT opening open
scan +Z at x = 7.8   [0.000, 3.000] + [4.000, 6.000]    RIGHT opening open
scan +Z at x = 3.0   [0.000, 0.450]                     FRONT opening open
```

Six positions along each axis are checked at each of the three heights, for both
schedules, to a tenth of a micrometre. The two schedules produce **identical
interval lists at every position** — the occupied union is the same set, not
merely the same volume.

Two extra sections confirm the three heights are measuring something that
varies: just above the FRONT head (`y = 2.4`) the front band is solid again, and
just above the RIGHT head (`y = 1.9`) the right band is.

## 5. All four corners, both schedules

Per corner, restricted to the two walls that actually meet there and to that
corner's own 0.45 × 0.45 m prism, so a fault names one corner rather than four:

| Corner | Schedule A overlap / gap | Schedule B overlap / gap |
| --- | --- | --- |
| `corner_front_left` | 0.000000 / 0.000000 m | 0.000000 / 0.000000 m |
| `corner_front_right` | 0.000000 / 0.000000 m | 0.000000 / 0.000000 m |
| `corner_right_rear` | 0.000000 / 0.000000 m | 0.000000 / 0.000000 m |
| `corner_rear_left` | 0.000000 / 0.000000 m | 0.000000 / 0.000000 m |

Positive common wall-material volume is zero at every corner: the two walls
touch and share no length. The ring is continuous — a scan up either side band
or across either end band is one unbroken run of material from face to face —
and the exterior corner prism is present, checked separately by probing 50 mm
inside each corner on both axes and requiring material there.

## 6. Hosted opening invariance

Emitted opening, reveal and glazing triangles projected back into their host
wall's own frame:

| | expected | measured |
| --- | --- | --- |
| FRONT | `u` 2.0 … 4.0, `up` 0.8 … 2.3 | **2.000000 … 4.000000, 0.800000 … 2.300000** |
| RIGHT | `u` 2.0 … 3.0, `up` 0.8 … 1.8 | **2.000000 … 3.000000, 0.800000 … 1.800000** |

Stable to 9 decimal places under all five conditions the brief lists: Schedule
A, Schedule B, a rigid translation, a rigid rotation of 41° about Y composed
with 23° about X plus a translation, and the ring compiled beside two 1600 m
walls 800 m away.

Glazing sits inside its opening at half the wall thickness, is tagged
separately, and is excluded from every volume figure above. Including it in a
wall's mesh opens the surface — asserted directly — which is the statement that
it is not part of the solid rather than a promise that it was left out.

## 7. Facade area

Measured by an independent face classifier: a triangle counts when its normal
matches one of the four vertical envelope planes and all three of its vertices
lie in that plane. The planes come from the fixture's 8 × 6 rectangle, never
from anything the compiler recorded.

| | expected | Schedule A | Schedule B |
| --- | --- | --- | --- |
| gross envelope (no openings) | 84.000000 m² | **84.000000** | **84.000000** |
| opaque facade | 80.000000 m² | **80.000000** | **80.000000** |

Inner faces, junction contact faces, reveals and glazing are all excluded, and
each exclusion is asserted rather than assumed.

### A rejected oracle, recorded because it was wrong in an instructive way

The first classifier written for this was a visibility test: a face is exterior
if a ray leaving it along its own normal escapes without meeting anything. It is
the obvious independent check and it is **wrong here**. An open window lets a
ray out, so the inner face of the wall opposite an opening escapes through it
and is counted as facade. Measured on this fixture it reported **99.65 m²**
against a true 80.00 — the surplus being exactly the two inner-face triangles
whose centroids happened to line up with an opening (7.65 m² of LEFT's inner
face, 12.00 m² of REAR's). Facade means *on the outer envelope*, and through a
hole that is not the same question as *visible from outside*.

The escape test is kept, under the honest name `faceEscapes`, for the one thing
it does answer correctly: whether a contact face is buried.

## 8. Clear interior

Measured by standing at the ring's centre below the sills and casting rays both
ways along each axis:

| | expected | Schedule A | Schedule B |
| --- | --- | --- | --- |
| clear width | 7.100000 m | **7.100000** | **7.100000** |
| clear depth | 5.100000 m | **5.100000** | **5.100000** |

## 9. Mutations

Each mutant is built inline in the test and discarded; none is committed as a
fixture.

| Mutation | Detected by | Result |
| --- | --- | --- |
| **1. one corner with no trim** — the junction is removed, so both walls keep the corner | corner overlap probe | overlap **0.450000 m** at that corner and **nowhere else**; volume over by **0.607500 m³** = 0.45 × 0.45 × 3; `RING_WALL_END_UNJOINED` raised before any geometry is measured. Checked for **all four corners under both schedules** — eight cases, each localised to the one corner mutated |
| **2. one corner with double trim** — the owner's extent is cut back as well | corner gap probe | gap **0.450000 m** at that corner and nowhere else; volume short by **0.607500 m³**. Checked for all four corners |
| **3. inconsistent owner relation** | diagnostics | a second junction on the same wall end gives `CONFLICTING_JUNCTION_END`; an owner that is not at the corner gives `JUNCTION_OWNER_NOT_A_MEMBER` |
| **4. `WallSpec.lengthM` shortened instead of the emitted extent** | opening-position oracle | the ring volume still lands on **33.570000 m³**, so a volume check alone sees nothing — but the RIGHT opening moves 0.45 m along the ring, from `[0, 3.0] + [4.0, 6.0]` to `[0, 2.55] + [3.55, 6.0]`. This is why the trim is a compiled extent and not a change to the wall |

Mutation 4 is the one worth keeping in view: it is the implementation a
reasonable person would reach for, it passes the headline volume check, and it
silently moves every opening on the wall it shortens.

## 10. Contact-face policy

**Policy A — keep both faces in contact and tag them.** Stage 01B already tags
the trimmed wall's new end face with the junction's id in `CompiledTri.contactId`,
and this stage continues that unchanged. The repository spells the tag as a
contact id rather than a part named `INTERNAL_CONTACT` so that the face can be
traced back to the record that created it.

Measured on the ring, both schedules: 16 tagged triangles over 4 corners, total
area **5.400000 m²** = 4 × 0.45 × 3 — one full thickness-by-height end face per
corner. The triangle count is 16 rather than 8 because an end face is split on
the same height grid as the rest of the wall, so a wall with an opening
contributes three bands instead of one; area is the meaningful measure.

Every one of them is **buried**: a ray leaving it along its own normal meets
material immediately, asserted face by face. Nothing was moved apart, no epsilon
gap was opened, and no shader hides anything. The faces are also load-bearing
for the mesh — dropping them opens the wall's surface, asserted directly — which
is why culling them was not the policy chosen. No whole-ring boolean union is
performed.

## 11. Rigid transform and global isolation

Under a 41°-about-Y composed with 23°-about-X rotation plus a translation of
`(137.25, −58.5, −1041.75)`, for both schedules:

- volume **33.57 m³** (to 8 decimal places);
- facade **80.0 m²**;
- clear interior **7.10 × 5.10 m**;
- opening host-local coordinates unchanged to 9 decimal places;
- overlap and gap still zero at all four corners;
- corner ownership, ring order and junction records identical.

Beside two 1600 m walls placed 800 m away, for both schedules, every ring
triangle is **deep-equal** to the ring compiled alone, and the junction records
are identical. No global bounding box or facade frame reaches the junctions, the
openings, the facade classification, the volume or the exposed area.

The distant walls are joined by no junction, and that is **reported**, not
ignored: `RING_WALL_END_UNJOINED` names `far_north` and `far_south`, and the
ring reports `closed: false` for the input as a whole. An unjoined wall is
exactly the fault that makes a ring overlap itself, so silence there would be
the wrong behaviour. The ring's own geometry is unaffected, which is what §14
requires.

## 12. Determinism and immutability

The input is deep-frozen before compilation and unchanged after. Two
compilations of the same input produce deep-equal triangles, junctions, extents,
ring order and diagnostics. Both schedules are separately deterministic.
Reversing the order of the walls and of the junctions in the input produces the
same set of triangles.

## 13. Invalid cases

Each returns its own diagnostic, and nothing is auto-repaired:

| Case | Code |
| --- | --- |
| one of the four junctions missing | `RING_WALL_END_UNJOINED` *(new)* |
| every end joined but as two loops, not one ring | `RING_NOT_CLOSED` *(new)* |
| incompatible claims on the same wall end | `CONFLICTING_JUNCTION_END` |
| a wall end in the wrong place | `JUNCTION_ENDS_DO_NOT_MEET` |
| a wall not orthogonal to its neighbour | `JUNCTION_NOT_ORTHOGONAL` |
| an owner that is not at the corner | `JUNCTION_OWNER_NOT_A_MEMBER` |
| an opening inside a corner another wall owns | `OPENING_IN_TRIMMED_ZONE` |
| duplicate wall id | `DUPLICATE_WALL_ID` |
| duplicate junction id | `DUPLICATE_JUNCTION_ID` |

Only the first two are new. The rest are Stage 01/01B diagnostics, exercised at
ring scale to confirm they still fire there.

`RING_NOT_CLOSED` earns its place: four walls joined as two separate two-wall
loops have every end claimed, every junction well formed and every corner
geometrically sound. No single junction can see the fault. It is the one thing a
ring knows that a corner does not.

A refused opening does not take its host wall with it — the wall is emitted
whole and closed, and the diagnostic says why there is no hole in it.

## 14. Visual diagnostics

```
npx tsx scripts/storey-ring-diagnostic.ts              # -> out/storey-ring/
npx tsx scripts/storey-ring-diagnostic.ts some/dir     # elsewhere
```

Six PNGs of the **actual emitted triangle list**, rasterised by this
repository's own software renderer (`src/core/camera/shade.ts`). Not a browser
screenshot, not a Three.js view, and no product UI is touched.

| File | View |
| --- | --- |
| `01-ring-schedule-a.png` | the complete ring, Schedule A |
| `02-ring-schedule-b.png` | the complete ring, Schedule B |
| `03-interior-oblique.png` | roofless oblique, looking into the storey |
| `04-ring-rotated.png` | the ring after a rigid rotation |
| `05-opening-detail.png` | the FRONT opening: jamb, sill, head and the pane at mid-thickness |
| `06-contact-faces.png` | the tagged contact faces, in red |

`06` needs a word. In the complete ring the contact faces are visible only as a
hairline where they meet the owner's material — which is the policy working, and
useless as evidence. The two walls that own corners are therefore left out of
that one render so the tagged faces can be seen for what they are: full
thickness-by-height end faces, flat against where the owner's material is.
Nothing is moved and no gap is opened; it is a render-time relabel of triangles
the compiler emitted unchanged.

## 15. Tests and builds

```
npx vitest run tests/storey-ring.test.ts       52 passed   (this stage)
npx vitest run tests/wall-compiler.test.ts     15 passed   (Stage 01)
npx vitest run tests/wall-junction.test.ts     17 passed   (Stage 01B)
npm test                                      213 passed, 14 files
npm run typecheck                             clean
npm run build                                 clean
npm run standalone:bundle                     clean
npm run standalone:build                      clean
PAGE=hosted.html STRICT_CSP=1 npm run standalone:verify
                                              11/11 browser checks passed
```

The standalone artifact is **unchanged**: `assets/index-BzrIX8C4.js` at
1 390 453 bytes, `assets/style-Dqog2LH0.css` at 3 742, and
`assets/analyze-worker-i3TYSxLR.js` at 206 420 — the same hashed names and the
same byte counts as the build already published. The determinism and
reference-isolation tests still pass, which is the direct check that the
analyzer's own output did not move. No unexpected production or standalone
artifact change was found, so there was nothing to investigate.

## 16. Limitations

- **A rectangle, not a network.** Four walls in one cycle. T-junctions, mitres,
  interior partitions, curves, non-orthogonal corners, walls of differing height
  and wall layers are all out, and each returns its own diagnostic rather than
  an approximation.
- **The ring is a cycle in the junction graph, and nothing more.** Nothing
  checks that the cycle is planar, convex, non-self-intersecting or even a
  simple loop in space. Four walls could close a figure-of-eight and this stage
  would call it closed; the per-corner geometry tests are what would catch it,
  not the topology check.
- **Junctions are never inferred.** A wall end with no junction is reported, not
  invented. That is deliberate and it is also a gap: nothing here turns a plan
  into a set of junctions.
- **Separate solids in contact, not one union.** The ring is four closed solids
  that touch. Volume is the sum of four measurements, not one watertight
  whole-ring surface, and the facade oracle needs the envelope handed to it
  because the union is not available to be queried.
- **No floor and no roof**, so the enclosure is open top and bottom and the
  interior void is not a bounded region. That is why the facade oracle takes
  only the four vertical planes.
- **Still not connected to the analyzer.** No plan, elevation or dimension
  reading produces a `WallSpec`, a `WallJunctionSpec` or an ownership schedule.
  This stage proves the compiler, not the route to it.

## 17. Next bounded step

**Two storeys stacked: a floor-level contract and vertical continuity.**

One storey ring is now provable. The next thing that cannot be answered by
anything above is what happens where one ring sits on another: whether a wall on
the upper storey is described relative to its own floor level or to the ground,
whether an upper wall may be set back from the lower one without inheriting its
corners, and whether the two rings' volumes sum without double-counting the
slab zone between them.

That is also the shortest path back to the defect this pivot began with. RC03's
counterexample is a two-storey building whose upper front wall is recessed
behind the lower one — which is exactly the case a storey-stacking contract has
to get right, and exactly the case the production compiler's global facade frame
cannot express.

It is still **not** the next step to wire any of this into production. A wall
network built from a plan needs junction inference, and nothing in this stage
infers a junction.

## 18. Out of scope, confirmed not done

No arbitrary wall networks, T-junctions, mitres, curves, wall layers, slabs,
roofs, room inference, gold Marcówki, OCR, plan vectorisation, EvidenceGraph
migration, camera repair, production integration, Kotlin port or IFC export. No
camera was fitted to an ARCHON image and no dimension was tuned to the reference
screenshots. Source interpretation, Marcówki production output, OCR, the
EvidenceGraph, camera fitting, the repair loop, roofs and the product UI are all
exactly as they were.

---

`PASS_STAGE_WEB_PIVOT_01C_CLOSED_STOREY_RING_PROOF`
