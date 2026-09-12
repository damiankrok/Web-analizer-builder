/**
 * Debug UI (§44). Mobile-friendly panels, functionality over polish.
 *
 * The analyzer runs in a worker over the cached source assets, so this is the
 * real pipeline rather than a viewer for precomputed output.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Viewer, type ViewerEdge, type ViewerTri } from './Viewer.js'

type Progress = { stage: string; detail?: string }

type Result = {
  exports: Record<string, unknown>
  audit: { entries: AuditEntry[]; summary: Record<string, number>; conflicts: unknown[] }
  printed?: PrintedResult
  geometry: { tris: ViewerTri[]; edges: ViewerEdge[]; quantities: Record<string, number> }
  views: ViewEntry[]
  performance: Record<string, number>
}

/** What the printed-dimension stage reports (WEB-02 §31). */
type PrintedResult = {
  resolution: Array<{
    assetId: string
    role: string
    pagePx: { width: number; height: number } | null
    analysedPx: { width: number; height: number }
    variant: string
    upgraded: boolean
    usedForText: boolean
  }>
  alphabet: string
  harvestedPositions: number
  harvestedLabels: number
  scales: Array<{ assetId: string; role: string; pixelsPerMetre: number }>
  dimensions: Array<{
    id: string
    role: string
    kind: string
    text: string
    metres: number | null
    fidelity: string
    lengthPx: number
    confidence: number
    note: string
  }>
  notes: string[]
}

type ResolvedGeometry = {
  openingGroups: Array<{
    id: string
    facade: string
    kind: string
    widthM: number
    heightM: number
    sillY: number
    panelCount: number
    clippedByRoof: boolean
    memberIds: string[]
  }>
  appearance: Array<{
    id: string
    kind: string
    widthM?: number
    heightM?: number
    world?: { x: number; y: number; z: number }
    confidence: number
  }>
}

/**
 * The resolved geometry, read out of the export bundle.
 *
 * The UI deliberately shows what was *exported* rather than a parallel view of
 * the same data: a panel that disagrees with the export would hide exactly the
 * kind of bug it exists to surface.
 */
const EMPTY_GEOMETRY: ResolvedGeometry = { openingGroups: [], appearance: [] }
const geometryOf = (result: Result): ResolvedGeometry =>
  (result.exports['resolved-building-geometry.json'] as ResolvedGeometry | undefined) ?? EMPTY_GEOMETRY

type AuditEntry = {
  key: string
  label: string
  unit: string
  value: number | null
  provenance: string
  source: string
  confidence: number
  corroboration: Array<{ source: string; value: number; deltaAbs: number }>
}

type ViewEntry = {
  assetId: string
  role: string
  ambiguity: { ambiguous: boolean; fovDistanceDegenerate: boolean; azimuthSpreadDeg: number; notes: string[] }
  hypotheses: Array<{
    id: string
    confidenceClass: string
    projectionType: string
    fovY?: number
    reprojectionResidual: number
    silhouetteScore: number
    edgeScore: number
    anchorMatches: unknown[]
  }>
  scores: Array<{ total: number; silhouette: number; edge: number; roofline: number; viewWeight: number }>
  notes: string[]
}

