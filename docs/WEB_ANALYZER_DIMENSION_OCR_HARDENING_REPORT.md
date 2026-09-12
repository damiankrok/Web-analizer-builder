# RESEARCH-ANALYZER-WEB-02 — dimension OCR, chains, rooflights and opening topology

## 1. Branch and HEAD

Branch `claude/new-session-pvd4ik`, continuing the WEB-01 prototype.

| | |
| --- | --- |
| WEB-01 final commit | `1f66ad4` |
| WEB-02 iterations 1–2 | `01fbbc6` |
| WEB-02 iteration 3 | `ae320d8` |
| Freeze commit (§29) | `ef5d36e` |
| Post-holdout generalization fix | this commit |

Worktree clean at each step; nothing was reset, cleaned or stashed.

## 2. WEB-01 baseline

The gaps WEB-02 was set to close:

1. no printed digit read on any project;
2. 2 of 167 glyph prototypes matched on A, zero opening callouts;
3. every chain dimension therefore `GEOMETRIC_INFERRED`;
4. rooflights undetected;
5. secondary opening topology approximate.

## 3. Best available source resolutions

This was the first hypothesis to test, and it was half the problem.

ARCHON publishes every technical drawing **twice**: a small copy inside the
page's `<img>`, and the original behind the anchor that wraps it. The
original's filename carries no view name at all —
`projekt-dom-w-marcowkach-ge-<hash>__11264.jpg` against the page copy's
`elewacja-frontowa-...__264.jpg` — so matching the pair by filename classifies
a 1280 px elevation as an unrelated render, which is exactly what happened. The
pairing has to come from **containment** in the markup.

The section is embedded with a script handler and no anchor, so a second,
weaker mechanism covers it: the asset path ends `__<variant>` and the original
is the same path with the variant offset by a fixed block. That is a guess about
a publisher's URL scheme, so it is only ever a *candidate* — the host fetches
it, decodes it, and keeps it solely if it is a valid image strictly larger in
both axes. Nothing is resampled; an upscaled thumbnail is not new detail.

### Project A — measured

| Asset | Page px | Best available px | How found | Used for text? |
| --- | --- | --- | --- | --- |
| ELEVATION_FRONT | 550×213 | **1280×597** | anchor | yes |
| ELEVATION_LEFT | 550×213 | **1280×597** | anchor | yes |
| ELEVATION_REAR | 550×213 | **1280×598** | anchor | yes |
| ELEVATION_RIGHT | 550×213 | **1280×598** | anchor | yes |
| SECTION | 400×300 | **1138×854** | variant probe | yes |
| SITE_PLAN | 344×400 | **734×854** | anchor | yes |
| PLAN_GROUND | — | 853×853 | none larger published | yes |
| PLAN_UPPER | — | 853×853 | none larger published | yes |
| PLAN_OTHER ×2 | — | 853×853 | none larger published | yes |
| HERO_RENDER | 800×600 | 800×600 | — | no |
| GARDEN_RENDER | — | 800×600 | — | no |

The elevations gain 2.33× linearly (5.4× the pixels) and the section 2.85×
linearly (**8.1× the pixels**). The same upgrades apply on B, C and D; D's
section reaches 1327×854.

**The plans are a proved source limitation.** The lightbox endpoint
(`/product_fancybox_floor/<id>/<n>`) was fetched and returns the same
853×853 GIFs, and the dimensioned variant (`__11815`) is already in the
upgraded block, so no larger copy exists. At 853 px a plan's digits are
**9–11 px tall**; the section's, after the upgrade, are **21 px**. That
difference decides what can be read, and it is the central finding of WEB-02.

## 4. Dimension geometry pipeline

`src/core/dimensions/geometry.ts`, at source-native resolution. Geometry before
recognition, and the ordering is the most important decision here: run a
recogniser over a whole plan and it returns hundreds of candidates, mostly
furniture outlines and appliance symbols, with nothing to say which components
belong together or what any of them measures. Find the dimension lines first
and a label becomes a small box at a known place with a known orientation
holding exactly one number, whose value the baseline length already predicts.

Detected: thin lines in both orientations; end ticks; extension lines; chain
baselines and their intervals; label zones; callout rings with their leader
lines; level-marker bands; and the drawing's italic slant, measured from its own
text.

Three details earned their place.

- **A tick crosses the baseline; a label does not.** Scoring the *weaker* of the
  two perpendicular sides is what stopped five phantom anchors appearing under
  `1205` — a digit's stem inks one side only.
