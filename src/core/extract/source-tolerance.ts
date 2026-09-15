/**
 * How well a number is known, from the drawing it was read on — §29.
 *
 * §29 forbids one hardcoded centimetre threshold across plans, sections and
 * elevations, and it is right to: a plan of this house is drawn at 37.8 px per
 * metre and its section at 72.5, so one pixel is 2.6 cm on the first and 1.4 cm
 * on the second, and a tolerance that is generous on one is impossible on the
 * other. Worse, an elevation registered through two anchors carries the error
 * of that registration on top of its own resolution, and nothing about the
 * elevation's pixel size says so.
 *
 * So a tolerance is built from three things and reports all three:
 *
 *   1. the drawing's own resolution — how many metres a pixel is;
 *   2. how well the feature was localised *on* that drawing, in pixels;
 *   3. the residual of whatever registration put it in metres.
 *
 * A printed dimension gets none of this, and that is the point of keeping the
 * two apart (§29's last line): `+3,06` is 3.06 m exactly, and the only
 * uncertainty is whether it was read correctly, which is a confidence and not
 * a tolerance.
 *
 * PORT_DIRECT (Kotlin).
 */

export type SourceTolerance = {
  /** Metres per pixel on the drawing this was read from. */
  metresPerPixel: number
  /** How well the feature was localised, in that drawing's pixels. */
  localisationPx: number
  /** Metres of error the registration itself contributes. */
  registrationM: number
  /** The tolerance to use, metres. */
  toleranceM: number
  /** Why it is what it is, in numbers a reader can check. */
  why: string
}

/**
 * Build a tolerance from a drawing's scale and a localisation.
 *
 * The two contributions are added in quadrature because they are independent:
 * a fitted edge's residual on the raster has nothing to do with how well the
 * datum solver placed the zero.
 */
export function sourceTolerance(
  pixelsPerMetre: number,
  localisationPx: number,
  registrationM: number,
  what: string,
): SourceTolerance {
  const metresPerPixel = pixelsPerMetre > 0 ? 1 / pixelsPerMetre : Number.POSITIVE_INFINITY
  const fromRaster = metresPerPixel * Math.max(0.5, localisationPx)
  const toleranceM = Math.sqrt(fromRaster ** 2 + Math.max(0, registrationM) ** 2)
  return {
    metresPerPixel,
    localisationPx,
    registrationM,
    toleranceM,
    why:
      `${what}: one pixel is ${(metresPerPixel * 1000).toFixed(1)} mm on this drawing, the feature is localised to ` +
      `${localisationPx.toFixed(1)} px (${(fromRaster * 1000).toFixed(0)} mm) and the registration contributes ` +
      `${(registrationM * 1000).toFixed(0)} mm, giving ${(toleranceM * 1000).toFixed(0)} mm`,
  }
}

/** A printed value the pipeline read: exact, with no spatial tolerance at all. */
export const printedTolerance = (what: string): SourceTolerance => ({
  metresPerPixel: 0,
  localisationPx: 0,
  registrationM: 0,
  // Not zero: the publisher printed two decimals, so the value is stated to
  // the centimetre and nothing finer is claimed on its behalf.
  toleranceM: 0.005,
  why: `${what}: a value the drawing prints, stated to the centimetre. It was read, not measured, so it carries no raster tolerance`,
})
