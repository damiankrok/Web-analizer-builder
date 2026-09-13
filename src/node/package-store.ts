/**
 * Reading and writing a SourcePackage on disk — STAGE WEB-PIVOT-03.
 *
 * One directory per project:
 *
 *     out/source-packages/<slug>/manifest.json      the sealed package
 *     out/source-packages/<slug>/assets/<hash>.<ext>  bytes, named by content
 *
 * Assets are named by their own content hash rather than by their published
 * filename, which is what makes the layout portable: the standalone build
 * publishes the same names beside its page, and the browser loads an asset by
 * asking for the hash the manifest gave it. Nothing downstream matches on a
 * filename, so nothing downstream can match on the wrong one.
 *
 * NODE_ONLY.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SourcePackage } from '../core/contracts/source-package.js'
import { assetFileNameFor, packageSealIntact, sealPackage } from '../core/contracts/source-package.js'
import { canonicalJson } from '../core/util/hash.js'
import { cachePathFor } from './fetch-adapter.js'

export const PACKAGE_ROOT = 'out/source-packages'

export const packageDir = (slug: string): string => join(PACKAGE_ROOT, slug)

/**
 * Published file name for an asset's bytes.
 *
 * Re-exported from the portable contract rather than reimplemented: the browser
 * computes the same name to ask for the same file, and two implementations of
 * one naming rule is one implementation too many.
 */
export const assetFileName = assetFileNameFor

/**
 * Write the manifest and the bytes of every asset that carries any.
 *
 * The bytes come from the fetch cache, addressed by the same URL-derived key
 * the adapter stored them under, so nothing is re-encoded and the published
 * file is byte-identical to what the publisher served.
 */
export async function writePackage(
  slug: string,
  pkg: SourcePackage,
  cacheDir: string,
): Promise<{ dir: string; assetFiles: number; bytes: number }> {
  const dir = packageDir(slug)
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, 'assets'), { recursive: true })
  let assetFiles = 0
  let bytes = 0
  for (const a of pkg.assets) {
    if (!a.contentHash || a.byteLength === 0) continue
    const src = cachePathFor(cacheDir, a.selectedUrl, '.bin')
    let data: Buffer
    try {
      data = await readFile(src)
    } catch {
      continue
    }
    await writeFile(join(dir, 'assets', assetFileName(a.contentHash, a.mediaType)), data)
    assetFiles++
    bytes += data.byteLength
  }
  await writeFile(join(dir, 'manifest.json'), `${canonicalJson(pkg)}\n`, 'utf8')
  return { dir, assetFiles, bytes }
}

/**
 * Read a manifest back and check its seal.
 *
 * A package whose stored hash does not match its content has been edited since
 * it was built, and an analysis run against it could not honestly claim to have
 * used the package it names. That is refused rather than repaired.
 */
export async function readPackage(slug: string): Promise<SourcePackage> {
  const text = await readFile(join(packageDir(slug), 'manifest.json'), 'utf8')
  const pkg = JSON.parse(text) as SourcePackage
  if (!packageSealIntact(pkg)) {
    const resealed = sealPackage(pkg)
    throw new Error(
      `source package ${slug} does not match its own hash: manifest says ${pkg.contentHash.slice(0, 16)}, ` +
        `content hashes to ${resealed.contentHash.slice(0, 16)}. Rebuild it with "npm run source:package ${slug}".`,
    )
  }
  return pkg
}

/** Asset bytes published beside a manifest, keyed by the manifest's file names. */
export async function readPackageAssets(slug: string): Promise<Map<string, Uint8Array>> {
  const dir = join(packageDir(slug), 'assets')
  const out = new Map<string, Uint8Array>()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return out
  }
  for (const name of names) out.set(name, new Uint8Array(await readFile(join(dir, name))))
  return out
}

export async function packageExists(slug: string): Promise<boolean> {
  try {
    await readFile(join(packageDir(slug), 'manifest.json'), 'utf8')
    return true
  } catch {
    return false
  }
}
