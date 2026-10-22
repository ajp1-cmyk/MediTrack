// Thin wrapper around fetch that attaches the in-memory access token and sends
// cookies (the signed httpOnly cart + refresh cookies).
//
// The access token is deliberately NOT stored in localStorage: it lives only in
// this module for the lifetime of the tab, so XSS cannot read a persistent
// credential. A page reload silently restores the session through the httpOnly
// `mt_refresh` cookie.
let accessToken = null;

export function getToken() {
  return accessToken;
}

export function setToken(token) {
  accessToken = token || null;
}

// Auth endpoints must not trigger the refresh-and-retry loop (a wrong password
// is a 401 too, and retrying would just hide the real error).
const NO_RETRY_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
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
          res = await fetch('/api/auth/refresh', {
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

  return fetch(path, {
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

/**
 * fetch() with JSON handling, the Authorization header and credentials.
 * On a 401 it tries one silent refresh and replays the request, so an expired
 * 15-minute access token is invisible to the user.
 * Throws an Error carrying `status` (and the parsed body as `data`) when the
 * response is not ok.
 */
export async function apiFetch(path, options = {}) {
  const { retryOnUnauthorized = true, ...requestOptions } = options;

  let res = await sendRequest(path, requestOptions);

  if (res.status === 401 && retryOnUnauthorized && !NO_RETRY_PATHS.has(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await sendRequest(path, requestOptions);
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
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

