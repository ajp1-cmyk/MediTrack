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
const MONGODB_URI = process.env.MONGODB_URI || DEFAULT_URI;

/**
 * Connect to MongoDB. Safe to call once at boot; Mongoose pools the sockets.
 * @param {string} [uri] override, mainly used by tests.
 * @returns {Promise<import('mongoose').Connection>}
 */
async function connectDB(uri = MONGODB_URI) {
  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    // Replace the raw driver error with one that says what to fix.
    throw new Error(formatConnectionError(err, uri));
  }

  const target = connectionTarget(uri);
  console.log(
    `✅ MongoDB connected (${target.cloud ? 'cloud' : 'local'}: ${target.host}, db: ${mongoose.connection.name})`
  );
  return mongoose.connection;
}

/** Close the connection (used by graceful shutdown and tests). */
async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB, MONGODB_URI, DEFAULT_URI };