- **Sub-pixel tick centroids and sub-pixel line rows.** A pixel is 1.4 cm on
  these drawings, the same order as the centimetre grid the dimensions are
  printed on, so integer localisation drowns the signal the chain solver
  depends on.
- **The baseline is drawn past its outermost ticks.** Using its ends as anchors
  regardless made every end segment several pixels long — a one-percent scale
  error, which is precisely the accuracy that decides whether a four-digit label
  has one candidate value or forty.

Chains are then assembled into **families** (`chainFamilies`): a dimensioned
drawing stacks an inner line divided into intervals under an outer line with a
tick at each end, and they are one arithmetic statement. Synthesising an
"overall" zone across a multi-interval line instead just re-reads the part
labels side by side.

## 5. Recogniser architecture

`src/core/dimensions/recognizer.ts` defines the seam:

```ts
interface TechnicalTextRecognizer {
  readonly name: string
  recognize(crop: TextCrop, context: TextRecognitionContext): TextCandidate[]
}
```

Crops (`crops.ts`) are cut from source-native pixels, rotated upright (vertical
chains print bottom-to-top), contrast-stretched against their own local paper
level, cleared of the rule running through them, and thresholded three ways
deterministically — a stroke that anti-aliasing thinned below one threshold is
still found by another.

Glyphs are normalised to a 10×14 grey profile with **bilinear** sampling and the
measured italic slant removed. Both matter at this size: nearest-neighbour
sampling aliases the stroke edge by up to half a pixel, enough to move a digit's
waist a whole cell and make two instances of one character disagree more than
two different characters do; and a sheared `1` and an upright `7` otherwise
occupy nearly the same box.

Classification is nearest-template with **two refusals** that matter more than
the matching: an absolute similarity floor and a margin over the runner-up. A
glyph that is not clearly one character is returned unread, because a
plausible-looking wrong digit in a dimension is worse than no dimension.

## 6. OCR backends

One backend: the deterministic template path above. No library, no model file,
no network.

A local OCR adapter was considered and not added. It would have to be isolated
behind the seam, marked `REPLACE_ON_ANDROID`, and — per §8 — forbidden from
becoming exact metric truth; on 9-pixel italic digits it would also have needed
its own verification layer to be trustworthy, which is the layer that already
exists here. The seam is in place and `ensembleCandidates`-style merging is what
`resolveOpening` already does one level up, so adding a second recogniser is a
contained change rather than a rewrite.

### How the alphabet is learned

There is no font file, and there does not need to be, because the drawings are a
self-labelling dataset — but only if the supervision is honest.

A first attempt supervised from labels whose value the geometry pinned to a
single integer. That asks for more precision than a drawing measured in whole
pixels can give: a ridge measured at 7.92 m off a section prints 7.95, so the
prediction is excellent and the last digit is still wrong, and one wrong
character corrupts every label containing it.

The rule that works is **invariant-position harvesting**. With the candidate set
791…799 the hundreds digit is 7 and the tens digit is 9 in every member, so
those two glyph images are labelled with certainty and the units glyph is left
alone. Nothing is guessed; the alphabet grows from whatever the measurements
genuinely determine.

The **section supervises the package**, for two reasons. Its vertical scale is
fixed by a *published* fact (building height, terrain to ridge), so every
reference line on it has a known height before anything is read — and its datum
marker is exactly zero by definition, the one printed dimension on any drawing
that needs no measurement. After the resolution upgrade its text is also the
largest in the package. The plans come second and are *read* rather than
predicted, because their scale is not published: the page gives an area, not a
width.

A **labelling-coherence** objective (`templates.ts`) exists to break the
remaining circularity — it asks only whether the glyph *images* agree with the
labels, never what the values are, so a self-consistent wrong scale scores
badly. It is used to choose among candidate scales where a scale prior exists.

## 7. Dimension grammar

`src/core/dimensions/grammar.ts`. A token is not a length, and the grammar's job
is to enumerate readings rather than choose one.

| Form | Readings kept |
| --- | --- |
| `1205` | 12.05 m (centimetres, prior 0.85) · 1.205 m (millimetres, prior 0.40) |
| `2,72` | 2.72 m (metres) — the separator means the drawing already chose |
| `+7,95` | +7.95 m (signed metres) |
| `-0,32` | −0.32 m |
| `±0,00` | 0.00 m |
| `24` | 0.24 m · 0.024 m · 24 m, filtered by kind |

Plausibility is by kind: a chain segment is 0.2–60 m, an opening 0.3–8 m, a
level −6…+30 m. Readings outside their band are dropped **with a reason**, not
silently — a token with no surviving reading is a finding.

