require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('./db');
const authRouter = require('./routes/auth');
const adminAuthRouter = require('./routes/adminAuth');
const adminRouter = require('./routes/admin');
const medicinesRouter = require('./routes/medicines');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const { getCookieSecret } = require('./lib/cartSession');
const { runMigrations } = require('./lib/migrations');

const app = express();
const PORT = process.env.PORT || 5000;

// Standard security headers (X-Content-Type-Options, Referrer-Policy, HSTS, …).
// This service only returns JSON and uploaded images, so the default
// Content-Security-Policy (which is meant for HTML documents) is switched off.
// Uploaded medicine images are loaded by the frontend from another origin in
// development, so cross-origin embedding has to stay allowed.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Allowed browser origins for cross-origin deployments (comma separated).
// With the Vite proxy the frontend and API share an origin, so this is only
// needed when the built frontend calls the API on another host.
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: same-origin requests, curl, server-to-server.
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      // Development without CORS_ORIGIN: accept the Vite dev server.
      if (corsOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      const err = new Error('Origin not allowed by CORS');
      err.status = 403;
      return callback(err);
    },
    credentials: true, // required for the signed cart cookie
  })
);
app.use(express.json());
app.use(cookieParser(getCookieSecret()));

// Behind a reverse proxy (Render, Railway, nginx) the secure-cookie decision
// needs the original protocol, not the proxy's HTTP hop.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);

  // Credentials and tokens must never travel over plain HTTP in production.
  // Health checks from the platform itself usually arrive without a Host
  // header, so those are let through.
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      return next();
    }
    // Platform health checks often use plain HTTP internally.
    if (req.path === '/api/health' || !req.headers.host) {
      return next();
    }
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  });
}

// Serve uploaded medicine images as static files.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint.
app.get('/api/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';
  res.json({ status: 'ok', database: dbState });
});

// Auth (login / user management) routes.
app.use('/api/auth', authRouter);

// Back-office auth (public login + invite acceptance) must be mounted before
// the protected admin router.
app.use('/api/admin/auth', adminAuthRouter);

// Back-office API: stock (via /api/medicines), orders, customers, audit, invites.
app.use('/api/admin', adminRouter);

// Medicine (stock) routes.
app.use('/api/medicines', medicinesRouter);

// Shopping cart routes.
app.use('/api/cart', cartRouter);

// Order + payment routes.
app.use('/api/orders', ordersRouter);


// Unknown API route.
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

// Central error handler: normalises Mongoose / multer / auth errors and cleans
// up any file that multer already wrote to disk.
app.use((err, req, res, _next) => {
  if (req.file) {
    fs.unlink(req.file.path, () => {});
  }

  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong';

  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join('; ');
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for '${err.path}'`;
  } else if (err.name === 'MulterError') {
    status = 400;
    message = `Upload failed: ${err.message}`;
  } else if (err.code === 11000) {
    status = 409;
    message = `Duplicate value for: ${Object.keys(err.keyValue || {}).join(', ')}`;
  }

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({ error: message });
});

/**
 * Connect to MongoDB and start listening.
 * @returns {Promise<import('http').Server>}
 */
async function start(port = PORT) {
  // Never run in production with the development fallbacks: a known JWT secret
  // lets anyone mint an administrator token.
  if (process.env.NODE_ENV === 'production') {
    const missing = ['JWT_SECRET', 'COOKIE_SECRET'].filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Refusing to start in production without ${missing.join(' and ')}. ` +
          'Set them in backend/.env (see .env.example) — or in the hosting provider.'
      );
    }
  }

  if (!process.env.JWT_SECRET) {
    console.warn(
      '[warn] JWT_SECRET is not set — using the insecure development fallback. ' +
        'Create backend/.env (see .env.example) before deploying.'
    );
  }
  if (!process.env.COOKIE_SECRET) {
    console.warn(
      '[warn] COOKIE_SECRET is not set — cart cookies use the insecure development ' +
        'fallback. Set COOKIE_SECRET before deploying.'
    );
  }

  await connectDB();
  // One-time data fixes (e.g. the pre-Phase-3 `staff` → `customer` rename).
  await runMigrations();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`MediTrack backend running at http://localhost:${server.address().port}`);
      resolve(server);
    });

    // Without this handler Node treats EADDRINUSE as an unhandled 'error'
    // event and prints a long stack trace. Turn it into an actionable message.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const numericPort = Number(port);
        const suggestedPort = Number.isInteger(numericPort) ? numericPort + 1 : 5001;
        reject(
          new Error(
            `Port ${port} is already in use — another MediTrack backend (or another app) ` +
              `is still running.\n` +
              `  • Find it:        lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
              `  • Stop it:        kill <PID>   (or: npx kill-port ${port})\n` +
              `  • Or use another: PORT=${suggestedPort} npm run dev  ` +
              `(remember to update the Vite proxy in frontend/vite.config.js)`
          )
        );
        return;
      }
      reject(err);
    });
  });
}

// Only auto-start when run directly (`node server.js`), not when imported by tests.
if (require.main === module) {
  start().catch((err) => {
    console.error(`❌ Failed to start MediTrack backend: ${err.message}`);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received — closing MongoDB connection…`);
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { app, start };

