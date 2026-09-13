/**
 * Bounded source-fetch policy (§8). This module only *decides*; the actual I/O
 * lives in an adapter (src/node/fetch-adapter.ts). Keeping the policy pure means
 * it is unit-testable and ports to Android unchanged.
 *
 * Explicitly not an open proxy: the allowlist is a closed set of ARCHON hosts.
 */

export type FetchPolicy = {
  allowedHosts: readonly string[]
  maxRedirects: number
  maxHtmlBytes: number
  maxImageBytes: number
  maxAssets: number
  concurrency: number
  timeoutMs: number
  allowedImageTypes: readonly string[]
}

export const ARCHON_POLICY: FetchPolicy = {
  // All four are ARCHON's own hosts. `cdn1` was added in STAGE WEB-PIVOT-03:
  // the publisher's public render-lightbox endpoint serves its large copies
  // from there, and a host allowlist that excludes it silently turns official
  // material into a download failure.
  allowedHosts: ['www.archon.pl', 'archon.pl', 'assets.archon.pl', 'cdn1.archon.pl'],
  maxRedirects: 3,
  maxHtmlBytes: 8 * 1024 * 1024,
  maxImageBytes: 12 * 1024 * 1024,
  maxAssets: 40,
  concurrency: 4,
  timeoutMs: 30_000,
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
}

export type PolicyVerdict = { allowed: true } | { allowed: false; reason: string }

export function checkUrl(raw: string, policy: FetchPolicy): PolicyVerdict {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { allowed: false, reason: `unparseable URL: ${raw}` }
  }
  if (url.protocol !== 'https:') return { allowed: false, reason: `non-HTTPS scheme: ${url.protocol}` }
  if (url.username || url.password) return { allowed: false, reason: 'embedded credentials rejected' }
  const host = url.hostname.toLowerCase()
  if (!policy.allowedHosts.includes(host)) return { allowed: false, reason: `host not on allowlist: ${host}` }
  if (url.port && url.port !== '443') return { allowed: false, reason: `non-default port: ${url.port}` }
  return { allowed: true }
}

/**
 * A redirect is re-validated against the same allowlist, so an allowlisted host
 * cannot be used to bounce the fetcher to an arbitrary origin.
 */
export function checkRedirect(from: string, to: string, policy: FetchPolicy, hop: number): PolicyVerdict {
  if (hop > policy.maxRedirects) return { allowed: false, reason: `redirect budget exhausted after ${hop} hops` }
  const verdict = checkUrl(to, policy)
  if (!verdict.allowed) return { allowed: false, reason: `redirect from ${from} blocked: ${verdict.reason}` }
  return { allowed: true }
}

export function checkResponse(
  contentType: string | null,
  byteLength: number,
  kind: 'html' | 'image',
  policy: FetchPolicy,
): PolicyVerdict {
  const limit = kind === 'html' ? policy.maxHtmlBytes : policy.maxImageBytes
  if (byteLength > limit) return { allowed: false, reason: `response ${byteLength}B exceeds ${limit}B limit` }
  if (kind === 'image' && contentType) {
    const base = contentType.split(';')[0].trim().toLowerCase()
    if (!policy.allowedImageTypes.includes(base)) return { allowed: false, reason: `image type not allowed: ${base}` }
  }
  return { allowed: true }
}