Nothing here commits to a convention. `1205` as millimetres is a perfectly
possible dimension and stays on the table; what chooses is the pixel length of
the thing it labels.

## 8. Chain solver

`src/core/dimensions/chains.ts`.

- `solveChainIntegers` jointly fits the one unknown scale and the whole-
  centimetre values. A chain of five segments has five rounding residuals and a
  closure residual that bottom out together at the true scale and nowhere else.
- `voteScale` recovers a scale across several chains, with an **aliasing
  guard**: at a scale whose reciprocal is a small integer every integer pixel
  length divides exactly, so unanimity across a large field of candidates — most
  of which are not dimension chains — is evidence *against* a scale.
- `solveChain` settles each segment against its own baseline, then checks
  closure. Parts that sum to a printed total are `SOURCE_CORROBORATED`; a chain
  that misses closure has the one segment most at odds with its own baseline
  demoted and the reason recorded.
- It never invents. An unread segment stays `null` and the chain simply does not
  close; a value obtained by subtracting other values is not a printed
  dimension.

## 9. Physical association

`contracts.ts` defines `PhysicalAssociation` over wall faces and axes, opening
jambs, mass corners, room boundaries, floor and slab levels, ridge, eave,
terrain and balcony levels, each with a residual and a confidence.

In practice the association that carries the accepted readings is the
**level-marker-to-reference-line** one. A marker is placed on the nearest
reference row *below* its text — drafting convention puts the figure above the
line — and the height of that row above the datum is the value. Going through
the line rather than through the text's own position removes the text-offset
unknown entirely; on A the offset was consistent at ≈ 0.20 m across all five
markers, which is what confirmed the model.

Chain segments associate to their two anchors, and a reading is accepted only
where the value matches the baseline it spans at the drawing's settled scale.
Opening callouts have a leader-tracing path (`traceLeader`) that finds the
feature a ring points at; no leader was successfully traced on A or B, so no
callout reached association.

## 10. Metric fusion

Every reading passes a two-source test before it counts. The recogniser says
what the token is; the geometry says what the thing it labels measures; only
agreement produces `SOURCE_CORROBORATED`. Disagreement is exported with the
reason and the implied scale, not discarded silently.

Fidelity classes (§14) are `SOURCE_EXACT`, `SOURCE_CORROBORATED`,
`SOURCE_DERIVED`, `GEOMETRIC_INFERRED`, `VISUAL_INFERRED`, `ASSUMED`,
`UNRESOLVED`, ranked in `FIDELITY_RANK`, with `isExactFidelity` gating which may
act as a hard constraint. Nothing in this run reached `SOURCE_EXACT` — that is
reserved for a printed figure verified against an independent published fact —
and no exact value was averaged with anything.

## 11. A: exact dimensions recovered

| Quantity | Read | Value | Fidelity | Check |
| --- | --- | --- | --- | --- |
| section datum (`±0,00`) | `000` | 0.000 m | `SOURCE_CORROBORATED` | within tolerance of the datum row |

Alphabet learned: all ten digits, from **287 certain glyph positions across 194
labels**. Sixteen tokens were read; one survived the geometry check.

The four other section level markers were **located, placed on the correct
reference line, and predicted to within 3 cm** — ridge 7.921 m against a printed
7.95, upper floor 3.101 against 3.06, terrain −0.349 against −0.32 — and read
partially (`79?`, `300`, `03?`). The missing characters are the units digits,
which no invariant position determined and no template covered with enough
margin.

## 12. B: exact dimensions recovered

| Quantity | Read | Value | Fidelity | Check |
| --- | --- | --- | --- | --- |
| plan chain segment (dimensioned variant) | `706` | 7.06 m | `SOURCE_CORROBORATED` | implies 37.1 px/m against the drawing's settled 36.05 px/m |
| plan chain segment (areas variant) | `706` | 7.06 m | `SOURCE_CORROBORATED` | same segment on the sibling plan |
| section datum (`±0,00`) | `000` | 0.000 m | `SOURCE_CORROBORATED` | within tolerance of the datum row |

**3 of 3 readings accepted.** Alphabet `0123456789` minus `8`, from 291 certain
positions across 232 labels. The 7.06 m segment is the one genuine plan-chain
dimension recovered in this study: read from glyphs, then confirmed by the
baseline it spans, on both published plan variants independently.

## 13. Rejected and ambiguous examples

The refusals are the working part of the recogniser, so they are worth showing.

