// Request guards shared by the cart and order routes.
const { httpError } = require('../lib/errors');

/**
 * Reject cross-site HTML form posts.
 *
 * The cart is identified by a SameSite=Lax cookie, and the order routes require
 * a Bearer token. Only JSON bodies are accepted for state-changing requests, so
 * a malicious `<form method="POST">` on another site cannot mutate a cart.
 * Requests without a body (e.g. DELETE) are allowed through.
 */
function rejectFormBody(req, _res, next) {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (contentType && !contentType.includes('application/json')) {
    return next(httpError(415, 'Content-Type must be application/json'));
  }
  return next();
}

module.exports = { rejectFormBody };
