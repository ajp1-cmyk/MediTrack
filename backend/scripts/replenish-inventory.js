#!/usr/bin/env node
// Run one low-stock replenishment pass and exit (SRS FR-1.1).
//
// The server already sweeps on a timer; this script is for a cron job, a deploy
// hook, or a demo without keeping the API running.
//
//   npm run inventory:replenish
require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../db');
const { inventoryConfig, replenishLowStock } = require('../lib/inventory');

async function main() {
  const config = inventoryConfig();
  console.log(
    `Restock rule: ${config.lowStockWatermark} units or fewer → refill to ${config.replenishTo} units`
  );

  await connectDB();
  const result = await replenishLowStock();

  if (result.restocked.length === 0) {
    console.log(`✅ nothing to restock (${result.scanned} item(s) at or below the watermark)`);
    return;
  }

  for (const row of result.restocked) {
    console.log(`  • ${row.name}: ${row.from} → ${row.to}`);
  }
  console.log(`✅ restocked ${result.restocked.length} item(s)`);
}

main()
  .catch((err) => {
    console.error(`❌ Replenishment failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
    await mongoose.connection.close().catch(() => {});
  });
