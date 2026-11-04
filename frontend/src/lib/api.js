// Thin wrapper around fetch that attaches the in-memory access token and sends
// cookies (the signed httpOnly cart + refresh cookies).
//
// The access token is deliberately NOT stored in localStorage: it lives only in
// this module for the lifetime of the tab, so XSS cannot read a persistent
// credential. A page reload silently restores the session through the httpOnly
// `mt_refresh` cookie.
//
// Every path goes through `apiUrl()`, so the same code works same-origin (Vite
// proxy, Netlify function) and against an API on another host
// (VITE_API_BASE_URL, e.g. the Express server on Render).
import { API_BASE_URL, apiUrl, usesRemoteApi } from './config.js';

let accessToken = null;

export function getToken() {
  return accessToken;
}

export function setToken(token) {
  accessToken = token || null;
}

// Auth endpoints must not trigger the refresh-and-retry loop (a wrong password
// or code is a 401 too, and retrying would just hide the real error).
const NO_RETRY_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/otp/request',
  '/api/auth/otp/verify',
  '/api/auth/refresh',
  '/api/auth/logout',
]);

let refreshPromise = null;
// A concurrent tab may win the rotation race (409); the shared cookie is
// updated by then, so retry a couple of times before giving up.
const REFRESH_RETRIES = 3;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exchange the httpOnly refresh cookie for a new short-lived access token.
 * Concurrent callers share one request. Resolves to `{ token, user }` on
 * success and `null` on failure.
 *
 * @param {{ notify?: boolean }} [options]
 *   notify = true dispatches `meditrack:session-expired` so the AuthContext can
 *   sign the user out. The silent mount-time refresh sets it to false.
 */
export function refreshAccessToken({ notify = true } = {}) {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        let res;
        for (let attempt = 0; attempt <= REFRESH_RETRIES; attempt += 1) {
          res = await fetch(apiUrl('/api/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
          });

          if (res.ok) {
            const data = await res.json();
            setToken(data.token);
            return data;
          }

          if (res.status !== 409 || attempt === REFRESH_RETRIES) break;
          await wait(250 * (attempt + 1));
        }

        throw new Error(`Refresh failed (${res ? res.status : 'network'})`);
      } catch {
        setToken(null);
        if (notify && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('meditrack:session-expired'));
        }
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

