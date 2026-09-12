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
export type OpeningSpec = {
  id: string
  hostWallId: string
  /** Distance along `u` from the wall origin to the opening's near edge. */
  offsetM: number
  /** Height above the wall base to the sill. */
  sillM: number
  widthM: number
  heightM: number
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
}

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
