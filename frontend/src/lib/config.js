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
