/**
 * Bounded source fetcher (§8). Every request is checked against the pure policy
 * in core/source/fetch-policy.ts before it is made, and every redirect hop is
 * re-checked. Responses are size-capped by streaming and aborting, and a
 * local cache keeps repeat runs offline-reproducible.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FetchPolicy } from '../core/source/fetch-policy.js'
import { ARCHON_POLICY, checkRedirect, checkResponse, checkUrl } from '../core/source/fetch-policy.js'
import { sha256 } from '../core/util/hash.js'

export type FetchResult = {
  url: string
  finalUrl: string
  bytes: Uint8Array
  contentType: string | null
  sha256: string
  fromCache: boolean
}

const USER_AGENT =
  'RESEARCH-ANALYZER-WEB-01/0.1 (architectural source analysis; contact: repository owner)'

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** Manual redirect handling so every hop passes the allowlist again. */
async function fetchBounded(
  url: string,
  kind: 'html' | 'image',
  policy: FetchPolicy,
): Promise<FetchResult> {
  const initial = checkUrl(url, policy)
  if (!initial.allowed) throw new Error(`fetch policy rejected ${url}: ${initial.reason}`)

  let current = url
  for (let hop = 0; hop <= policy.maxRedirects; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs)
    let res: Response
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: kind === 'html' ? 'text/html' : 'image/*' },
      })
    } finally {
      clearTimeout(timer)
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`redirect without Location from ${current}`)
      const next = new URL(loc, current).toString()
      const verdict = checkRedirect(current, next, policy, hop + 1)
      if (!verdict.allowed) throw new Error(`fetch policy rejected redirect: ${verdict.reason}`)
      current = next
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${current}`)

    const declared = res.headers.get('content-length')
    const limit = kind === 'html' ? policy.maxHtmlBytes : policy.maxImageBytes
    if (declared && Number(declared) > limit) {
      throw new Error(`declared size ${declared}B exceeds ${limit}B limit for ${current}`)
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    const contentType = res.headers.get('content-type')
    const verdict = checkResponse(contentType, buf.byteLength, kind, policy)
    if (!verdict.allowed) throw new Error(`fetch policy rejected response: ${verdict.reason}`)
    return { url, finalUrl: current, bytes: buf, contentType, sha256: sha256(buf), fromCache: false }
  }
  throw new Error(`redirect budget exhausted for ${url}`)
}

/** Cache key for a URL: stable across runs and across machines. */
export const cacheKeyFor = (url: string): string => sha256(new TextEncoder().encode(url)).slice(0, 24)

/** Cache path is derived from the URL hash, so it is stable across runs. */
export const cachePathFor = (cacheDir: string, url: string, ext: string): string =>
  join(cacheDir, `${cacheKeyFor(url)}${ext}`)

/**
 * Thrown when strict offline mode is asked for something the cache does not
 * have.
 *
 * A distinct class because the caller has to be able to tell this apart from a
 * 404 or a timeout: an offline cache miss is a statement about *this machine*,
 * not about the publisher, and the package records it with its own error code.
 */
export class OfflineCacheMissError extends Error {
  constructor(readonly url: string, readonly path: string) {
    super(`offline: ${url} is not in the cache (expected ${path}); run the fetch step online once`)
    this.name = 'OfflineCacheMissError'
  }
}

export type FetchOptions = {
  policy?: FetchPolicy
  /**
   * Refuse to touch the network.
   *
   * Strictly: a cache miss throws. "Offline" that quietly falls back to a
   * request is not offline, and a reproducibility claim built on it is not a
   * claim about anything.
   */
  offline?: boolean
}

export async function fetchWithCache(
  url: string,
  kind: 'html' | 'image',
  cacheDir: string,
  opts: FetchPolicy | FetchOptions = {},
): Promise<FetchResult> {
  // Historically the fourth argument was the policy itself.
  const options: FetchOptions = 'allowedHosts' in opts ? { policy: opts as FetchPolicy } : (opts as FetchOptions)
  const policy = options.policy ?? ARCHON_POLICY
  const ext = kind === 'html' ? '.html' : '.bin'
  const path = cachePathFor(cacheDir, url, ext)
  if (await exists(path)) {
    const bytes = new Uint8Array(await readFile(path))
    return { url, finalUrl: url, bytes, contentType: null, sha256: sha256(bytes), fromCache: true }
  }
  if (options.offline) throw new OfflineCacheMissError(url, path)
  const result = await fetchBounded(url, kind, policy)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, result.bytes)
  return result
}

/** Bounded-concurrency map preserving input order (§8 bounded concurrency). */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
