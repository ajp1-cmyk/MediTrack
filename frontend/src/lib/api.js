// Thin wrapper around fetch that attaches the JWT stored at login.
const TOKEN_KEY = 'meditrack_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * fetch() with JSON handling and the Authorization header.
 * Throws an Error carrying `status` when the response is not ok.
 */
export async function apiFetch(path, options = {}) {
  const { body, headers, ...rest } = options;
  const token = getToken();
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const res = await fetch(path, {
    ...rest,
    body,
    headers: {
      // Never set Content-Type for FormData: the browser adds the boundary.
      ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
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
    }),
  register: (payload) =>
    apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  me: () => apiFetch('/api/auth/me'),
};