| Example | Outcome |
| --- | --- |
| `ambiguous: 8 at 0.72 beats runner-up by only 0.041` | unread — margin below 0.06 |
| `best match 3 at 0.56 is below the 0.62 floor` | unread |
| `no template passed the shape gates` | unread — hole count or aspect ruled every template out |
| `429 as MILLIMETRES = 0.429 m disagrees with its 157 px baseline (4.290 m)` | interpretation rejected, the other kept |
| `"0" as CENTIMETRES is 0.000 m, outside 0.2..60 m for CHAIN_SEGMENT` | reading rejected by the grammar |
| D: section level read `888`, predicted 5.71 m | **rejected** — outside tolerance of its own reference row |
| A: 15 of 16 tokens | read but rejected by the geometry check |

The D case is the one to keep in view: the recogniser produced a confident,
well-formed, arithmetically plausible token and the association layer threw it
away because it did not match the line it sat above. That is the pipeline
working as specified.

## 14. Room dimension coverage

| Category | A | B |
| --- | --- | --- |
| overall width | `GEOMETRIC_INFERRED` (plan extent, area-calibrated) | same |
| overall depth | `GEOMETRIC_INFERRED` | same |
| total height | `SOURCE_EXACT` (published fact) | same |
| ridge / eave | `GEOMETRIC_INFERRED` from the section; printed markers located and read partially | same |
| major secondary-mass dimensions | `GEOMETRIC_INFERRED` | n/a |
| room count | `SOURCE_EXACT` (published room table) | same |
| room area | `SOURCE_EXACT` (published room table) | same |
| room width / length candidates | **not recovered** | one 7.06 m chain segment |
| floor-to-floor levels | markers located, values partially read | datum read |
| wall thickness | `SOURCE_EXACT` (published build-up) | published |
| explicit wall offsets | not recovered | not recovered |

A **room-area anchor** was built and then set aside honestly. The page publishes
the room table and the plan prints those same areas, so matching ink runs to
published strings is supervision with no scale involved — and on A a
structurally certain match exists (`29,52` is the only four-digit area on the
ground floor). It reached one certain label before the ambiguity of the
remaining classes stalled it, and a region-ranking refinement failed because
doorways connect every room into one flood region. The code is in
`room-anchor.ts` and is not wired into the pipeline; presenting it as working
would be false.

## 15. Opening callout coverage

**Zero callouts decoded on any project**, and the reason is specific and
measured.

The callout detector works: rings are found by radial consistency and confirmed
by the divider bar across their middle, with both halves required to hold ink,
and A's plans yield the expected markers. What fails is the glyphs inside them.
A callout on an 853 px plan is ~33 px across and holds two stacked numbers, so
each digit is **6–8 px tall** — smaller than the plan's chain labels, which are
themselves below the threshold at which the template bank transfers from the
section.

The exact dimensions A's plans print in their callouts — `470/230`, `300/230`,
`90/230`, `140/140`, `100/210`, `110/230`, `105/210`, `275/225` — are visible to
a human at 4× magnification and are not recoverable by this recogniser at the
published resolution. Since no larger plan is published, this category is
**blocked by the source**, not by recogniser quality alone. Opening sizes
therefore continue to come from the elevations.

## 16. Rooflight results

New in WEB-02 (`src/core/roof/rooflights.ts`), and working.

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| observations (side elevations) | 7 | 0 | 0 | 0 |
| placed on a roof plane | **5** | 0 | 0 | 0 |
| discarded as off-roof | 2 | — | — | — |
| corroborated by two elevations | 0 | — | — | — |

A's five rooflights sit on the two roof slopes at 4.6–6.3 m — inside the
eave-to-ridge band — and are drawn as glazed panels lying **in** the plane,
following its slope.

The detector is built around its rejections, because a rooflight is easy to
confuse with four other things and each confusion has its own signature: a
chimney breaks the roof outline, tile courses repeat across the plane at a
regular pitch, an eave shadow hugs the boundary, a dormer is much taller. All
four rejections are tested.

One finding worth stating: **contrast must be two-sided**. A rooflight in a dark
tiled roof reads *lighter* than its surroundings, because the glass returns the
sky; the same unit in a pale roof reads darker. Testing only for darkness — the
obvious first guess, and the one this detector originally made — found nothing
on A at all.

Fusion also turned out to need only one view. The elevation that shows a
rooflight is the one facing its slope, so it gives the position along the ridge
directly, and because height varies monotonically across a slope the observed
height gives the position across it. A second view now corroborates rather than
rescues.

## 17. Secondary opening topology