/** Perform one fetch with the current access token and credentials. */
function sendRequest(path, options = {}) {
  const { body, headers, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  return fetch(apiUrl(path), {
    ...rest,
    credentials: 'include', // sends/receives the signed httpOnly cookies
    body,
    headers: {
      // Never set Content-Type for FormData: the browser adds the boundary.
      ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });
}

/** First `max` characters of a response body, with whitespace collapsed. */
function bodySnippet(text, max = 140) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Build the error for a response whose body is not JSON.
 *
 * A deployed SPA can end up talking to a host that does not serve the API:
 * Render answers an unknown path with the plain-text `Not Found`, and a static
 * host with an SPA fallback answers with `index.html`. `JSON.parse` on either
 * throws a bare `SyntaxError` that hides the status and the URL. The shopper
 * gets one plain sentence; the status, the body snippet and the usual cause are
 * logged for whoever is debugging the deploy.
 */
function nonJsonError(res, url, text) {
  const contentType = (res.headers.get('content-type') || 'unknown').split(';')[0];
  const status = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  const snippet = bodySnippet(text);

  let detail = `${status} from ${url} was not JSON (${contentType})`;
  if (snippet) detail += `: “${snippet}”`;
  if (res.status === 404) {
    detail += usesRemoteApi
      ? ' — check that VITE_API_BASE_URL points at the running API'
      : ' — this site is calling /api on its own origin, but no API is served there; set VITE_API_BASE_URL and rebuild';
  }
  console.error('[MediTrack]', detail);

  const error = new Error(
    res.status === 404
      ? 'This page could not be loaded. Please refresh and try again.'
      : 'The store is briefly unavailable. Please try again in a moment.'
  );
  error.status = res.status;
  error.url = url;
  return error;
}

/**
 * Build the error for a request the browser refused to complete.
 *
 * A CORS rejection is invisible to JavaScript: `fetch()` rejects with a bare
 * `TypeError: Failed to fetch` and no response object, so neither the status nor
 * the URL is available. That is the normal failure of a split deploy whose API
 * does not list the SPA's origin in `CORS_ORIGIN` — the 403 reply carries no
 * `Access-Control-Allow-Origin`, so the browser discards it — and it looks
 * exactly like the API being down or asleep. The shopper sees a connection
 * message; the URL and the origin that has to be allowed are logged for the
 * developer instead of being printed on the page.
 */
function networkError(cause, url) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'this page';
  const hint = usesRemoteApi
    ? `The browser blocked it before reading a response, which means ${origin} is not an allowed origin or ${API_BASE_URL} is down. On the API service set CORS_ORIGIN=${origin} (exact origin, no trailing slash) and redeploy it.`
    : 'Check that the API is running and that /api is proxied (npm run dev) or rewritten (netlify.toml) on this host.';
  console.error(`[MediTrack] Could not reach the API at ${url}. ${hint}`, cause);

  const error = new Error('The store could not be reached. Check your connection and try again.');
  error.status = 0;
  error.url = url;
  error.cause = cause;
  return error;
}

/**
 * fetch() with JSON handling, the Authorization header and credentials.
 * On a 401 it tries one silent refresh and replays the request, so an expired
 * 15-minute access token is invisible to the user.
 * Throws an Error carrying `status`, `url` (and the parsed body as `data`) when
 * the response is not ok. A non-JSON body (a proxy/edge 404 page, an SPA
 * fallback, an HTML error page) is reported as-is instead of surfacing the
 * `JSON.parse` SyntaxError, and a rejected fetch (CORS, offline, mixed content)
 * names the URL and the origin the API has to allow.
 */
export async function apiFetch(path, options = {}) {
  const { retryOnUnauthorized = true, ...requestOptions } = options;
  const url = apiUrl(path);

  let res;
  try {
    res = await sendRequest(path, requestOptions);
  } catch (err) {
    throw networkError(err, url);
  }

  if (res.status === 401 && retryOnUnauthorized && !NO_RETRY_PATHS.has(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        res = await sendRequest(path, requestOptions);
      } catch (err) {
        throw networkError(err, url);
      }
    }
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw nonJsonError(res, url, text);
    }
  }

  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    error.url = url;
    throw error;
  }

  return data;
}

/**
 * fetch() for binary responses (prescription files) with the same access token,
 * credentials and one-shot refresh-and-retry as `apiFetch`.
 * Resolves to a Blob.
 */
export async function apiFetchBlob(path) {
  const url = apiUrl(path);

  let res;
  try {
    res = await sendRequest(path);
  } catch (err) {
    throw networkError(err, url);
  }

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        res = await sendRequest(path);
      } catch (err) {
        throw networkError(err, url);
      }
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch {
      // Binary or empty error body: keep the generic message.
    }
    const error = new Error(message);
    error.status = res.status;
    error.url = url;
    throw error;
  }

  return res.blob();
}

