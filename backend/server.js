const express = require('express');
const cors = require('cors');
const path = require('path');
const medicinesRouter = require('./routes/medicines');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve uploaded medicine images as static files.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Medicine routes.
app.use('/api/medicines', medicinesRouter);

// Central error handler (e.g. multer file-filter/limit errors).
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`MediTrack backend running at http://localhost:${PORT}`);
});
