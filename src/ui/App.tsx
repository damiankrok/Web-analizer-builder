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
  geometry: { tris: ViewerTri[]; edges: ViewerEdge[]; quantities: Record<string, number> }
  views: ViewEntry[]
  performance: Record<string, number>
}

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