const PROJECTS = [
  { key: 'A', slug: 'A-marcowki', name: 'Dom w marcówkach (GE)', url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-marcowkach-ge-m2fa281446a8ca' },
  { key: 'B', slug: 'B-bakopach', name: 'Dom w bakopach (G2E)', url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-bakopach-g2e-mbb9288266b05e' },
  { key: 'C', slug: 'C-holdout', name: 'Dom w kosaćcach 44 (holdout)', url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-kosaccach-44-md3928530c6bf3' },
]

const PART_GROUPS: Array<{ label: string; parts: string[] }> = [
  { label: 'Roof', parts: ['ROOF', 'ROOF_SOFFIT'] },
  { label: 'Walls', parts: ['WALL', 'WALL_INNER', 'REVEAL'] },
  { label: 'Slabs', parts: ['SLAB'] },
  { label: 'Glazing', parts: ['GLAZING', 'RAILING'] },
  { label: 'Features', parts: ['FEATURE'] },
]

export function App(): JSX.Element {
  const [project, setProject] = useState(PROJECTS[0])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [hiddenGroups, setHiddenGroups] = useState<ReadonlySet<string>>(new Set())
  const [repairCycles, setRepairCycles] = useState(2)
  const worker = useRef<Worker | null>(null)

  const run = useCallback(() => {
    setError(null)
    setResult(null)
    setProgress({ stage: 'starting' })
    worker.current?.terminate()
    const w = new Worker(new URL('../web/analyze-worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.kind === 'PROGRESS') setProgress({ stage: m.stage, detail: m.detail })
      else if (m.kind === 'ERROR') {
        setError(m.message)
        setProgress(null)
      } else if (m.kind === 'DONE') {
        setResult(m.payload as Result)
        setProgress(null)
      }
    }
    w.postMessage({ url: project.url, base: `/fixtures/${project.slug}`, maxRepairCycles: repairCycles })
  }, [project, repairCycles])

  useEffect(() => () => worker.current?.terminate(), [])

  const hiddenParts = useMemo(() => {
    const out = new Set<string>()
    for (const g of PART_GROUPS) if (hiddenGroups.has(g.label)) for (const p of g.parts) out.add(p)
    return out
  }, [hiddenGroups])

  const toggle = (label: string): void =>
    setHiddenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

  const verification = result?.exports['self-verification.json'] as
    | { score: Record<string, number>; hardConstraintsSatisfied: boolean; evidence: Record<string, unknown>; cameraConfidence: unknown[] }
    | undefined
  const repair = result?.exports['repair-trace.json'] as { entries: RepairEntry[]; accepted: number; rejected: number } | undefined
  const sourcePackage = result?.exports['source-package.json'] as
    | { identity: { name: string }; assets: Array<{ id: string; role: string; url: string; projection: string; projectionConfidence: number }> }
    | undefined

  return (
    <div className="app">
      <header>
        <h1>Camera-aware multi-view analyzer</h1>
        <p className="sub">ARCHON project page → source package → metric scaffold → cameras → building → repair</p>
      </header>

      <section className="panel">
        <h2>Source</h2>
        <div className="row">
          <select value={project.key} onChange={(e) => setProject(PROJECTS.find((p) => p.key === e.target.value) ?? PROJECTS[0])}>
            {PROJECTS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} — {p.name}
              </option>
            ))}
          </select>
          <label className="inline">
            repair cycles
            <input type="number" min={0} max={4} value={repairCycles} onChange={(e) => setRepairCycles(Number(e.target.value))} />
          </label>
          <button onClick={run} disabled={progress !== null}>
            {progress ? 'Analysing…' : 'Analyse'}
          </button>
        </div>
        <div className="url">{project.url}</div>
        {progress && (
          <div className="progress">
            {progress.stage}
            {progress.detail ? ` — ${progress.detail}` : ''}
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </section>

      {result && (
        <>
          <section className="panel">
            <h2>3D model</h2>
            <div className="row wrap">
              {PART_GROUPS.map((g) => (
                <button key={g.label} className={hiddenGroups.has(g.label) ? 'chip off' : 'chip'} onClick={() => toggle(g.label)}>
                  {hiddenGroups.has(g.label) ? `${g.label} off` : g.label}
                </button>
              ))}
            </div>
            <Viewer tris={result.geometry.tris} edges={result.geometry.edges} hidden={hiddenParts} />
            <div className="quantities">
              {Object.entries(result.geometry.quantities).map(([k, v]) => (
                <span key={k}>
                  <b>{k}</b> {typeof v === 'number' ? v.toFixed(1) : String(v)}
                </span>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Score breakdown</h2>
            {verification && (
              <table>
                <tbody>
                  {Object.entries(verification.score).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{v.toFixed(4)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>hard constraints</td>
                    <td className="num">{verification.hardConstraintsSatisfied ? 'all satisfied' : 'VIOLATED'}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h2>Cameras</h2>
            {result.views.map((v) => (
              <div key={v.assetId} className="camera">
                <div className="camera-head">
                  <b>{v.role}</b>
                  <span className={`badge ${v.hypotheses[0]?.confidenceClass ?? ''}`}>{v.hypotheses[0]?.confidenceClass ?? 'none'}</span>
                  {v.ambiguity.ambiguous && <span className="badge warn">ambiguous</span>}
                </div>
                <div className="small">
                  projection {v.hypotheses[0]?.projectionType} · fov{' '}
                  {v.hypotheses[0]?.fovY ? ((v.hypotheses[0].fovY * 180) / Math.PI).toFixed(1) : '—'}° · anchors{' '}
                  {v.hypotheses[0]?.anchorMatches.length ?? 0} · silhouette {v.scores[0]?.silhouette.toFixed(3)} · edge{' '}
                  {v.scores[0]?.edge.toFixed(3)} · weight {v.scores[0]?.viewWeight}
                </div>
                {v.notes.slice(0, 3).map((n, i) => (
                  <div key={i} className="note">
                    {n}
                  </div>
                ))}
              </div>
            ))}
          </section>

          {/* §31: source resolution — what was available, and what was analysed. */}
          <section className="panel">
            <h2>Source resolution</h2>
            <p className="small">
              The page embeds small copies of the technical drawings and links the originals. Printed
              dimensions are read from whichever copy carries the most real pixels; nothing is upscaled.
            </p>
            <table>
              <thead>
                <tr>
                  <th>asset</th>
                  <th>page</th>
                  <th>analysed</th>
                  <th>variant</th>
                  <th>text?</th>
                </tr>
              </thead>
              <tbody>
                {(result.printed?.resolution ?? []).map((r) => (
                  <tr key={r.assetId}>
                    <td>{r.role}</td>
                    <td className="num">{r.pagePx ? `${r.pagePx.width}\u00d7${r.pagePx.height}` : '\u2014'}</td>
                    <td className="num">
                      {r.analysedPx.width}\u00d7{r.analysedPx.height}
                    </td>
                    <td>
                      <span className={`prov ${r.upgraded ? 'SOURCE_EXACT' : 'GEOMETRIC_INFERRED'}`}>
                        {r.upgraded ? 'upgraded' : 'page'}
                      </span>
                    </td>
                    <td>{r.usedForText ? 'yes' : '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* §31: the dimension panel — reading, owner, fidelity, rejection reason. */}
          <section className="panel">
            <h2>Printed dimensions</h2>
            <p className="small">
              Alphabet learned from the drawings: <code>{result.printed?.alphabet || '\u2014'}</code> from{' '}
              {result.printed?.harvestedPositions ?? 0} certain glyph positions across{' '}
              {result.printed?.harvestedLabels ?? 0} labels. A reading counts only where it also agrees with
              the geometry it annotates.
            </p>
            {(result.printed?.scales ?? []).length > 0 && (
              <p className="small">
                Scales settled from the readings:{' '}
                {(result.printed?.scales ?? []).map((s) => `${s.role} ${s.pixelsPerMetre.toFixed(2)} px/m`).join(' \u00b7 ')}
              </p>
            )}
            <table>
              <thead>
                <tr>
                  <th>source</th>
                  <th>kind</th>
                  <th>read</th>
                  <th>value</th>
                  <th>fidelity</th>
                </tr>
              </thead>
              <tbody>
                {(result.printed?.dimensions ?? []).map((d) => (
                  <tr key={d.id}>
                    <td>{d.role}</td>
                    <td>{d.kind}</td>
                    <td>
                      <code>{d.text}</code>
                      {d.lengthPx > 0 && <span className="small"> /{d.lengthPx.toFixed(0)}px</span>}
                    </td>
                    <td className="num">{d.metres === null ? '\u2014' : `${d.metres.toFixed(3)} m`}</td>
                    <td title={d.note}>
                      <span className={`prov ${d.fidelity}`}>{d.fidelity}</span>
                    </td>
                  </tr>
                ))}
                {(result.printed?.dimensions ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="small">
                      No label was read on this project. The notes below say why.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="notes">
              {(result.printed?.notes ?? []).map((n, i) => (
                <div key={i} className="note">
                  {n}
                </div>
              ))}
            </div>
          </section>

          {/* §31: opening identity — the evidence behind one opening. */}
          <section className="panel">
            <h2>Opening identity</h2>
            <table>
              <thead>
                <tr>
                  <th>facade</th>
                  <th>kind</th>
                  <th>structural</th>
                  <th>sill</th>
                  <th>panels</th>
                  <th>sources</th>
                </tr>
              </thead>
              <tbody>
                {geometryOf(result).openingGroups.map((g) => (
                  <tr key={g.id}>
                    <td>{g.facade}</td>
                    <td>{g.kind}</td>
                    <td className="num">
                      {g.widthM.toFixed(2)}\u00d7{g.heightM.toFixed(2)} m
                    </td>
                    <td className="num">{g.sillY.toFixed(2)} m</td>
                    <td className="num">
                      {g.panelCount}
                      {g.clippedByRoof ? ' (rake-clipped)' : ''}
                    </td>
                    <td className="small">{g.memberIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* §31: rooflight overlay — detection, owning plane, fused result. */}
          <section className="panel">
            <h2>Rooflights</h2>
            <table>
              <thead>
                <tr>
                  <th>size</th>
                  <th>on the roof at</th>
                  <th>placement</th>
                  <th>confidence</th>
                </tr>
              </thead>
              <tbody>
                {geometryOf(result)
                  .appearance.filter((a) => a.kind === 'ROOFLIGHT')
                  .map((a) => (
                    <tr key={a.id}>
                      <td className="num">
                        {(a.widthM ?? 0).toFixed(2)}\u00d7{(a.heightM ?? 0).toFixed(2)} m
                      </td>
                      <td className="num">
                        x {a.world?.x.toFixed(2)} \u00b7 y {a.world?.y.toFixed(2)} \u00b7 z {a.world?.z.toFixed(2)}
                      </td>
                      <td className="small">in the roof plane</td>
                      <td className="num">{a.confidence.toFixed(2)}</td>
                    </tr>
                  ))}
                {geometryOf(result).appearance.filter((a) => a.kind === 'ROOFLIGHT').length === 0 && (
                  <tr>
                    <td colSpan={4} className="small">
                      None detected. A unit that no elevation resolves is absent from the model rather than
                      placed by guesswork.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Metric audit</h2>
            <table>
              <thead>
                <tr>
                  <th>quantity</th>
                  <th>value</th>
                  <th>provenance</th>
                </tr>
              </thead>
              <tbody>
                {result.audit.entries.map((e) => (
                  <tr key={e.key}>
                    <td title={e.source}>{e.label}</td>
                    <td className="num">{e.value === null ? '—' : `${e.value.toFixed(2)} ${e.unit}`}</td>
                    <td>
                      <span className={`prov ${e.provenance}`}>{e.provenance}</span>
                      {e.corroboration.length > 0 && <span className="small"> +{e.corroboration.length}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Source assets</h2>
            <div className="assets">
              {sourcePackage?.assets.map((a) => (
                <figure key={a.id}>
                  <img src={`/fixtures/${project.slug}/assets/${a.url.slice(a.url.lastIndexOf('/') + 1)}`} alt={a.role} loading="lazy" />
                  <figcaption>
                    {a.role}
                    <br />
                    <span className="small">{a.projection}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Repair trace</h2>
            <div className="small">
              {repair?.accepted ?? 0} accepted, {repair?.rejected ?? 0} rejected
            </div>
            <ul className="trace">
              {repair?.entries.slice(0, 30).map((t, i) => (
                <li key={i} className={t.accepted ? 'ok' : 'no'}>
                  <b>{t.accepted ? 'accept' : 'reject'}</b> {t.description}
                  <div className="note">{t.reason}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Evidence graph</h2>
            <pre>{JSON.stringify(verification?.evidence, null, 2)}</pre>
          </section>

          <section className="panel">
            <h2>Performance</h2>
            <pre>{JSON.stringify(result.performance, null, 2)}</pre>
          </section>
        </>
      )}
    </div>
  )
}

type RepairEntry = { accepted: boolean; description: string; reason: string }
