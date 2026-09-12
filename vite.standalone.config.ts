/**
 * Standalone build: one self-contained page plus the cached source images.
 *
 * Differences from the dev build, all forced by where this has to run:
 *
 *  - `base: './'` so the bundle works from any path, not just a domain root;
 *  - CSS and the worker inlined, so the page needs no request to start;
 *  - `VITE_STANDALONE=1`, which switches the app to the bundled source package
 *    instead of the dev server's view of `fixtures/`.
 *
 * The images are *not* inlined: they are copied next to the page and loaded
 * through `<img>`, which is a plain image load rather than a scripted request
 * and so survives a restrictive host.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'dist-standalone-src',
  define: { 'import.meta.env.VITE_STANDALONE': JSON.stringify('1') },
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  worker: { format: 'es' },
})