`src/core/openings/identity.ts`. Observations are resolved in the building's own
frame — facade, position along it, sill height — so a plan gap and an elevation
rectangle can be matched where no pixel correspondence exists at all. Each field
comes from the highest authority that states it, provenance is recorded per
field, and disagreements are kept rather than averaged.

The rule that made it work: **identity is a cross-source operation**. Two
rectangles found in one elevation are two openings — the detector already
suppressed overlapping duplicates, so what survives side by side is side by
side. Merging within a source collapsed a window next to a patio door into one
five-metre opening and reported the difference as a "conflict"; stating the rule
removed ten such false conflicts on A. The one within-source identity relation
is **nesting**: a rectangle wholly inside another is a panel of it, which is
where `panelCount` and the mullion positions now come from.

Supported group structure (§19): outer structural opening, panel subdivision,
mullion positions, door leaf, gable clipping, owning facade, storey, and the
source evidence behind each. Structural quantity deductions use the outer
opening, never the panel sum.

A's 14 resolved openings, from 20 observations with 6 merged and **0 conflicts**:
2 doors, 5 windows, 3 sliding glazing, 1 garage gate, 3 gable glazing. A
source-established kind now outranks one inferred from proportions — gable
glazing is known to be gable glazing because its head is cut by two roof planes,
and no rule over width, height and sill can recover that.

## 18. Iteration 1 — source resolution and dimension geometry

Delivered: lightbox-original discovery by containment; the verified variant
probe; the resolution audit (§3 above); the full dimension-geometry stage at
source-native resolution; debug overlays (`scripts/dimension-overlay.ts`,
`scripts/dimension-read.ts`).

Evidence: the resolution table; overlays showing A's top chain resolved to
`1205` over `790` + `415` with the middle tick at the right place (302/462 of
the span against a true 790/1205 = 0.6556); 43 thin lines reduced to the chains
that carry ticks *and* a text run.

A and B re-ran with all hard constraints satisfied.

## 19. Iteration 2 — recognition, chains, metric fusion

Delivered: the recogniser seam, glyph segmentation and normalisation, the
template bank, invariant-position harvesting, the labelling-coherence objective,
the dimension grammar, the chain solver with closure and aliasing guard, the
project-level reader (section first, then the plans), and the
`printed-dimensions.json` export with the fidelity classes.

Evidence: the recovered and rejected tokens in §11–§13; A's section reference
rows recovered to a pixel; the alphabet reaching all ten digits from 287 certain
positions; B's 7.06 m chain segment accepted on two independent plan variants.

Determinism broke once here — a new timing field entered the bundle hash — and
was fixed by adding it to `NON_DETERMINISTIC_KEYS`.

## 20. Iteration 3 — opening topology and rooflights

Delivered: the rooflight detector and fusion; the opening identity resolver with
panel structure and retained conflicts; and three massing regressions that the
higher-resolution elevations exposed.

Those three are worth listing, because each is a general rule the analyzer was
missing:

- **A projecting slab must have building behind every part of it.** An elevation
  draws its bands across the whole drawing, and on a plan with a wing that is
  wider than the wall a slab could hang from; taken literally it produced a
  nine-metre balcony whose outer half floated in front of nothing.
  `backedExtent()` clips bands and slabs to the stretch with a wall behind them.
- **A flue must clear its roof by enough to draw**, so the minimum rise is
  0.8 m. The 0.5 m stub that reappeared at the wing junction is gone.
- **Two bands a few centimetres apart across one facade are one balustrade**
  seen twice, now merged.

Plus: a rectangle above the eave line on a facade that shows no gable is a roof
feature, not a window.

## 21. Optional iterations

None. The three mandatory iterations plus the post-holdout generalization fix
(§25) consumed the available scope, and the remaining P0 is a source-resolution
limit rather than something another tuning pass would move.

## 22. A: visual and metric final audit

Compared against the ARCHON hero render, garden render, four technical
elevations and the section.

| Priority | Feature | Verdict |
| --- | --- | --- |
| massing | gabled main body + lower flat-roofed wing | **MATCH** |
| massing | footprint 12.14 × 12.67 m, area 131.16 m² (published) | **MATCH** — printed 1205 × 1260 cm, so +0.7 % and +0.6 % |
| roof | single gable, ridge front-to-rear, gable ends front and garden, 40° | **MATCH** |
| roof | rooflights | **MATCH (new)** — 5 placed in the slopes; WEB-01 had none |
| roof | single chimney, right of the apex, through a continuous surface | **MATCH** |
| envelope | gable-end walls below the eave | **MATCH (fixed)** — see §25 |
| openings | ground-floor glazed bays, entrance, garage gate | **CLOSE** — present; the rear bay is modelled 9 m wide against ~5 m real |
| openings | two-storey gable glazing with recessed loggia and glass balustrade | **MATCH** |
| openings | panel subdivision and mullions | **CLOSE (new)** — recovered by nesting, counts approximate |
| proportions | floor 3.05, eave 4.60, ridge 7.92 m | **MATCH** — printed 306 / 467 / 795 cm, so −1 cm, −7 cm, −3 cm |
| dimensions | printed values as exact constraints | **DIFFERS** — one accepted (the datum); see §11 |
| materials | not modelled (monochrome architectural study) | N/A |

