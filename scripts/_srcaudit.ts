/** §4 source-resolution audit: what resolutions exist and which is analysed. */
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'

for (const key of process.argv.slice(2)) {
  const project = projectByKey(key)!
  const loaded = await loadSource(project.url, {
    cacheDir: `fixtures/${project.slug}/assets`,
    htmlPath: `fixtures/${project.slug}/page.html`,
  })
  console.log(`\n=== ${project.key} ${project.name}`)
  console.log('| Asset | Role | Page px | Analysed px | Variant used | Used for OCR? |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const a of [...loaded.pkg.assets].sort((p, q) => p.role.localeCompare(q.role))) {
    const img = loaded.images.get(a.id)
    const page = a.variants?.find((v) => v.kind === 'PAGE')
    const used = a.variants?.find((v) => v.url === a.url)
    const ocr = /^(PLAN|SECTION|ELEVATION|SITE)/.test(a.role)
    console.log(
      `| ${a.id.slice(-6)} | ${a.role} | ${page?.width ?? '?'}x${page?.height ?? '?'} | ` +
        `${img ? `${img.width}x${img.height}` : 'n/a'} | ${used?.kind ?? '?'}${(a.variants?.length ?? 0) > 1 ? ' (upgraded)' : ''} | ${ocr ? 'yes' : 'no'} |`,
    )
  }
}
