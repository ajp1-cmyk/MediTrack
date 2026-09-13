// SQLite database setup using Node's built-in `node:sqlite` module.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'meditrack.db');

const db = new DatabaseSync(DB_PATH);

// Create the medicines table if it doesn't exist yet.
db.exec(`
  CREATE TABLE IF NOT EXISTS medicines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    mfd        TEXT NOT NULL,   -- manufacturing date (YYYY-MM-DD)
    exp        TEXT NOT NULL,   -- expiry date (YYYY-MM-DD)
    price      REAL NOT NULL,
    stock      INTEGER NOT NULL,
    image      TEXT,            -- uploaded image filename
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

module.exports = db;