Score 0.2176, all four hard constraints satisfied, both cameras
`CAMERA_USABLE`. A correct dimension on the wrong wall would be a failure; none
of the accepted readings is misplaced, because acceptance *is* the placement
test.

## 23. B regression

| | WEB-01 final | WEB-02 final |
| --- | --- | --- |
| footprint | 12.68 × 17.98 m, 227.89 m² | unchanged |
| ridge / eave / pitch | 6.27 / 3.25 m / 35° | 6.10 / 3.33 m / 35° |
| score | 0.2217 | **0.2118** |
| elevation term | 0.578 | 0.545 |
| hard constraints | all satisfied | all satisfied |
| printed dimensions accepted | 0 | **3** |

B improved on every axis. The gable-wall fix (§25) helped it most, because B is
a single-mass gabled house and was losing the same walls D was.

C, now `HISTORICAL_HOLDOUT_WEB01` and kept as a second regression project,
also improved: 0.2190 → 0.1957, all hard constraints satisfied.

## 24. Freeze hashes

Written by `npm run freeze` at commit `ef5d36e`, before D was fetched or run.
The freeze object was extended to cover everything WEB-02 added — dimension
geometry, glyph segmentation and classification, the grammar, the chain solver,
text runs, section-level association, opening identity and rooflight thresholds
— with grammar and recogniser configuration hashed apart from the rest.

```
codeSha              ef5d36e78896070502b9e4568a63e01fcca7c230
weightHash           9258b9529b705efd182524a5967475b56fd5d492dcb79440fc0bea1960a455b3
thresholdHash        3ef4e1ebbec956bac447eb146a20504c7ae8ed66ca8160afd300ac34d58050d8
metricDefinitionHash b726560dc0c6270842be8cac52142dcb61a7a7bffd069e149f440cf14aa814e6
configHash           c22828819436913b648690984a4e378fa365a15a7aab86e55d072f241b368330
grammarHash          b26c02dc9bff8b24c2fcad0ee61062ad397c649641b845abaa543729d908f17d
```

There is no template file to hash: the bank is harvested from each project's own
drawings at run time, so what is frozen is the harvesting rule rather than a set
of glyph images. The `holdout` command refuses to run if any hash — or HEAD —
has moved since; the freeze as run is kept at `out/freeze-web02.json`.

## 25. D holdout result

**Project D: Dom w kruszczykach 22** — single storey, hipped/gabled, no usable
attic, no flat-roofed wing, so it shares no massing family with A or B. Chosen
before development began on the presence of technical drawings alone; none of
its metric values were inspected, and it was neither fetched nor run until after
the freeze.

### Run 1 — under the freeze

| | |
| --- | --- |
| assets | 25 fetched, 25 analysed |
| footprint | 12.72 × 8.72 m, 110.92 m² |
| ridge / eave / pitch | 6.01 / 3.58 m / 30° |
| score | 0.1890 |
| hard constraints | **all satisfied** |
| cameras | 3 perspective views, all `CAMERA_USABLE` |
| printed dimensions | 1 token read, **0 accepted** — a section level read `888` and rejected for not matching its own reference row |

No catastrophic failure. But the rendered model exposed a **material
source-supported generalization P1**: the front and rear walls below the eave
were missing entirely, leaving an open shell under a roof.

The cause is general and was a real bug. A gable end has two parts — the
rectangle from the mass base to the eave, and the triangle from the eave to the
ridge — and the wall loop skipped gable ends on the assumption that the gable
builder covered them. It did not: it builds only the triangle. On A, whose
pitched roof sits on a second, upper mass, the missing piece is a knee-wall band
and easy to overlook; on a single-mass gabled house it is the whole front and
rear wall.

Per §29 this makes the result **PARTIAL**.

### Run 2 — after the fix, reported as verification and not as a clean holdout

The fix changes no threshold, no weight and no tolerance — it removes a `continue`
that skipped geometry — so the configuration hashes are unchanged and the code
SHA is not. D was re-run to confirm the fix generalises:

