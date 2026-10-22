// MongoDB connection helper (Mongoose).
//
// Works with a local MongoDB *and* with cloud MongoDB (MongoDB Atlas) — the only
// difference is the MONGODB_URI value in backend/.env:
//
//   local : mongodb://127.0.0.1:27017/meditrack
//   Atlas : mongodb+srv://<user>:<password>@<cluster>.mongodb.net/meditrack?retryWrites=true&w=majority
//
// Verify a connection string on its own with:  npm run db:check
const mongoose = require('mongoose');
const { connectionTarget, formatConnectionError } = require('./lib/mongoErrors');

const DEFAULT_URI = 'mongodb://127.0.0.1:27017/meditrack';
const DEFAULT_DB_NAME = process.env.MONGODB_DB || 'meditrack';
const RAW_MONGODB_URI = process.env.MONGODB_URI || DEFAULT_URI;

/**
 * Make sure the connection string names a database.
 *
 * Atlas connection strings are often copied as
 *   mongodb+srv://user:pass@cluster.mongodb.net/?appName=...
 * which has no database path, so MongoDB silently uses the default `test`
 * database. Appending the configured name avoids data "disappearing" when the
 * URI is later corrected.
 */
function ensureDatabaseName(uri, dbName = DEFAULT_DB_NAME) {
  if (typeof uri !== 'string' || !/^mongodb(\+srv)?:\/\//.test(uri)) return uri;

  const queryIndex = uri.indexOf('?');
  const base = queryIndex === -1 ? uri : uri.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : uri.slice(queryIndex);

  // Credentials may contain @ and :, so only split on the first slash after
  // the host part.
  const match = base.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?(.*)$/);
  if (!match) return uri;

  const [, prefix, dbPath] = match;
  if (dbPath.trim()) return uri; // already names a database

  return `${prefix}/${encodeURIComponent(dbName)}${query}`;
}

const MONGODB_URI = ensureDatabaseName(RAW_MONGODB_URI);

if (MONGODB_URI !== RAW_MONGODB_URI) {
  console.warn(
    `[warn] MONGODB_URI did not name a database — using "${DEFAULT_DB_NAME}". ` +
      `Add /${DEFAULT_DB_NAME} to the URI (or set MONGODB_DB) to make this explicit.`
  );
}

/**
 * Connect to MongoDB. Safe to call once at boot; Mongoose pools the sockets.
 * @param {string} [uri] override, mainly used by tests.
 * @returns {Promise<import('mongoose').Connection>}
 */
async function connectDB(uri = MONGODB_URI) {
  const resolvedUri = ensureDatabaseName(uri);
  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(resolvedUri, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    // Replace the raw driver error with one that says what to fix.
    throw new Error(formatConnectionError(err, resolvedUri));
  }

  const target = connectionTarget(resolvedUri);
  console.log(
    `✅ MongoDB connected (${target.cloud ? 'cloud' : 'local'}: ${target.host}, db: ${mongoose.connection.name})`
  );
  return mongoose.connection;
}

/** Close the connection (used by graceful shutdown and tests). */
async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = {
  connectDB,
  disconnectDB,
  ensureDatabaseName,
  MONGODB_URI,
  RAW_MONGODB_URI,
  DEFAULT_URI,
  DEFAULT_DB_NAME,
};