/** Save a Blob (or open it in a new tab) under a sensible file name. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Convenience helpers used by the pages. */
export const authApi = {
  login: (email, password) =>
    apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      retryOnUnauthorized: false,
    }),
  register: (payload) =>
    apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
      retryOnUnauthorized: false,
    }),
  me: () => apiFetch('/api/auth/me'),
  // Silent restore of the session on page load.
  refresh: () => refreshAccessToken({ notify: false }),
  // Emailed one-time code: request a code, then exchange it for a session.
  requestOtp: (email) =>
    apiFetch('/api/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
      retryOnUnauthorized: false,
    }),
  verifyOtp: ({ email, code, name }) =>
    apiFetch('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, name }),
      retryOnUnauthorized: false,
    }),
  logout: () =>
    apiFetch('/api/auth/logout', { method: 'POST', retryOnUnauthorized: false }),
  sessions: () => apiFetch('/api/auth/sessions'),
  revokeSession: (id) => apiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeAllSessions: () => apiFetch('/api/auth/sessions', { method: 'DELETE' }),
  changePassword: (currentPassword, newPassword) =>
    apiFetch('/api/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

function queryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** Back-office API (staff + admin) and stock writes for the admin console. */
export const adminApi = {
  login: (email, password) =>
    apiFetch('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      retryOnUnauthorized: false,
    }),
  acceptInvite: (payload) =>
    apiFetch('/api/admin/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify(payload),
      retryOnUnauthorized: false,
    }),
  summary: () => apiFetch('/api/admin/summary'),
  orders: (params) => apiFetch(`/api/admin/orders${queryString(params)}`),
  order: (id) => apiFetch(`/api/admin/orders/${id}`),
  updateOrderStatus: (id, status) =>
    apiFetch(`/api/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  customers: (params) => apiFetch(`/api/admin/customers${queryString(params)}`),
  audit: (params) => apiFetch(`/api/admin/audit${queryString(params)}`),
  invites: (params) => apiFetch(`/api/admin/invites${queryString(params)}`),
  createInvite: (payload) =>
    apiFetch('/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeInvite: (id) => apiFetch(`/api/admin/invites/${id}`, { method: 'DELETE' }),
  medicines: () => apiFetch('/api/medicines'),
  addMedicine: (formData) =>
    apiFetch('/api/medicines', { method: 'POST', body: formData }),
  updateMedicine: (id, patch) =>
    apiFetch(`/api/medicines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteMedicine: (id) => apiFetch(`/api/medicines/${id}`, { method: 'DELETE' }),
  // FR-1.1: refill every medicine at/below the low-stock watermark right away.
  replenishStock: () =>
    apiFetch('/api/admin/inventory/replenish', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  // FR-2.1: prescription verification queue.
  prescriptions: (params) => apiFetch(`/api/admin/prescriptions${queryString(params)}`),
  prescriptionFile: (id) => apiFetchBlob(`/api/admin/prescriptions/${id}/file`),
  verifyPrescription: (id, payload) =>
    apiFetch(`/api/admin/prescriptions/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};



/** Public catalogue: browse, search, categories and a single product. */
export const medicinesApi = {
  list: ({ q, category } = {}) => apiFetch(`/api/medicines${queryString({ q, category })}`),
  categories: () => apiFetch('/api/medicines/categories'),
  get: (id) => apiFetch(`/api/medicines/${id}`),
};

/** Cart endpoints. Every mutation returns the freshly serialised cart. */
export const cartApi = {
  get: () => apiFetch('/api/cart'),
  addItem: (medicineId, quantity = 1) =>
    apiFetch('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify({ medicineId, quantity }),
    }),
  updateItem: (medicineId, quantity) =>
    apiFetch(`/api/cart/items/${medicineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),
  removeItem: (medicineId) =>
    apiFetch(`/api/cart/items/${medicineId}`, { method: 'DELETE' }),
  clear: () => apiFetch('/api/cart', { method: 'DELETE' }),
  merge: () => apiFetch('/api/cart/merge', { method: 'POST', body: JSON.stringify({}) }),
};

/** Wishlist endpoints (FR-1.5). Every mutation returns the serialised list. */
export const wishlistApi = {
  get: () => apiFetch('/api/wishlist'),
  add: (medicineId) =>
    apiFetch('/api/wishlist/items', {
      method: 'POST',
      body: JSON.stringify({ medicineId }),
    }),
  remove: (medicineId) =>
    apiFetch(`/api/wishlist/items/${medicineId}`, { method: 'DELETE' }),
  clear: () => apiFetch('/api/wishlist', { method: 'DELETE' }),
  // Returns `{ wishlist, cart }` so both navigation badges update at once.
  moveToCart: (medicineId) =>
    apiFetch(`/api/wishlist/items/${medicineId}/move-to-cart`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

/** Order + payment endpoints. */
export const ordersApi = {
  create: (shippingAddress) =>
    apiFetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ shippingAddress }),
    }),
  list: () => apiFetch('/api/orders'),
  get: (id) => apiFetch(`/api/orders/${id}`),
  pay: (id, { method, details }) =>
    apiFetch(`/api/orders/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ method, details }),
    }),
  cancel: (id) =>
    apiFetch(`/api/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

/** Customer account extras (MediPoints today, refill reminders next). */
export const accountApi = {
  medipoints: () => apiFetch('/api/me/medipoints'),
};

/** Prescription uploads (FR-1.4 / FR-2.1). Files never get a public URL. */
export const prescriptionsApi = {
  list: () => apiFetch('/api/prescriptions'),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch('/api/prescriptions', { method: 'POST', body: form });
  },
  file: (id) => apiFetchBlob(`/api/prescriptions/${id}/file`),
};

