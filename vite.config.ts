import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Cached source assets are served straight from the fixture tree, so the
    // browser runs the same pipeline the CLI does without needing a proxy for
    // archon.pl. A live fetch would need the Node adapter (§8): browsers cannot
    // enforce the redirect and size policy, and ARCHON sends no CORS headers.
    fs: { allow: ['.'] },
  },
  publicDir: false,
  build: { outDir: 'dist-ui' },
})
