// Where the MediTrack API lives.
//
// Empty (the default) means "same origin":
//   • `npm run dev` — the Vite proxy in vite.config.js forwards /api and
//     /uploads to http://localhost:5000
//   • a deployment that serves the SPA and the API from one host (the Netlify
//     function, or Render serving both) keeps working untouched
//
// Set `VITE_API_BASE_URL` when the API lives on another origin, for example an
// SPA on Netlify with the Express server on Render:
//
//   VITE_API_BASE_URL=https://meditrack-1owj.onrender.com
//
// Vite inlines the value at build time, so a rebuild (or a Netlify redeploy) is
// required after changing it. A cross-origin setup also needs the API to allow
// the SPA's origin (CORS_ORIGIN) and to mark its cookies SameSite=None
// (COOKIE_SAMESITE=none, which requires HTTPS) — otherwise the browser silently
// drops the refresh and cart cookies and nobody can stay signed in.
const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();

/** API origin without a trailing slash, or '' for same-origin requests. */
export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, '');

/** True when the SPA talks to an API on a different origin. */
export const usesRemoteApi = API_BASE_URL !== '';

/**
 * Routing style, chosen at build time: `'hash'` puts the router state after
 * `#` (`/#/medicines/<id>`), anything else (the default) uses clean paths
 * (`/medicines/<id>`).
 *
 * Clean paths are the right choice whenever the host can hand an unknown path
 * back to `index.html` — `netlify.toml`, the Vite dev server and a Render
 * Static Site with a `/* → /index.html` **Rewrite** rule all do. A static host
 * without that rule answers a deep link with its own `404 Not Found` (Render
 * static sites return a plain-text `Not Found`), and a *reload* then never
 * reaches the app. Hash URLs need no host configuration at all, because the
 * browser only ever requests `/`; the trade-off is that the address looks like
 * `/#/orders/…`.
 */
export const ROUTER_MODE = (import.meta.env.VITE_ROUTER_MODE || '').trim().toLowerCase();

/** True when the app is built for hash routing. */
export const usesHashRouting = ROUTER_MODE === 'hash';

/**
 * Absolute link to an in-app path that works in either routing mode (used for
 * links that are copied out of the app, e.g. an admin invite). Absolute `http(s)`
 * URLs are returned unchanged.
 *
 * @param {string} path e.g. '/admin/register?invite=…'
 * @returns {string}
 */
export function appUrl(path) {
  if (!path) return path;
  if (/^(https?:)?\/\//i.test(path)) return path;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const clean = path.startsWith('/') ? path : `/${path}`;
  return usesHashRouting ? `${origin}/#${clean}` : `${origin}${clean}`;
}

/**
 * Absolute URL for an API path (`/api/…`).
 * @param {string} path
 * @returns {string}
 */
export function apiUrl(path) {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Absolute URL for a backend-served asset (`/uploads/…`). Absolute and `data:`
 * URLs are returned unchanged, so this is safe to wrap around anything.
 * @param {string} path
 * @returns {string}
 */
export function assetUrl(path) {
  if (!path) return path;
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  return apiUrl(path);
}
