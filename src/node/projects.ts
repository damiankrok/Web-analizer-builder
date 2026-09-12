/** The A/B/C development projects (§3). */
export type DevProject = {
  key: 'A' | 'B' | 'C'
  slug: string
  name: string
  url: string
  role: 'PRIMARY' | 'REGRESSION' | 'HOLDOUT'
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
    role: 'HOLDOUT',
    description: 'Held out until the weights and thresholds are frozen (§43). Never tuned on.',
  },
]

export const projectByKey = (key: string): DevProject | undefined =>
  PROJECTS.find((p) => p.key === key.toUpperCase() || p.slug === key)
