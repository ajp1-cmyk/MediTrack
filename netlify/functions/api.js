// MediTrack API: the Express backend in backend/, wrapped for Netlify Functions.
// netlify.toml rewrites /api/* and /uploads/* to this function.
exports.handler = require('../../backend/netlify').handler;