| | Run 1 | Run 2 |
| --- | --- | --- |
| score | 0.1890 | **0.1579** |
| elevation term | 0.483 | 0.396 |
| perspective term | 0.157 | 0.142 |
| hard constraints | all satisfied | all satisfied |
| cameras | 3 × USABLE | 3 × USABLE, one with no ambiguity |

The same fix improved A (0.2188 → 0.2176), B (0.2295 → 0.2118) and C
(0.1957). This is the best kind of holdout outcome: a defect the development
projects structurally could not show, found once, fixed generally.

## 26. Performance

Offline from the cached fixtures, single-threaded Node 22.

| Project | assets | printed dims | asset analysis | scaffold | camera fit | repair | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 3.1 s | 3.7 s | 2.0 s | 10.2 s | 3.7 s | **22.7 s** |
| B | 24 | 2.4 s | 9.0 s | 1.2 s | 30.8 s | 2.5 s | **45.8 s** |
| D | 25 | 2.8 s | 9.7 s | 2.0 s | 13.6 s | 1.1 s | **29.1 s** |

The printed-dimension stage costs 2–3 s and is bounded: it works on a fixed set
of label boxes rather than on whole images, and its EM loop has a round cap. The
resolution upgrade raised asset-analysis time (larger images to downsample) but
the structural frame is still capped at 640 px, so everything downstream is
unchanged in cost.

## 27. Tests

**129 tests across 11 files, all passing.** 54 are new in WEB-02.

| File | Covers |
| --- | --- |
| `dimension-geometry.test.ts` (9) | horizontal and vertical chains; a label stem not read as an anchor; baseline ends used only when no tick exists; sub-pixel line location; inner/outer chain pairing; one zone per interval; a line crossing the chain; slant measured and reported as zero for upright text |
| `dimension-grammar.test.ts` (16) | sign/whole/fraction splitting; every plausible reading kept; separator meaning metres; signed levels; rejection by kind with a reason; expectation-based choice refusing when nothing is close; closure corroboration; single-segment demotion on closure failure; centimetres chosen over millimetres from pixels; unread segments left unresolved; integer chain solving; degenerate-scale refusal; consensus scale; invariant-position harvesting at three precisions |
| `openings-rooflights.test.ts` (20) | side-by-side openings kept; within-source overlap not merged; nesting read as panels; plan+elevation merge with per-field provenance; callout overriding an elevation with the conflict kept; no cross-facade merge; garage-gate classification; confidence rising on agreement; gable clip carried through; rooflight found lighter *and* darker; edge, texture and dormer rejections; no-scale refusal; single-view placement; two-view merge; out-of-band and no-pitched-roof discards |
| `source-resolution.test.ts` (9) | variant candidates proposed, and not proposed for an already-upgraded URL; query strings preserved; upgrade accepted only on strictly more pixels in both axes; lightbox originals paired by containment on the real page; one asset per view pointing at the largest copy; holdout isolation — exactly one HOLDOUT, D, with C marked historical |

Existing WEB-01 suites (camera maths, projection classification, vanishing
points, multi-view authority, ambiguity and confidence, determinism and
reference isolation, source adapter) continue to pass unchanged, including the
two whole-pipeline determinism tests.

## 28. Kotlin portability

Everything new is in `src/core/` and touches no DOM, React, Three.js, browser
global or Node stream.

| Component | Module | Verdict |
| --- | --- | --- |
| `DimensionLineDetector` | `core/dimensions/geometry.ts` | `PORT_DIRECT` |
| `TechnicalTextRecognizer` (seam) | `core/dimensions/recognizer.ts` | `PORT_DIRECT` |
| Template bank and coherence | `core/dimensions/templates.ts` | `PORT_DIRECT` |
| `DimensionGrammar` | `core/dimensions/grammar.ts` | `PORT_DIRECT` |
| `DimensionChainSolver` | `core/dimensions/chains.ts` | `PORT_DIRECT` |
| `PhysicalAssociation` | `core/dimensions/section-levels.ts`, `contracts.ts` | `PORT_DIRECT` |
| `MetricFusion` | `core/dimensions/stage.ts` | `PORT_DIRECT` |
| Crop pipeline | `core/dimensions/crops.ts` | `PORT_DIRECT` |
| Text-run finder | `core/dimensions/text-runs.ts` | `PORT_DIRECT` |
| Room-area anchor (not wired) | `core/dimensions/room-anchor.ts` | `PORT_DIRECT` |
| `OpeningIdentityResolver` | `core/openings/identity.ts` | `PORT_DIRECT` |
| `RooflightDetector` | `core/roof/rooflights.ts` | `PORT_DIRECT` |
| Resolution candidates (policy) | `core/source/resolution.ts` | `PORT_DIRECT` |
| Resolution probe (transport) | `node/source-loader.ts` | `PORT_WITH_ADAPTER` |

