/**
 * Turn the standalone build into an artifact page.
 *
 * The host wraps the page in its own document skeleton, so what it wants is
 * the *content* — no doctype, no html/head/body of our own — with the bundle
 * and stylesheet referenced by relative path. The hashed filenames come from
 * the build so the two cannot drift.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'

const built = await readFile('dist-standalone/index.html', 'utf8')
const js = built.match(/src="\.\/(assets\/index-[^"]+\.js)"/)?.[1]
const css = built.match(/href="\.\/(assets\/style-[^"]+\.css)"/)?.[1]
if (!js || !css) throw new Error('could not find the bundle or stylesheet in dist-standalone/index.html')

const files = (await readdir('dist-standalone/assets')).sort()

// The build this page came from, so the owner can tell at a glance whether the
// preview matches the branch they are reading on GitHub.
const { execFileSync } = await import('node:child_process')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()

const page = `<title>Marcowki Analyzer</title>
<link rel="stylesheet" href="${css}" />
<style>
  /* Provenance strip. Self-contained and explicitly coloured so it holds on
     whichever ground the host paints behind the page. */
  .build-strip {
    margin: 0;
    padding: 10px 16px;
    background: #1c1f24;
    color: #d8d4cc;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    align-items: baseline;
  }
  .build-strip b { color: #fff; font-weight: 600; }
  .build-strip a { color: #8fc3ff; }
  .build-strip .note { color: #a09a90; }
</style>
<p class="build-strip">
  <b>${branch}</b>
  <span>${sha.slice(0, 12)}</span>
  <span class="note">cached ARCHON source travels with this build \u00b7 drawings and renders \u00a9 ARCHON+</span>
</p>
<div id="root">
  <noscript style="display:block;padding:16px;font:14px/1.5 system-ui">
    This page runs the analyzer in your browser, so it needs JavaScript enabled.
  </noscript>
</div>
<script type="module" src="${js}"></script>
`
await writeFile('dist-standalone/artifact.html', page, 'utf8')
console.log(`wrote dist-standalone/artifact.html referencing ${js} and ${css}`)
console.log(`${files.length} supporting files:`)
for (const f of files) console.log(`  assets/${f}`)
