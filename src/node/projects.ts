/** The A/B/C development projects (§3). */
export type DevProject = {
  key: 'A' | 'B' | 'C' | 'D'
  slug: string
  name: string
  url: string
  /**
   * `HISTORICAL_HOLDOUT_WEB01` marks a project that *was* a clean holdout for
   * an earlier research stage and has been observed since. It cannot be
   * presented as an untouched holdout again (§28), and keeping the distinction
   * in the type is what stops it being quietly reused as one.
   */
  role: 'PRIMARY' | 'REGRESSION' | 'HOLDOUT' | 'HISTORICAL_HOLDOUT_WEB01'
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
    role: 'HOLDOUT',
    description:
      'The WEB-02 holdout, chosen before development began and not run until the freeze (§28, §29). ' +
      'Single storey with a hipped roof — no usable attic, no flat-roofed wing — so it shares no ' +
      'massing family with A or B. Selected on the presence of technical drawings alone; none of its ' +
      'metric values were inspected.',
  },
]

export const projectByKey = (key: string): DevProject | undefined =>
  PROJECTS.find((p) => p.key === key.toUpperCase() || p.slug === key)
