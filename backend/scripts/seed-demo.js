#!/usr/bin/env node
// Seed a small demo catalogue (idempotent).
//
//   npm run seed:demo
//   MONGODB_URI='mongodb+srv://…/meditrack_prod?retryWrites=true&w=majority' \
//     npm run seed:demo
//
// Existing rows are matched by name and left untouched, so re-running never
// resets `stock`/`held` counters or duplicates the catalogue. Some rows are
// deliberately low on stock (FR-1.1 replenishment) or close to expiry so the
// background sweeps and the expiry badges have something to show.
require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../db');
const Medicine = require('../models/Medicine');

/** YYYY-MM-DD for today plus `offsetDays` (negative = past). */
function isoDate(offsetDays) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const MANUFACTURED = isoDate(-180);

const DEMO_MEDICINES = [
  {
    name: 'Paracetamol 500mg',
    mfd: MANUFACTURED,
    exp: isoDate(540),
    price: 35,
    stock: 120,
    prescriptionRequired: false,
    refillDays: 15,
  },
  {
    name: 'Cetirizine 10mg',
    mfd: MANUFACTURED,
    exp: isoDate(420),
    price: 28,
    stock: 80,
    prescriptionRequired: false,
    refillDays: 30,
  },
  {
    name: 'Vitamin D3 60K',
    mfd: MANUFACTURED,
    exp: isoDate(365),
    price: 95,
    stock: 60,
    prescriptionRequired: false,
    refillDays: 30,
  },
  {
    name: 'Ranitidine 150mg',
    mfd: MANUFACTURED,
    // Expires soon: exercises the expiry warning in the storefront and console.
    exp: isoDate(20),
    price: 42,
    stock: 90,
    prescriptionRequired: false,
    refillDays: 30,
  },
  {
    name: 'Amoxicillin 500mg',
    mfd: MANUFACTURED,
    exp: isoDate(300),
    price: 120,
    stock: 40,
    prescriptionRequired: true,
    refillDays: 7,
  },
  {
    name: 'Metformin 500mg',
    mfd: MANUFACTURED,
    exp: isoDate(480),
    price: 75,
    stock: 50,
    prescriptionRequired: true,
    refillDays: 30,
  },
  {
    name: 'Insulin Glargine 100IU/ml',
    mfd: MANUFACTURED,
    exp: isoDate(240),
    price: 640,
    stock: 15,
    prescriptionRequired: true,
    refillDays: 30,
  },
  {
    // Below the 10-unit watermark, so the FR-1.1 sweep refills it to 100.
    name: 'Azithromycin 250mg',
    mfd: MANUFACTURED,
    exp: isoDate(360),
    price: 145,
    stock: 8,
    prescriptionRequired: true,
    refillDays: 5,
  },
];

async function main() {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const medicine of DEMO_MEDICINES) {
    const existing = await Medicine.findOne({ name: medicine.name });
    if (existing) {
      skipped += 1;
      continue;
    }
    await Medicine.create(medicine);
    created += 1;
  }

  console.log(
    `✅ Demo catalogue: ${created} created, ${skipped} already present ` +
      `(${DEMO_MEDICINES.length} rows in the seed)`
  );
  console.log(`   Database: ${mongoose.connection.name}`);
  console.log('   Manage stock at /admin/stock after signing in as an administrator.');
}

main()
  .catch((err) => {
    console.error(`❌ Could not seed the demo catalogue: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
    await mongoose.connection.close().catch(() => {});
  });
