/**
 * A development-time cache in front of the OCR engine.
 *
 * Tesseract on enlarged crops dominates the wall clock of every extraction
 * run, and the topology work in Stage 06A changes nothing an engine sees: the
 * crops the geometry chooses are a function of the raster and the text
 * detector, neither of which this stage touches. Caching the readings by the
 * exact bytes of the crop therefore returns *the same* readings a live run
 * would, and makes an iteration seconds rather than minutes.
 *
 * It is a script-level tool. Nothing in src/ imports it, no measurement is
 * reported from it that was not also reproduced by a live run, and the freeze
 * and the holdout run through the real engine.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PlanTextCrop,
  PlanTextEngine,
  PlanTextOptions,
  PlanTextReading,
} from '../src/core/extract/text-engine.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'

const keyOf = (crop: PlanTextCrop, opts: PlanTextOptions): string => {
  const h = createHash('sha256')
  h.update(`${crop.gray.width}x${crop.gray.height}|${opts.alphabet}|${opts.singleLine}|`)
  h.update(Buffer.from(crop.gray.data))
  return h.digest('hex').slice(0, 32)
}

export class CachedEngine implements PlanTextEngine {
  private readonly inner = new TesseractEngine()
  private readonly file: string
  private readonly map: Map<string, PlanTextReading[]>
  hits = 0
  misses = 0

  constructor(slug: string) {
    const dir = join('out', 'ocr-cache')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, `${slug}.json`)
    this.map = new Map(
      existsSync(this.file)
        ? (Object.entries(JSON.parse(readFileSync(this.file, 'utf8'))) as Array<[string, PlanTextReading[]]>)
        : [],
    )
  }

  get id(): string {
    return this.inner.id
  }
  get kind(): 'BUILT_IN' | 'LOCAL_LIBRARY' {
    return this.inner.kind
  }
  get version(): string {
    return this.inner.version
  }

  readBatch(crops: readonly PlanTextCrop[], opts: PlanTextOptions): PlanTextReading[] {
    const keys = crops.map((c) => keyOf(c, opts))
    const missing = crops.filter((_, i) => !this.map.has(keys[i]))
    if (missing.length > 0) {
      const fresh = this.inner.readBatch(missing, opts)
      const byCrop = new Map<string, PlanTextReading[]>()
      for (const r of fresh) byCrop.set(r.cropId, [...(byCrop.get(r.cropId) ?? []), r])
      for (const c of missing) this.map.set(keyOf(c, opts), byCrop.get(c.id) ?? [])
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map)), 'utf8')
    }
    this.hits += crops.length - missing.length
    this.misses += missing.length
    const out: PlanTextReading[] = []
    for (let i = 0; i < crops.length; i++) {
      for (const r of this.map.get(keys[i]) ?? []) out.push({ ...r, cropId: crops[i].id })
    }
    return out
  }
}