No OCR library is used, so nothing is `REPLACE_ON_ANDROID`. If one is added
later it must sit behind `TechnicalTextRecognizer`, be marked
`REPLACE_ON_ANDROID`, and stay subject to the same geometry check — ML Kit's
text recogniser is the Android equivalent and would need exactly that treatment,
since its output must not become exact metric truth.

Two Kotlin-specific notes beyond the WEB-01 guide: the resolution probe must
keep the fetch-policy checks (it is a new network path, and the policy is the
thing being ported, not the transport); and `refineLinePosition` and the tick
centroids must stay in `Double` — the sub-pixel fraction they recover is the
whole point.

## 29. Remaining P0 / P1 / P2

### P0 — blocked by the source, with evidence

- **Plan and callout text is 6–11 px tall and no larger copy is published.**
  Verified by fetching the plan lightbox endpoint and by confirming the
  dimensioned variant is already in the upgraded block. The exact printed
  values A's plans carry (`1205`, `790`, `415`, `1260`, `510`, `750`, and the
  eight opening callouts) are legible to a human at 4× and are not recoverable
  by this recogniser at 853 px. Until ARCHON publishes larger plans, or a
  super-resolution step is added and *validated* rather than assumed, plan
  chains and opening callouts stay out of reach.

### P1 — reachable

- **The section's units digits.** All five markers on A are located, associated
  and predicted to 3 cm; the hundreds and tens digits are harvested with
  certainty and the units digit is not. A published-fact closure — ridge above
  datum plus terrain below it equals the published building height — constrains
  the two units digits jointly, and that constraint is not yet used.
- **The room-area anchor.** It reaches one structurally certain label on A and
  stalls; the blocker is that doorways connect every room into one flood region,
  so region-size ranking cannot order the rooms. Closing doorways (a wall-gap
  detector on the plan) would unlock roughly nine certain labels per project,
  including the decimal comma.
- **Opening extents.** The rear bay on A is modelled 9 m wide against ~5 m real:
  the framed-rectangle detector merges adjacent glazing. A mullion-aware split
  inside a wide detection would fix it, and the panel structure to hang it on
  now exists.

### P2

- No render-region or plan-gap observations are produced yet, so the identity
  resolver runs with one source kind on real data and its cross-source paths are
  covered only by tests.
- Leader tracing finds no callout leaders on these plans; the ring detector
  works, so this is a tracing-robustness problem.
- `score.plan` is still 0 on every project — the plan contributes the footprint
  and nothing to the score.

## 30. Recommendation for the Android port

**Port the core now; do not port the plan-text path yet.**

What is ready: everything in §28 marked `PORT_DIRECT`, which is the whole
camera-aware reconstruction pipeline plus the dimension geometry, grammar, chain
solver, opening identity and rooflight detection. All of it is pure functions
over plain data with byte-comparable exports at every stage, which is what makes
a staged port verifiable rather than hopeful.

What to defer: the plan-chain and callout recognition path. Not because it is
unportable — it is `PORT_DIRECT` — but because it does not yet produce
trustworthy output on the published source resolution, and porting a component
that returns nothing useful adds surface without adding capability. Port the
seam and the section path, which do work, and leave the plan path behind it.

What the port should not lose: the refusals. The geometry check that rejected
fifteen of A's sixteen tokens and D's confident `888` is the difference between
this pipeline and one that quietly fills a model with wrong numbers. On a phone,
where a user sees the model and not the audit, that matters more rather than
less.

---

## Result

Printed dimensions are genuinely recovered and physically associated on B (three
readings, including a plan chain segment confirmed against its own baseline) and
on A (the section datum), against WEB-01's zero. Dimension geometry, chains,
grammar, fusion and the fidelity classes all work. Rooflights are detected,
placed and rendered. Opening topology is materially better, with panel structure
and retained conflicts. Tests and build are green.

But the §35 bar for PASS is not met: **no opening callout was decoded on any
project**, only one complete chain closure was achieved and not on A, and the D
holdout exposed a material source-supported generalization P1 — the missing
gable-end walls — which §29 says must be reported as partial even though it was
then fixed and improved every project.

PARTIAL_RESEARCH_ANALYZER_WEB_02_DIMENSION_HARDENING
