/**
 * A local Tesseract adapter behind the Stage-06 text seam — §6.
 *
 * ## Why this engine
 *
 * Measured on project A's two dimensioned floor plans, over the *same* crops
 * the geometry stage chooses, the hand-authored recogniser names five tokens
 * and none of them is a number the drawings print. Tesseract, given the same
 * crops, reads the drawing's own numbers. The measurement is in
 * `scripts/ocr-benchmark.ts` and its result is quoted in the stage report.
 *
 * Tesseract was chosen over PaddleOCR and Surya on portability, not accuracy:
 * it is a C++ library with no Python or GPU runtime, it is packaged for every
 * platform this project cares about, and — the point that decides it for a
 * codebase with a Kotlin port ahead of it — the same engine and the same
 * `traineddata` files run on Android through Tesseract4Android. A Python
 * adapter would have to be replaced wholesale on the phone.
 *
 * ## What this is not
 *
 * It is not geometry authority. It receives boxes the dimension geometry has
 * already decided are labels, and returns strings and confidences. It never
 * sees the drawing as a whole, is never asked where anything is, and cannot
 * create a constraint: an unowned number is not a measurement (§7).
 *
 * ## How it is isolated
 *
 *   - it is reached only through `PlanTextEngine`, so the portable core never
 *     imports it;
 *   - it spawns a local binary and writes only into a caller-named directory;
 *   - it never touches the network. Tesseract has no network code, and the
 *     adapter passes it no URL. Remote OCR is forbidden (§6);
 *   - when the binary is absent the engine reports itself unavailable instead
 *     of throwing, so a checkout without Tesseract still runs the suite.
 *
 * ## Android portability
 *
 * `Tesseract4Android` (or `tess-two`) exposes `TessBaseAPI` with the same page
 * segmentation modes and the same character whitelist used here, and consumes
 * the same `eng.traineddata`. Porting is replacing `execFileSync` with the JNI
 * call and keeping the batching, the `--psm` choice and the confidence scaling
 * below; the pixel conditioning is already in portable core
 * (`src/core/extract/raster-normalize.ts`).
 *
 * NODE_ONLY.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import type { GrayImage } from '../../core/contracts/raster.js'
import type {
  EngineAvailability,
  PlanTextCrop,
  PlanTextEngine,
  PlanTextOptions,
  PlanTextReading,
} from '../../core/extract/text-engine.js'

export type TesseractOptions = {
  /** Binary to run. */
  binary: string
  /**
   * Page segmentation mode.
   *
   * 7 is "a single line of text", which is what a dimension label is once the
   * geometry stage has cut it out and the crop pipeline has turned it upright.
   * Modes that ask Tesseract to find the text itself are the wrong tool here:
   * finding it is the geometry stage's job, and §7 forbids handing the engine
   * a whole plan and hoping.
   */
  psm: string
  /** Directory the batch's PNGs are written to. Removed afterwards. */
  workDir: string
  /** Character height the crops are enlarged towards. */
  targetTextPx: number
  /** Hard cap on enlargement, so a large source is not blown up pointlessly. */
  maxScale: number
}

export const DEFAULT_TESSERACT: TesseractOptions = {
  binary: 'tesseract',
  psm: '7',
  workDir: 'out/.ocr',
  targetTextPx: 64,
  maxScale: 10,
}

const writeGrayPng = (gray: GrayImage, path: string): void => {
  const png = new PNG({ width: gray.width, height: gray.height })
  for (let i = 0; i < gray.width * gray.height; i++) {
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = gray.data[i]
    png.data[i * 4 + 3] = 255
  }
  writeFileSync(path, PNG.sync.write(png))
}

/** Ask the binary for its version, or say why it could not be asked. */
export function probeTesseract(opts: Partial<TesseractOptions> = {}): EngineAvailability {
  const o = { ...DEFAULT_TESSERACT, ...opts }
  try {
    const out = execFileSync(o.binary, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const first = out.split('\n')[0].trim()
    return { engineId: 'tesseract', available: true, version: first, note: '' }
  } catch (err) {
    return {
      engineId: 'tesseract',
      available: false,
      version: 'unknown',
      note: `could not run \`${o.binary} --version\`: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Batched Tesseract.
 *
 * Every crop in the batch is written as a PNG, the paths are listed in a file,
 * and Tesseract is run once over the list with TSV output. The `page_num`
 * column is the index into the list, which is how a reading finds its crop.
 * One call over 145 crops costs about 2.6 s where 145 calls cost 20 s, and
 * almost all of the difference is process start-up.
 */
export class TesseractEngine implements PlanTextEngine {
  readonly id = 'tesseract'
  readonly kind = 'LOCAL_LIBRARY' as const
  readonly version: string
  private readonly opts: TesseractOptions

  constructor(opts: Partial<TesseractOptions> = {}) {
    this.opts = { ...DEFAULT_TESSERACT, ...opts }
    this.version = probeTesseract(this.opts).version
  }

  static available(opts: Partial<TesseractOptions> = {}): EngineAvailability {
    return probeTesseract(opts)
  }

  readBatch(crops: readonly PlanTextCrop[], opts: PlanTextOptions): PlanTextReading[] {
    if (crops.length === 0) return []
    const dir = this.opts.workDir
    mkdirSync(dir, { recursive: true })
    const paths: string[] = []
    try {
      for (let i = 0; i < crops.length; i++) {
        const p = join(dir, `crop-${String(i).padStart(5, '0')}.png`)
        writeGrayPng(crops[i].gray, p)
        paths.push(p)
      }
      const listPath = join(dir, 'batch.txt')
      writeFileSync(listPath, `${paths.join('\n')}\n`, 'utf8')

      const args = [listPath, 'stdout', '--psm', opts.singleLine ? this.opts.psm : '6']
      if (opts.alphabet) args.push('-c', `tessedit_char_whitelist=${opts.alphabet}`)
      args.push('tsv')
      let tsv: string
      try {
        tsv = execFileSync(this.opts.binary, args, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 256e6,
        })
      } catch {
        // A failed batch is "this engine read nothing", not a crash: the
        // pipeline reports an empty reading set and the audit says why.
        return []
      }
      return this.parseTsv(tsv, crops)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * TSV to readings.
   *
   * Tesseract reports confidence as a percentage and uses -1 for "no word".
   * It is scaled to 0..1 here and clamped, because the seam promises 0..1 and
   * because a confidence of exactly 1 would claim certainty this engine never
   * has at this glyph size.
   */
  private parseTsv(tsv: string, crops: readonly PlanTextCrop[]): PlanTextReading[] {
    const out: PlanTextReading[] = []
    const lines = tsv.split('\n')
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split('\t')
      if (c.length < 12) continue
      const text = c[11].trim()
      if (text === '') continue
      const page = Number(c[1]) // 0-based index into the batch list
      const crop = crops[page]
      if (!crop) continue
      const conf = Number(c[10])
      const left = Number(c[6])
      const top = Number(c[7])
      const width = Number(c[8])
      const height = Number(c[9])
      out.push({
        cropId: crop.id,
        text: text.replace(/\s+/g, ''),
        confidence: Number.isFinite(conf) ? Math.max(0, Math.min(0.99, conf / 100)) : 0,
        boxInCrop:
          Number.isFinite(left) && Number.isFinite(top)
            ? { x0: left, y0: top, x1: left + width, y1: top + height }
            : null,
        engineId: this.id,
      })
    }
    return out
  }
}
