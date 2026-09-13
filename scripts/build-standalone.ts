/**
 * Embed source packages in the standalone web build — STAGE WEB-PIVOT-03.
 *
 * The browser app cannot fetch archon.pl: the site sends no CORS headers, and
 * the fetch policy — host allowlist, per-hop redirect revalidation, size caps,
 * bounded concurrency — is enforced by the Node adapter, which is where a live
 * fetch belongs. So the source travels with the build.
 *
 * ## What changed in this stage
 *
 * This script used to re-parse the project's HTML and publish whatever the
 * markup named. The Node loader, meanwhile, probed for larger copies and
 * analysed those. The two disagreed — the CLI read the 1138x854 section
 * original, the hosted build read the 400x300 page thumbnail — and nothing in
 * either output said so.
 *
 * It now embeds a `SourcePackage` built by the one authoritative builder, or
 * reuses the manifest `npm run source:package` already wrote, and publishes the
 * bytes of exactly the copies that package selected. There is no parser here,
 * no filename matching and no choice left to make: the browser receives the
 * same package the CLI analysed, and can prove it by hashing it.
 *
 * Two channels, chosen for what a restrictive host will actually allow:
 *
 *  - the manifest is **inlined** into the bundle as a JSON string, so no
 *    request is needed to read it;
 *  - the images are emitted as ordinary files next to the bundle and loaded
 *    through `<img>`, which is a plain image load rather than a scripted fetch.
 *
 * Nothing is resampled or re-encoded: the bytes written here are the bytes the
 * publisher served.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSourcePackage } from '../src/node/source-package.js'
import {
  assetFileName,
  packageDir,
  packageExists,
  readPackage,
  writePackage,
} from '../src/node/package-store.js'
import { canonicalJson } from '../src/core/util/hash.js'
import { projectByKey, PROJECTS, type DevProject } from '../src/node/projects.js'
import type { SourcePackage } from '../src/core/contracts/source-package.js'

const OUT_ASSETS = 'dist-standalone-src/assets'
const OUT_TS = 'src/web/bundled/index.ts'

const keys = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const online = process.argv.includes('--online')
const wanted = (keys.length > 0 ? keys : ['A']).map((k) => {
  const p = projectByKey(k)
  if (!p) throw new Error(`unknown project ${k}; known: ${PROJECTS.map((x) => x.key).join(', ')}`)
  return p
})

await rm('dist-standalone-src', { recursive: true, force: true })
await mkdir(OUT_ASSETS, { recursive: true })
await mkdir('src/web/bundled', { recursive: true })

/**
 * The package for one project, built once and reused.
 *
 * A manifest on disk is used verbatim rather than rebuilt, so that "the CLI and
 * the hosted build analysed the same package" is a statement about one file.
 */
async function packageFor(project: DevProject): Promise<SourcePackage> {
  if (await packageExists(project.slug)) return readPackage(project.slug)
  const cacheDir = `fixtures/${project.slug}/assets`
  const { pkg } = await buildSourcePackage(project.url, {
    cacheDir,
    htmlPath: online ? undefined : `fixtures/${project.slug}/page.html`,
    offline: !online,
  })
  await writePackage(project.slug, pkg, cacheDir)
  return pkg
}

type BundledProject = {
  key: string
  slug: string
  name: string
  url: string
  projectId: string
  packageId: string
  packageHash: string
  /** Published file name per assetId, for the assets that travel with the build. */
  files: Array<[string, string]>
  manifest: string
}

const bundled: BundledProject[] = []

for (const project of wanted) {
  const pkg = await packageFor(project)
  const files: Array<[string, string]> = []
  let bytes = 0
  for (const a of pkg.assets) {
    // Only the copies the analysis needs travel with the build. The rest stay
    // in the manifest as the record of what exists; publishing 20 MB of
    // interior renders the analyzer never opens would help nobody.
    if (!a.analysable || !a.contentHash) continue
    const name = assetFileName(a.contentHash, a.mediaType)
    const data = await readFile(join(packageDir(project.slug), 'assets', name))
    await writeFile(join(OUT_ASSETS, name), data)
    files.push([a.assetId, name])
    bytes += data.byteLength
  }
  bundled.push({
    key: project.key,
    slug: project.slug,
    name: project.name,
    url: project.url,
    projectId: pkg.projectId,
    packageId: pkg.packageId,
    packageHash: pkg.contentHash,
    files,
    // The same canonical serialisation the manifest on disk uses, so the two
    // are byte-identical and the browser's hash check is a real check.
    manifest: canonicalJson({ ...pkg, origin: 'PREBUILT_BUNDLE' }),
  })
  console.log(
    `${project.key} ${project.name}: package ${pkg.packageId}, ` +
      `${files.length}/${pkg.assets.length} assets published, ${(bytes / 1e6).toFixed(2)} MB`,
  )
}

const literal = (s: string): string => JSON.stringify(s)

const source = `/**
 * GENERATED by scripts/build-standalone.ts — do not edit.
 *
 * The source packages that travel with the standalone web build. Each manifest
 * is the JSON the Node builder sealed, inlined verbatim; the images sit beside
 * the bundle, named by their own content hash.
 *
 * Nothing here re-derives an asset list. The browser analyses the package it is
 * given and checks its seal before it starts.
 */
import type { SourcePackage } from '../../core/contracts/source-package.js'

export type BundledPackage = {
  key: string
  slug: string
  name: string
  url: string
  projectId: string
  packageId: string
  packageHash: string
  /** Published file name per assetId. */
  files: Array<[string, string]>
  /** The sealed manifest, as canonical JSON. */
  manifest: string
}

export const BUNDLED_PACKAGES: BundledPackage[] = [
${bundled
  .map(
    (p) => `  {
    key: ${literal(p.key)},
    slug: ${literal(p.slug)},
    name: ${literal(p.name)},
    url: ${literal(p.url)},
    projectId: ${literal(p.projectId)},
    packageId: ${literal(p.packageId)},
    packageHash: ${literal(p.packageHash)},
    files: ${JSON.stringify(p.files)},
    manifest: ${literal(p.manifest)},
  },`,
  )
  .join('\n')}
]

/** Parse a bundled manifest into the contract. */
export const manifestOf = (p: BundledPackage): SourcePackage => JSON.parse(p.manifest) as SourcePackage

/** Match a pasted URL to a bundled package by ARCHON project code. */
export const bundledFor = (url: string): BundledPackage | undefined => {
  const trimmed = url.trim().replace(/[?#].*$/, '').replace(/\\/$/, '')
  const code = trimmed.slice(trimmed.lastIndexOf('-') + 1)
  return BUNDLED_PACKAGES.find((p) => p.projectId === code || p.url === trimmed)
}
`
await writeFile(OUT_TS, source, 'utf8')
console.log(`wrote ${OUT_TS} (${(source.length / 1e6).toFixed(2)} MB) and ${OUT_ASSETS}`)
