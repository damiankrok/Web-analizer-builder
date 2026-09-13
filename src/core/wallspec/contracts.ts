/**
 * Wall-local building description — STAGE WEB-PIVOT-01, development only.
 *
 * Nothing in the production pipeline imports this module. It exists to prove
 * one claim: that a wall described in its *own* coordinates compiles to a
 * correctly cut solid, and keeps doing so when the wall is recessed relative to
 * the building it belongs to.
 *
 * The production compiler (`src/core/hypotheses/solid.ts`) cannot make that
 * claim. It resolves an opening's position through `facadeFrame(side, bounds)`,
 * where `bounds` is the bounding box of *every* mass in the building. Two
 * consequences, both reproduced in `tests/wall-compiler.test.ts`:
 *
 *   - the opening's world point lands on the global facade plane, so a wall set
 *     back from that plane fails the `distA > 0.6` host test and the opening is
 *     dropped without a word;
 *   - the along-facade coordinate `s` is measured from the global box, so the
 *     same `s` means a different place on the wall depending on what other
 *     masses the building happens to contain.
 *
 * The contract below removes the global frame entirely. A wall carries its own
 * origin and axes; an opening is stated in that wall's coordinates and nowhere
 * else. Compilation of one wall reads nothing outside that wall and its own
 * openings, which is what makes the recessed and flush cases identical by
 * construction rather than by tolerance.
 *
 * Units are metres throughout. Angles do not appear: orientation is carried by
 * the axis vectors.
 *
 * PORT_DIRECT (Kotlin) — plain data, no host types.
 */
import type { Vec3 } from '../contracts/geometry.js'

/**
 * One rectangular wall panel.
 *
 * ## Frame
 *
 * The wall has a right-handed orthonormal triad `(u, up, n)`:
 *
 *   - `u`  runs along the wall's length, from the origin towards `lengthM`;
 *   - `up` runs along the wall's height, from the origin towards `heightM`;
 *   - `n = u x up` is the **outward** normal — the side a person outside the
 *     building stands on.
 *
 * Only `u` and `up` are stored. The third axis is not an independent degree of
 * freedom, and storing it would create a second place for it to be wrong;
 * `wallFrame()` derives it. Both stored axes must be unit length and mutually
 * perpendicular, which is exactly the condition for the derived triad to be
 * orthonormal — `compileWalls` checks it and refuses the wall otherwise.
 *
 * ## Origin
 *
 * `origin` is the corner at **`u = 0`, wall base, on the OUTER face**. Material
 * occupies
 *
 *     origin + u*a + up*b - n*c     for a in [0, lengthM],
 *                                       b in [0, heightM],
 *                                       c in [0, thicknessM]
 *
 * so thickness runs *inward*, against the outward normal, and the inner face
 * lies at `c = thicknessM`. Stating it as the outer face matters: an elevation
 * drawing dimensions the face you can see, and a compiler that quietly treats
 * the same number as a centre plane puts every wall half a thickness out.
 */
export type WallSpec = {
  /** Stable identity. Openings name their host by this. */
  id: string
  origin: Vec3
  /** Unit vector along the wall's length. */
  u: Vec3
  /** Unit vector along the wall's height, perpendicular to `u`. */
  up: Vec3
  lengthM: number
  heightM: number
  thicknessM: number
  /**
   * Sloped top: a gable end (`POLYLINE`), or a wall dying into a roof soffit
   * (`PLANE`). Absent means a flat top at `heightM`, which is the only shape
   * STAGE WEB-PIVOT-01, 01B and 01C ever compile.
   */
  topProfile?: WallTopProfile
}

/**
 * A rectangular hole cut through its host wall.
 *
 * All four measurements are in the host wall's own frame, and mean nothing
 * without it — which is the point. `offsetM` and `sillM` locate the opening's
 * `u = min`, `up = min` corner; there is no facade, no building and no bounding
 * box in this record.
 *
 * The cut is through the full thickness (`THROUGH`). Partial-depth recesses are
 * a different element and are not part of this stage; `cut` exists so that a
 * later stage adds them as a new case rather than by reinterpreting this one.
 */
/**
 * A plane in world coordinates, as a point on it and a normal.
 *
 * STAGE WEB-PIVOT-02A. The normal need not be unit length and its sign is not
 * read: the plane is a two-sided locus, and a wall top is the height at which
 * the wall meets it, not a half-space test.
 */
export type WallTopPlane = {
  pointM: Vec3
  normal: Vec3
}

