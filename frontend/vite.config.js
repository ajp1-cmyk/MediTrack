import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emit `404.html` as a byte-for-byte copy of the built `index.html`.
 *
 * A single-page app only works on a deep link (`/orders/<id>/confirmation`
 * after a reload, `/cart`, `/admin/orders`, …) if the host hands that path back
 * to `index.html`. Hosts that serve a `404.html` from the publish directory for
 * unknown paths — GitHub Pages, Surge, GitLab Pages, and Netlify when no
 * rewrite matches — then boot React Router on the original URL instead of
 * showing their own "Not Found" page.
 *
 * Render static sites never read the file: they answer 404 unless the
 * `/* → /index.html` **Rewrite** rule exists (docs/DEPLOYMENT.md, section 8).
 * `netlify.toml` already rewrites `/*` to `/index.html`, so the copy is only
 * insurance there.
 */
function spaFallback404() {
  let outDir = resolve('dist');

  return {
    name: 'meditrack-spa-fallback-404',
    apply: 'build',
    configResolved(config) {
      // Respect `root`/`build.outDir` instead of assuming the CWD is `frontend/`.
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), spaFallback404()],
  server: {
    port: 5173,
    // Forward API and image requests to the Express backend during development.
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
    },
  },
});
