/** The development projects, and the one untouched holdout among them. */
export type DevProject = {
  key: 'A' | 'B' | 'C' | 'D' | 'E'
  slug: string
  name: string
  url: string
  /**
   * `HISTORICAL_HOLDOUT_WEB01` / `_WEB02` mark a project that *was* a clean
   * holdout for an earlier research stage and has been observed since. It
   * cannot be presented as an untouched holdout again, and keeping the
   * distinction in the type is what stops it being quietly reused as one.
   *
   * A holdout is spent the moment its extracted geometry has been looked at,
   * whether or not anything was tuned on it. Exactly one project may carry
   * `HOLDOUT` at a time.
   */
  role:
    | 'PRIMARY'
    | 'REGRESSION'
    | 'HOLDOUT'
    | 'HISTORICAL_HOLDOUT_WEB01'
    | 'HISTORICAL_HOLDOUT_WEB02'
  description: string
}

export const PROJECTS: readonly DevProject[] = [
  {
    key: 'A',
    slug: 'A-marcowki',
    name: 'Dom w marcówkach (GE)',
    url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-marcowkach-ge-m2fa281446a8ca',
    role: 'PRIMARY',
    description: 'Two storeys with a usable attic, 40° gable, flat-roofed garage wing.',
  },
  {
    key: 'B',
    slug: 'B-bakopach',
    name: 'Dom w bakopach (G2E)',
    url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-bakopach-g2e-mbb9288266b05e',
    role: 'REGRESSION',
    description: 'Single storey, 35° gable, double garage, no knee wall — deliberately unlike A.',
  },
  {
    key: 'C',
    slug: 'C-holdout',
    name: 'Dom w kosaćcach 44',
    url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-kosaccach-44-md3928530c6bf3',
    role: 'HISTORICAL_HOLDOUT_WEB01',
    description:
      'The WEB-01 holdout, run once after that freeze. It has been observed, so it is no longer a ' +
      'clean holdout and is kept only as a second regression project.',
  },
  {
    key: 'D',
    slug: 'D-holdout',
    name: 'Dom w kruszczykach 22',
    url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-kruszczykach-22-md1827af5309ce',
    role: 'HISTORICAL_HOLDOUT_WEB02',
    description:
      'The WEB-02 holdout. It was run twice under that freeze and its footprint, ridge, eave and ' +
      'pitch were reported, and a missing-gable-wall defect was found and fixed against it, so it ' +
      'has been observed and is no longer a clean holdout. Kept as a third regression project.',
  },
  {
    key: 'E',
    slug: 'E-holdout',
    name: 'Dom w wisteriach 21',
    url: 'https://www.archon.pl/projekty-domow/projekt-dom-w-wisteriach-21-m42a2875282921',
    role: 'HOLDOUT',
    description:
      'The WEB-PIVOT-06 holdout, chosen before any Stage-06 implementation or tuning. Selected on ' +
      'the presence of technical drawings alone: the page publishes a ground-floor plan, an attic ' +
      'plan, a detailed (dimensioned) plan variant, elevations and a section. None of its metric ' +
      'values have been inspected and none of its geometry has been transcribed.',
  },
]

export const projectByKey = (key: string): DevProject | undefined =>
  PROJECTS.find((p) => p.key === key.toUpperCase() || p.slug === key)