/**
 * A wall's top surface.
 *
 * ## POLYLINE — a height along the wall (STAGE WEB-PIVOT-02)
 *
 * A gable end is a rectangle with a triangle on top, and it is one piece of
 * wall material, not a rectangle plus a decorative patch. The profile says so:
 * `points` are `(u, top)` pairs in the wall's own frame, joined by straight
 * lines, and the wall is the region between `b = 0` and that line. The top is
 * the same at the outer and the inner face, which is correct for a gable end,
 * where the wall rises *in* the plane of the roof slopes rather than under one.
 *
 * ## PLANE — a height that also varies across the thickness (STAGE WEB-PIVOT-02A)
 *
 * A wall that stops *under* a pitched roof cannot have one top height. The
 * soffit above it slopes, so the wall's outer face meets it lower than its
 * inner face does (or the other way round, depending which way the slope runs),
 * and a wall whose top is flat across its thickness leaves a wedge of air
 * between itself and the roof — measured at `1.99 m³` in the Marcowki shell at
 * the end of STAGE WEB-PIVOT-02.
 *
 * A `PLANE` top names the surface the wall dies into, in world coordinates, and
 * the compiler solves for the height at each `(u, c)`. The wall's frame, its
 * base, its `lengthM` and every opening coordinate are untouched: the only
 * thing that changes is where the material stops.
 *
 * `sourceRoofId` is the roof whose underside this plane is claimed to be. It is
 * carried so that the claim is checkable — a wall may not invent a top plane
 * and call it a roof — and so that the contact surface can be traced back to
 * the element it touches. The plane is *not* derived from the roof: deriving it
 * would make the two agree by construction and prove nothing.
 *
 * ## What a profile never does
 *
 * `heightM` stays the wall's nominal height and is what an absent profile means
 * — a flat top at `heightM`. A profile never changes `heightM`; like
 * `WallExtent`, it describes what is emitted, and openings are still measured
 * against the wall's own origin.
 */
export type WallTopProfile =
  | {
      kind: 'POLYLINE'
      /** At least two points, sorted by `u`, spanning the wall's emitted extent. */
      points: ReadonlyArray<{ u: number; topM: number }>
    }
  | {
      kind: 'PLANE'
      plane: WallTopPlane
      /** The roof whose underside this plane is. Checked, never trusted. */
      sourceRoofId: string
    }

export type OpeningSpec = {
  id: string
  hostWallId: string
  /** Distance along `u` from the wall origin to the opening's near edge. */
  offsetM: number
  /** Height above the wall base to the sill. */
  sillM: number
  widthM: number
  heightM: number
  /**
   * Head height at the far edge, when the head is raked.
   *
   * STAGE WEB-PIVOT-02. Marcowki's gable glazing has a head that runs parallel
   * to the roof slope, so the opening is a right trapezoid rather than a
   * rectangle. `heightM` is the height at `offsetM`; this is the height at
   * `offsetM + widthM`. Absent means a level head, which is every opening the
   * earlier stages proved.
   */
  heightFarM?: number
  cut: 'THROUGH'
}

/**
 * Glazing filling an opening.
 *
 * A zero-thickness display plane, parallel to the wall faces and set `insetM`
 * in from the outer face. It is emitted as its own part and is deliberately not
 * part of the wall solid: a closed wall volume that silently included its
 * windows would pass a volume check for the wrong reason.
 */
export type GlazingSpec = {
  id: string
  openingId: string
  /** Distance from the outer face to the glazing plane, along -n. */
  insetM: number
}

export type WallCompileInput = {
  walls: readonly WallSpec[]
  openings: readonly OpeningSpec[]
  glazing: readonly GlazingSpec[]
}

/**
 * Element class of an emitted triangle.
 *
 * The names are the production compiler's `BuildPart` names on purpose, so the
 * existing study shader renders this geometry with no adapter.
 */
export type WallPart = 'WALL' | 'WALL_INNER' | 'REVEAL' | 'GLAZING'

/** Parts that make up the closed wall solid. Glazing is not one of them. */
export const SOLID_PARTS: readonly WallPart[] = ['WALL', 'WALL_INNER', 'REVEAL']

export type CompiledTri = {
  a: Vec3
  b: Vec3
  c: Vec3
  part: WallPart
  /** Element this triangle belongs to: the wall id, or the opening id. */
  ownerId: string
  /** The wall this triangle was compiled from, always. */
  wallId: string
  /** Set on reveal and glazing triangles. */
  openingId?: string
  /**
   * Set when this face is in contact with another element rather than exposed.
   *
   * A butt junction leaves the trimmed wall's new end face pressed flat against
   * the owner's material. It is a real face of a closed solid — the mesh would
   * not be watertight without it — but it is not fabric anyone can see, and an
   * exposed-area measure that counted it would overstate the facade by one wall
   * section per corner. The same is true of a wall top that dies into a roof
   * soffit. The value is the id of the record that created the contact — the
   * junction, or the roof — so it can be traced back.
   */
  contactId?: string
  /**
   * What the contact is against. Set exactly when `contactId` is.
   *
   * Both kinds are excluded from exposed facade area, but they are not the same
   * fact and a reader should not have to guess from the id which one it is
   * looking at.
   */
  contactKind?: ContactKind
}

