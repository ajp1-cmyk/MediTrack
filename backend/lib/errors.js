// Small helpers shared by the routes for consistent error responses.

/**
 * Create an Error that carries an HTTP status code.
 * The central error handler in server.js turns it into `{ error: message }`.
 */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Wrap an async route handler so rejected promises reach Express' error
 * handler (Express 4 does not do this on its own).
 */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { httpError, asyncHandler };
