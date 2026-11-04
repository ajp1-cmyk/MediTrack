// Cookie attributes shared by the signed cart cookie and the refresh-session
// cookie.
//
// SameSite=Lax is the default and fits every same-origin deployment: local dev,
// the Netlify function, or a host that serves the SPA and the API together.
//
// When the SPA is hosted on a *different* site from the API (a Netlify frontend
// calling an Express server on Render), the browser only attaches the cookies to
// cross-site requests if they are SameSite=None — and None is only accepted on
// Secure cookies over HTTPS. Set COOKIE_SAMESITE=none on the API in that case;
// without it sign-in appears to work but the refresh cookie is dropped, so a
// reload signs the visitor out and guest carts never stick.
const SAME_SITE_VALUES = new Set(['lax', 'strict', 'none']);

/** The configured policy: 'lax' unless COOKIE_SAMESITE says otherwise. */
function sameSite() {
  const value = String(process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  return SAME_SITE_VALUES.has(value) ? value : 'lax';
}

/**
 * The two attributes that decide whether a cookie may travel cross-site.
 * `secure` is on in production (HTTPS terminates at the platform proxy) and is
 * always on for SameSite=None, because browsers reject None without it.
 *
 * @returns {{ sameSite: string, secure: boolean }}
 */
function cookieSecurity() {
  const policy = sameSite();
  return {
    sameSite: policy,
    secure: policy === 'none' ? true : process.env.NODE_ENV === 'production',
  };
}

/** True when cookies are configured to cross origins (SameSite=None). */
function crossSiteCookies() {
  return sameSite() === 'none';
}

module.exports = { SAME_SITE_VALUES, sameSite, cookieSecurity, crossSiteCookies };