/**
 * Why a face is in contact rather than exposed.
 *
 * `JUNCTION` — a wall end pressed against the wall that owns the corner.
 * `ROOF_SOFFIT` — a wall top pressed against the underside of its roof
 * (STAGE WEB-PIVOT-02A's `WALL_TOP_SOFFIT_CONTACT`).
 */
export type ContactKind = 'JUNCTION' | 'ROOF_SOFFIT'

export type WallDiagnosticCode =
  | 'DUPLICATE_WALL_ID'
  | 'DUPLICATE_OPENING_ID'
  | 'DUPLICATE_GLAZING_ID'
  | 'UNKNOWN_HOST_WALL'
  | 'NON_ORTHONORMAL_AXES'
  | 'INVALID_WALL_DIMENSION'
  | 'INVALID_OPENING_DIMENSION'
  | 'OPENING_OUTSIDE_HOST'
  | 'OPENING_TOUCHES_WALL_EDGE'
  | 'OVERLAPPING_OPENINGS'
  | 'UNKNOWN_GLAZING_OPENING'
  | 'GLAZING_OUTSIDE_THICKNESS'
  | 'INVALID_WALL_EXTENT'
  | 'OPENING_IN_TRIMMED_ZONE'
  | 'INVALID_WALL_PROFILE'
  | 'OPENING_ABOVE_WALL_PROFILE'
  | 'TOO_MANY_OPENINGS_ON_PROFILED_WALL'
  | 'WALL_TOP_PLANE_UNCROSSABLE'
  | 'WALL_TOP_BELOW_BASE'

export type WallDiagnostic = {
  code: WallDiagnosticCode
  /** ERROR: the element was not compiled. WARNING: compiled, but read this. */
  severity: 'ERROR' | 'WARNING'
  message: string
  wallId?: string
  openingId?: string
  glazingId?: string
}

/** What each wall actually contributed, so a caller can audit the result. */
export type CompiledWall = {
  wallId: string
  /** Openings that were cut, in input order. */
  openingIds: string[]
  triCount: number
}

/**
 * The span of a wall's own length that is actually emitted.
 *
 * A wall's `lengthM` is its **nominal** extent and never changes: it is what the
 * drawing says, it is what openings are measured against, and it is an input
 * that no compiler is allowed to rewrite. But where two walls butt at a corner,
 * one of them must stop short so the corner material is emitted once rather
 * than twice. That shortening is a property of the *compilation*, not of the
 * wall, so it lives here and nowhere near `WallSpec`.
 *
 * `a0` and `a1` are in the wall's own `u` coordinate, on the same axis as
 * `OpeningSpec.offsetM`. Absent, a wall compiles over its full `0..lengthM`,
 * which is exactly what STAGE WEB-PIVOT-01 does — an extent of `{a0: 0, a1:
 * lengthM}` is not a special case, it is the default written down.
 *
 * Because the interval is stated in the *original* coordinate, an opening keeps
 * the offset it was given. Nothing is renormalised: an opening at 1.5 m is at
 * 1.5 m whether the wall's first 0.45 m is emitted or not.
 */
export type WallExtent = {
  /** First emitted position along `u`. */
  a0: number
  /** Last emitted position along `u`. */
  a1: number
  /** Contact id for the end face at `a0`, when that end abuts another wall. */
  a0ContactId?: string
  /** Contact id for the end face at `a1`, when that end abuts another wall. */
  a1ContactId?: string
}

export type CompileResult = {
  tris: CompiledTri[]
  walls: CompiledWall[]
  diagnostics: WallDiagnostic[]
}

/** The wall's orthonormal triad. `n` is outward. */
export const wallFrame = (w: WallSpec): { u: Vec3; up: Vec3; n: Vec3 } => ({
  u: w.u,
  up: w.up,
  n: {
    x: w.u.y * w.up.z - w.u.z * w.up.y,
    y: w.u.z * w.up.x - w.u.x * w.up.z,
    z: w.u.x * w.up.y - w.u.y * w.up.x,
  },
})

/**
 * Wall-local (a along u, b along up, c inward from the outer face) to WORLD.
 *
 * Every emitted vertex goes through this one function. Two faces that share an
 * edge therefore compute that edge from identical local values and land on
 * bit-identical world coordinates — which is what lets the manifold oracle
 * compare vertices exactly instead of within a tolerance.
 */
export function wallPoint(w: WallSpec, a: number, b: number, c: number): Vec3 {
  const f = wallFrame(w)
  return {
    x: w.origin.x + f.u.x * a + f.up.x * b - f.n.x * c,
    y: w.origin.y + f.u.y * a + f.up.y * b - f.n.y * c,
    z: w.origin.z + f.u.z * a + f.up.z * b - f.n.z * c,
  }
}
