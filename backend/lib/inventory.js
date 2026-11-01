// Inventory replenishment (SRS FR-1.1).
//
// A medicine whose stock reaches the configured watermark (default 10 units) is
// treated as a restock trigger: it is filled back up to the target level
// (default 100 units). Replenishment is *not* part of the checkout path, so a
// sale always completes with the stock it reserved — the refill happens
// afterwards, exactly like a supplier delivery.
//
// Two entry points use the same logic:
//
//   • a light background sweep started by server.js    (REPLENISH_INTERVAL_MS)
//   • POST /api/admin/inventory/replenish              (back office / demo)
//
// Expired medicines are skipped: restocking something that can no longer be
// sold would only hide the problem from the Inventory Manager.
const Medicine = require('../models/Medicine');
const { recordAudit } = require('./audit');
const { todayISO } = require('./availability');

const DEFAULT_LOW_STOCK_WATERMARK = 10;
const DEFAULT_REPLENISH_TO = 100;
const DEFAULT_INTERVAL_MS = 60 * 1000; // one minute

/** Read a whole-number environment variable, falling back when it is unusable. */
function readWholeNumber(name, fallback, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

/** Replenishment rules currently in force (all overridable in backend/.env). */
function inventoryConfig() {
  const lowStockWatermark = readWholeNumber(
    'LOW_STOCK_WATERMARK',
    DEFAULT_LOW_STOCK_WATERMARK
  );

  // A target at or below the watermark would refill the same row on every
  // sweep forever, so an invalid combination falls back to the default.
  let replenishTo = readWholeNumber('REPLENISH_TO', DEFAULT_REPLENISH_TO, { min: 1 });
  if (replenishTo <= lowStockWatermark) {
    console.warn(
      `[inventory] REPLENISH_TO (${replenishTo}) must be greater than LOW_STOCK_WATERMARK ` +
        `(${lowStockWatermark}) — using ${DEFAULT_REPLENISH_TO} instead.`
    );
    replenishTo = Math.max(DEFAULT_REPLENISH_TO, lowStockWatermark + 1);
  }

  const flag = String(process.env.INVENTORY_AUTO_REPLENISH ?? 'on').toLowerCase();
  const enabled = !['off', 'false', '0', 'no'].includes(flag);

  return {
    lowStockWatermark,
    replenishTo,
    intervalMs: readWholeNumber('REPLENISH_INTERVAL_MS', DEFAULT_INTERVAL_MS, { min: 1000 }),
    enabled,
  };
}

/**
 * Refill every medicine that has reached the watermark.
 *
 * Each row is updated with a conditional write, so two sweeps (or a sweep
 * racing the manual endpoint) can never fill the same row twice: the second
 * update simply matches nothing.
 *
 * @param {object} [options]
 * @param {import('express').Request|null} [options.req] request that triggered it (for the audit log)
 * @param {Date} [options.now] injectable clock (used by tests)
 * @returns {Promise<{ watermark: number, target: number, scanned: number,
 *   restocked: Array<{ id: string, name: string, from: number, to: number }> }>}
 */
async function replenishLowStock({ req = null, now = new Date() } = {}) {
  const { lowStockWatermark, replenishTo } = inventoryConfig();

  const candidates = await Medicine.find({
    stock: { $lte: lowStockWatermark },
    exp: { $gte: todayISO(now) }, // never refill expired stock
  }).select('name stock');

  const restocked = [];
  for (const candidate of candidates) {
    const updated = await Medicine.findOneAndUpdate(
      { _id: candidate._id, stock: { $lte: lowStockWatermark } },
      { $set: { stock: replenishTo } },
      { new: true }
    );
    if (!updated) continue; // already restocked by a concurrent sweep

    restocked.push({
      id: updated._id.toString(),
      name: updated.name,
      from: candidate.stock,
      to: updated.stock,
    });

    await recordAudit({
      req,
      action: 'medicine.replenish',
      targetType: 'medicine',
      targetId: updated._id,
      before: { stock: candidate.stock },
      after: { stock: updated.stock, reason: 'low-stock watermark reached' },
    });
  }

  return { watermark: lowStockWatermark, target: replenishTo, scanned: candidates.length, restocked };
}

/**
 * Start the background sweep. Returns the timer so it can be cleared on
 * shutdown, or null when automatic replenishment is switched off.
 *
 * `unref()` means the timer never keeps the Node process (or a test run) alive.
 */
function startReplenishSweeper({ intervalMs } = {}) {
  const config = inventoryConfig();
  if (!config.enabled) {
    console.log('[inventory] automatic replenishment is disabled (INVENTORY_AUTO_REPLENISH)');
    return null;
  }

  const every = intervalMs ?? config.intervalMs;
  const timer = setInterval(() => {
    replenishLowStock()
      .then((result) => {
        if (result.restocked.length > 0) {
          const names = result.restocked.map((row) => `${row.name} ${row.from}→${row.to}`);
          console.log(`[inventory] restocked ${result.restocked.length}: ${names.join(', ')}`);
        }
      })
      .catch((err) => console.error(`[inventory] replenishment sweep failed: ${err.message}`));
  }, every);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  DEFAULT_LOW_STOCK_WATERMARK,
  DEFAULT_REPLENISH_TO,
  DEFAULT_INTERVAL_MS,
  inventoryConfig,
  replenishLowStock,
  startReplenishSweeper,
};
