require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('./db');
const authRouter = require('./routes/auth');
const medicinesRouter = require('./routes/medicines');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

// Medicine (stock) routes.
app.use('/api/medicines', medicinesRouter);

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
  if (!process.env.JWT_SECRET) {
    console.warn(
      '[warn] JWT_SECRET is not set — using the insecure development fallback. ' +
        'Create backend/.env (see .env.example) before deploying.'
    );
  }

  await connectDB();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`MediTrack backend running at http://localhost:${server.address().port}`);
      resolve(server);
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

