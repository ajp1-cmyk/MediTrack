#!/usr/bin/env node
// One-time demo data: 30 products across 7 categories, each with a short
// description and a simple generated product image.
//
//   npm run seed:data
//   MONGODB_URI='mongodb+srv://…/meditrack?retryWrites=true&w=majority' \
//     npm run seed:data
//
// Safe to re-run: products are matched by name (case-insensitive) and existing
// rows are never overwritten — only a missing image/description/category is
// filled in. Images are written to backend/uploads as lightweight SVG labels,
// which the storefront renders through the existing `/uploads/:file` route.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../db');
const Medicine = require('../models/Medicine');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// The seven catalogue varieties (category + the gradient used by the image).
const VARIETIES = {
  pain: { label: 'Pain Relief & Fever', from: '#f97316', to: '#b45309' },
  cold: { label: 'Cold, Cough & Allergy', from: '#0ea5e9', to: '#0369a1' },
  vitamins: { label: 'Vitamins & Supplements', from: '#22c55e', to: '#15803d' },
  diabetes: { label: 'Diabetes Care', from: '#8b5cf6', to: '#5b21b6' },
  heart: { label: 'Heart & BP Care', from: '#ef4444', to: '#991b1b' },
  antibiotics: { label: 'Antibiotics & Antifungals', from: '#14b8a6', to: '#0f766e' },
  everyday: { label: 'Digestive & First Aid', from: '#64748b', to: '#334155' },
};

/** YYYY-MM-DD for today plus `offsetDays` (negative = past). */
function isoDate(offsetDays) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a product name into at most two lines that fit the image. */
function splitLabel(value) {
  const text = String(value || 'Medicine').trim();
  if (text.length <= 17) return [text, ''];
  const words = text.split(/\s+/);
  let first = '';
  let index = 0;
  while (index < words.length && `${first} ${words[index]}`.trim().length <= 17) {
    first = `${first} ${words[index]}`.trim();
    index += 1;
  }
  const second = words.slice(index).join(' ');
  return [first || text.slice(0, 17), second];
}

// Which illustration each seeded product gets. A product may override this with
// its own `form` property; the map keeps the 30 data rows terse.
const FORMS = {
  'Paracetamol 500mg': 'tablet',
  'Ibuprofen 400mg': 'tablet',
  'Diclofenac Gel 30g': 'tube',
  'Aspirin 75mg': 'tablet',
  'Naproxen 250mg': 'tablet',
  'Cetirizine 10mg': 'tablet',
  'Levocetirizine 5mg': 'tablet',
  'Dextromethorphan Syrup 100ml': 'syrup',
  'Saline Nasal Spray 20ml': 'spray',
  'Vitamin D3 60K': 'sachet',
  'Vitamin C 500mg': 'tablet',
  'Multivitamin Daily': 'jar',
  'Iron + Folic Acid': 'tablet',
  'Zinc 50mg': 'tablet',
  'Metformin 500mg': 'tablet',
  'Glimepiride 2mg': 'tablet',
  'Insulin Glargine 100IU/ml': 'pen',
  'Amlodipine 5mg': 'tablet',
  'Telmisartan 40mg': 'tablet',
  'Atorvastatin 10mg': 'tablet',
  'Clopidogrel 75mg': 'tablet',
  'Amoxicillin 500mg': 'capsule',
  'Azithromycin 250mg': 'tablet',
  'Cefixime 200mg': 'capsule',
  'Fluconazole 150mg': 'capsule',
  'Metronidazole 400mg': 'tablet',
  'Pantoprazole 40mg': 'capsule',
  'ORS Powder Sachet': 'sachet',
  'Isabgol Husk 100g': 'jar',
  'Dettol Liquid': 'liquid',
};

/** Illustrations for devices and containers (returns null if unknown). */
function packArtFor(form, variety) {
  const accent = variety.from;
  const dark = variety.to;
  const font = 'Arial, Helvetica, sans-serif';

  switch (form) {
    case 'pen':
      return `<g transform="translate(118 145) rotate(38)">
        <rect x="-18" y="-108" width="36" height="216" rx="18" fill="#ffffff" opacity="0.96"/>
        <rect x="-18" y="-108" width="36" height="56" rx="18" fill="${dark}"/>
        <rect x="-18" y="40" width="36" height="68" rx="18" fill="${accent}" opacity="0.92"/>
        <rect x="-22" y="10" width="44" height="9" rx="4" fill="${dark}" opacity="0.5"/>
        <rect x="-22" y="26" width="44" height="9" rx="4" fill="${dark}" opacity="0.35"/>
      </g>`;
    case 'jar':
      return `<g transform="translate(118 145)">
        <rect x="-66" y="-84" width="132" height="26" rx="9" fill="${dark}"/>
        <path d="M-60 -58 H60 V60 A18 18 0 0 1 42 78 H-42 A18 18 0 0 1 -60 60 Z" fill="#ffffff" opacity="0.96"/>
        <rect x="-60" y="-6" width="120" height="58" fill="${accent}" opacity="0.92"/>
        <text x="0" y="31" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">JAR</text>
      </g>`;
    case 'liquid':
      return `<g transform="translate(118 145)">
        <rect x="-36" y="-104" width="72" height="22" rx="7" fill="${dark}"/>
        <rect x="-24" y="-84" width="48" height="18" fill="#ffffff" opacity="0.9"/>
        <path d="M-54 -66 H54 V66 A18 18 0 0 1 36 84 H-36 A18 18 0 0 1 -54 66 Z" fill="#ffffff" opacity="0.96"/>
        <rect x="-54" y="6" width="108" height="60" fill="${accent}" opacity="0.92"/>
        <text x="0" y="43" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">LIQUID</text>
      </g>`;
    case 'drops':
      return `<g transform="translate(118 145)">
        <ellipse cx="0" cy="-96" rx="22" ry="16" fill="${dark}"/>
        <rect x="-6" y="-86" width="12" height="26" fill="${dark}" opacity="0.75"/>
        <rect x="-44" y="-62" width="88" height="136" rx="18" fill="#ffffff" opacity="0.96"/>
        <rect x="-44" y="4" width="88" height="56" rx="8" fill="${accent}" opacity="0.92"/>
        <text x="0" y="40" text-anchor="middle" font-family="${font}" font-size="13" font-weight="700" fill="#ffffff">DROPS</text>
      </g>`;
    default:
      return null;
  }
}

/** Illustrations for tablets and liquid/powder packs (returns null if unknown). */
function artFor(form, variety) {
  const accent = variety.from;
  const dark = variety.to;
  const font = 'Arial, Helvetica, sans-serif';

  switch (form) {
    case 'capsule':
      return `<g transform="translate(118 145) rotate(-30)">
        <rect x="-72" y="-26" width="72" height="52" rx="26" fill="#ffffff" opacity="0.96"/>
        <rect x="0" y="-26" width="72" height="52" rx="26" fill="${accent}"/>
        <rect x="-4" y="-26" width="8" height="52" fill="${dark}" opacity="0.35"/>
        <rect x="-72" y="-26" width="144" height="52" rx="26" fill="none" stroke="${dark}" stroke-opacity="0.25"/>
      </g>`;
    case 'syrup':
      return `<g transform="translate(118 145)">
        <rect x="-34" y="-100" width="68" height="22" rx="7" fill="${dark}"/>
        <rect x="-22" y="-80" width="44" height="18" fill="#ffffff" opacity="0.9"/>
        <rect x="-58" y="-64" width="116" height="150" rx="20" fill="#ffffff" opacity="0.96"/>
        <rect x="-58" y="6" width="116" height="62" rx="8" fill="${accent}" opacity="0.92"/>
        <text x="0" y="45" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="#ffffff">SYRUP</text>
      </g>`;
    case 'tube':
      return `<g transform="translate(118 145) rotate(-10)">
        <rect x="-30" y="-94" width="60" height="24" rx="7" fill="${dark}"/>
        <path d="M-42 -66 L42 -66 L32 70 A12 12 0 0 1 20 81 L-20 81 A12 12 0 0 1 -32 70 Z" fill="#ffffff" opacity="0.96"/>
        <rect x="-38" y="-18" width="76" height="50" rx="7" fill="${accent}" opacity="0.92"/>
        <text x="0" y="15" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">GEL</text>
        <rect x="-42" y="76" width="84" height="10" rx="3" fill="${dark}" opacity="0.6"/>
      </g>`;
    case 'spray':
      return `<g transform="translate(118 145)">
        <rect x="-18" y="-96" width="36" height="18" rx="5" fill="${dark}"/>
        <rect x="-30" y="-78" width="60" height="20" rx="7" fill="#ffffff" opacity="0.9"/>
        <rect x="-52" y="-58" width="104" height="140" rx="22" fill="#ffffff" opacity="0.96"/>
        <rect x="-52" y="0" width="104" height="58" rx="8" fill="${accent}" opacity="0.92"/>
        <text x="0" y="37" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">SPRAY</text>
        <circle cx="34" cy="-104" r="5" fill="#ffffff" opacity="0.8"/>
        <circle cx="50" cy="-94" r="4" fill="#ffffff" opacity="0.65"/>
        <circle cx="58" cy="-78" r="3" fill="#ffffff" opacity="0.5"/>
      </g>`;
    case 'sachet':
      return `<g transform="translate(118 145)">
        <path d="M-64 -86 H64 V64 A14 14 0 0 1 50 78 H-50 A14 14 0 0 1 -64 64 Z" fill="#ffffff" opacity="0.96"/>
        <path d="M-64 -86 L-52 -100 H52 L64 -86 Z" fill="${dark}"/>
        <rect x="-64" y="-28" width="128" height="58" fill="${accent}" opacity="0.92"/>
        <text x="0" y="9" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">SACHET</text>
        <circle cx="-34" cy="56" r="3" fill="${dark}" opacity="0.45"/>
        <circle cx="-14" cy="62" r="3" fill="${dark}" opacity="0.45"/>
        <circle cx="10" cy="54" r="3" fill="${dark}" opacity="0.45"/>
        <circle cx="32" cy="62" r="3" fill="${dark}" opacity="0.45"/>
      </g>`;
    case 'tablet':
      return `<g transform="translate(118 145) rotate(-8)">
        <rect x="-70" y="-56" width="140" height="112" rx="16" fill="#ffffff" opacity="0.96"/>
        <circle cx="-38" cy="-26" r="15" fill="${accent}" opacity="0.9"/>
        <circle cx="0" cy="-26" r="15" fill="${accent}" opacity="0.75"/>
        <circle cx="38" cy="-26" r="15" fill="${accent}" opacity="0.9"/>
        <circle cx="-38" cy="26" r="15" fill="${accent}" opacity="0.75"/>
        <circle cx="0" cy="26" r="15" fill="${accent}" opacity="0.9"/>
        <circle cx="38" cy="26" r="15" fill="${accent}" opacity="0.75"/>
        <path d="M-70 0 H70" stroke="${dark}" stroke-opacity="0.15"/>
      </g>`;
    default:
      return null;
  }
}

/** A simple, dependency-free SVG "product label". */
function svgFor(item) {
  const variety = VARIETIES[item.variety];
  const [line1, line2] = splitLabel(item.short || item.name);
  const form = item.form || FORMS[item.name] || 'tablet';
  const art = artFor(form, variety) || packArtFor(form, variety) || artFor('tablet', variety);
  const font = 'Arial, Helvetica, sans-serif';
  const badge = item.rx
    ? `<rect x="452" y="208" width="108" height="34" rx="17" fill="#ffffff"/>
       <text x="506" y="231" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="${variety.to}">Rx ONLY</text>`
    : `<rect x="452" y="208" width="108" height="34" rx="17" fill="#ffffff" opacity="0.22" stroke="#ffffff" stroke-opacity="0.55"/>
       <text x="506" y="231" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">OTC</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300" role="img" aria-label="${escapeXml(item.name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${variety.from}"/>
      <stop offset="1" stop-color="${variety.to}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="300" fill="url(#bg)"/>
  <circle cx="536" cy="34" r="118" fill="#ffffff" opacity="0.10"/>
  <circle cx="44" cy="286" r="92" fill="#ffffff" opacity="0.08"/>
  <rect x="22" y="20" width="556" height="260" rx="22" fill="#ffffff" opacity="0.10"/>
  <rect x="30" y="44" width="176" height="212" rx="22" fill="#ffffff" opacity="0.16"/>
  ${art}
  <text x="238" y="112" font-family="${font}" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(line1)}</text>
  ${line2 ? `<text x="238" y="148" font-family="${font}" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(line2)}</text>` : ''}
  <text x="238" y="184" font-family="${font}" font-size="15" font-weight="600" fill="#ffffff" opacity="0.9">${escapeXml(variety.label)}</text>
  <text x="238" y="252" font-family="${font}" font-size="13" fill="#ffffff" opacity="0.72">MediTrack · demo catalogue</text>
  ${badge}
</svg>
`;
}

// `--refresh-images` rewrites the committed SVGs in place (used after tweaking
// the artwork); without it an existing file is never touched.
const REFRESH_IMAGES = process.argv.includes('--refresh-images');

/** Write the product image if it is missing (or refresh it); returns its name. */
function writeImage(item, { force = false } = {}) {
  const filename = `seed-${slugify(item.name)}.svg`;
  const target = path.join(UPLOADS_DIR, filename);
  if (force || !fs.existsSync(target)) {
    fs.writeFileSync(target, svgFor(item), 'utf8');
  }
  return filename;
}

// 30 products across the seven varieties above. `mfdDays`/`expDays` are offsets
// from today, so the demo stays valid whenever it is seeded.
const ITEMS = [
  // ---------------------------------------------- Pain Relief & Fever
  { name: 'Paracetamol 500mg', short: 'Paracetamol 500mg', variety: 'pain', price: 35, stock: 120, mfdDays: -180, expDays: 540, refillDays: 15, rx: false, description: 'Fast relief from fever, headache and mild body pain. 15 tablets per strip.' },
  { name: 'Ibuprofen 400mg', short: 'Ibuprofen 400mg', variety: 'pain', price: 48, stock: 90, mfdDays: -200, expDays: 420, refillDays: 10, rx: false, description: 'Anti-inflammatory tablets for muscular pain, toothache and period cramps.' },
  { name: 'Diclofenac Gel 30g', short: 'Diclofenac Gel', variety: 'pain', price: 110, stock: 60, mfdDays: -150, expDays: 360, refillDays: 20, rx: false, description: 'Topical gel for sprains, back pain and joint stiffness. Apply twice daily.' },
  { name: 'Aspirin 75mg', short: 'Aspirin 75mg', variety: 'pain', price: 26, stock: 150, mfdDays: -210, expDays: 480, refillDays: 30, rx: false, description: 'Low-dose blood thinner taken daily to protect the heart. 14 tablets per strip.' },
  { name: 'Naproxen 250mg', short: 'Naproxen 250mg', variety: 'pain', price: 72, stock: 45, mfdDays: -160, expDays: 400, refillDays: 7, rx: true, description: 'Prescription pain reliever for arthritis and severe inflammation.' },

  // ---------------------------------------------- Cold, Cough & Allergy
  { name: 'Cetirizine 10mg', short: 'Cetirizine 10mg', variety: 'cold', price: 28, stock: 80, mfdDays: -180, expDays: 420, refillDays: 30, rx: false, description: 'Once-a-day antihistamine for sneezing, runny nose and itchy eyes.' },
  { name: 'Levocetirizine 5mg', short: 'Levocetirizine', variety: 'cold', price: 52, stock: 65, mfdDays: -190, expDays: 390, refillDays: 30, rx: false, description: 'Non-drowsy allergy tablets for hay fever and hives.' },
  { name: 'Dextromethorphan Syrup 100ml', short: 'Cough Syrup 100ml', variety: 'cold', price: 96, stock: 55, mfdDays: -140, expDays: 300, refillDays: 10, rx: false, description: 'Dry-cough suppressant syrup for day or night-time relief.' },
  { name: 'Saline Nasal Spray 20ml', short: 'Saline Spray 20ml', variety: 'cold', price: 85, stock: 70, mfdDays: -120, expDays: 540, refillDays: 30, rx: false, description: 'Sterile salt-water spray that clears a blocked nose without medicine.' },

  // ---------------------------------------------- Vitamins & Supplements
  { name: 'Vitamin D3 60K', short: 'Vitamin D3 60K', variety: 'vitamins', price: 95, stock: 60, mfdDays: -180, expDays: 365, refillDays: 30, rx: false, description: 'Weekly sachet for bone strength and vitamin D deficiency.' },
  { name: 'Vitamin C 500mg', short: 'Vitamin C 500mg', variety: 'vitamins', price: 145, stock: 75, mfdDays: -170, expDays: 420, refillDays: 30, rx: false, description: 'Chewable immunity support with 500 mg vitamin C per tablet.' },
  { name: 'Multivitamin Daily', short: 'Multivitamin Daily', variety: 'vitamins', price: 220, stock: 50, mfdDays: -150, expDays: 450, refillDays: 30, rx: false, description: 'Daily blend of essential vitamins and minerals for adults.' },
  { name: 'Iron + Folic Acid', short: 'Iron + Folic Acid', variety: 'vitamins', price: 118, stock: 64, mfdDays: -160, expDays: 400, refillDays: 30, rx: false, description: 'Supports healthy haemoglobin levels. Take once daily after a meal.' },
  { name: 'Zinc 50mg', short: 'Zinc 50mg', variety: 'vitamins', price: 88, stock: 58, mfdDays: -130, expDays: 430, refillDays: 30, rx: false, description: 'Zinc tablets to support immunity and skin healing.' },

  // ---------------------------------------------- Diabetes Care
  { name: 'Metformin 500mg', short: 'Metformin 500mg', variety: 'diabetes', price: 75, stock: 50, mfdDays: -180, expDays: 480, refillDays: 30, rx: true, description: 'First-line tablets that help control blood sugar in type 2 diabetes.' },
  { name: 'Glimepiride 2mg', short: 'Glimepiride 2mg', variety: 'diabetes', price: 96, stock: 48, mfdDays: -170, expDays: 420, refillDays: 30, rx: true, description: 'Once-daily tablets that lower blood sugar by boosting insulin release.' },
  { name: 'Insulin Glargine 100IU/ml', short: 'Insulin Glargine', variety: 'diabetes', price: 640, stock: 15, mfdDays: -90, expDays: 240, refillDays: 30, rx: true, description: 'Long-acting basal insulin pen for 24-hour glucose control. Keep refrigerated.' },

  // ---------------------------------------------- Heart & BP Care
  { name: 'Amlodipine 5mg', short: 'Amlodipine 5mg', variety: 'heart', price: 68, stock: 85, mfdDays: -180, expDays: 480, refillDays: 30, rx: true, description: 'Once-daily tablet for high blood pressure and angina.' },
  { name: 'Telmisartan 40mg', short: 'Telmisartan 40mg', variety: 'heart', price: 132, stock: 70, mfdDays: -150, expDays: 450, refillDays: 30, rx: true, description: 'Angiotensin receptor blocker for hypertension and kidney protection.' },
  { name: 'Atorvastatin 10mg', short: 'Atorvastatin 10mg', variety: 'heart', price: 118, stock: 76, mfdDays: -160, expDays: 420, refillDays: 30, rx: true, description: 'Lowers LDL cholesterol and reduces cardiovascular risk.' },
  { name: 'Clopidogrel 75mg', short: 'Clopidogrel 75mg', variety: 'heart', price: 156, stock: 52, mfdDays: -140, expDays: 390, refillDays: 30, rx: true, description: 'Anti-platelet tablet used after stents and heart attacks.' },

  // ---------------------------------------------- Antibiotics & Antifungals
  { name: 'Amoxicillin 500mg', short: 'Amoxicillin 500mg', variety: 'antibiotics', price: 120, stock: 40, mfdDays: -120, expDays: 300, refillDays: 5, rx: true, description: 'Broad-spectrum penicillin for respiratory and dental infections. Complete the course.' },
  { name: 'Azithromycin 250mg', short: 'Azithromycin', variety: 'antibiotics', price: 145, stock: 8, mfdDays: -130, expDays: 360, refillDays: 5, rx: true, description: 'Three-day macrolide course for chest and throat infections.' },
  { name: 'Cefixime 200mg', short: 'Cefixime 200mg', variety: 'antibiotics', price: 210, stock: 36, mfdDays: -110, expDays: 330, refillDays: 5, rx: true, description: 'Cephalosporin antibiotic for urinary and respiratory infections.' },
  { name: 'Fluconazole 150mg', short: 'Fluconazole 150mg', variety: 'antibiotics', price: 78, stock: 42, mfdDays: -150, expDays: 400, refillDays: 7, rx: true, description: 'Single-dose antifungal for vaginal and oral thrush.' },
  { name: 'Metronidazole 400mg', short: 'Metronidazole', variety: 'antibiotics', price: 64, stock: 55, mfdDays: -160, expDays: 380, refillDays: 5, rx: true, description: 'Antibiotic for gut and dental infections; avoid alcohol during the course.' },

  // ---------------------------------------------- Digestive & First Aid
  { name: 'Pantoprazole 40mg', short: 'Pantoprazole 40mg', variety: 'everyday', price: 102, stock: 66, mfdDays: -140, expDays: 420, refillDays: 30, rx: true, description: 'Daily proton-pump inhibitor for acid reflux and gastric ulcers.' },
  { name: 'ORS Powder Sachet', short: 'ORS Powder Sachet', variety: 'everyday', price: 22, stock: 180, mfdDays: -100, expDays: 540, refillDays: 1, rx: false, description: 'WHO-formula oral rehydration salts for dehydration after diarrhoea or heat.' },
  { name: 'Isabgol Husk 100g', short: 'Isabgol Husk', variety: 'everyday', price: 135, stock: 72, mfdDays: -120, expDays: 600, refillDays: 30, rx: false, description: 'Natural psyllium fibre that relieves constipation and supports gut health.' },
  // Already in the development database as "dettol liquid"; the seeder matches
  // it case-insensitively and only fills in the missing image/category/text.
  { name: 'Dettol Liquid', short: 'Dettol Liquid', variety: 'everyday', price: 76, stock: 95, mfdDays: -60, expDays: 720, refillDays: 30, rx: false, description: 'Antiseptic liquid for first aid, surface cleaning and personal hygiene. Dilute before use.' },
];

async function main() {
  await connectDB();
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  let created = 0;
  let enriched = 0;
  let skipped = 0;

  for (const item of ITEMS) {
    const category = VARIETIES[item.variety].label;

    // Case-insensitive so "Dettol Liquid" adopts the existing "dettol liquid"
    // row instead of creating a duplicate.
    const existing = await Medicine.findOne({
      name: new RegExp(`^${escapeRegex(item.name)}$`, 'i'),
    });

    if (existing) {
      // Never overwrite stock/price/dates someone may have edited; only fill in
      // what this seed adds (category, description, image).
      if (REFRESH_IMAGES && existing.image && existing.image.startsWith('seed-')) {
        // Redraw the seed artwork; the file name (and the DB row) stays the same.
        writeImage(item, { force: true });
      }

      const patch = {};
      if (!existing.category) patch.category = category;
      if (!existing.description) patch.description = item.description;
      if (!existing.image) patch.image = writeImage(item);

      if (Object.keys(patch).length > 0) {
        await Medicine.updateOne({ _id: existing._id }, { $set: patch });
        enriched += 1;
        console.log(`  + enriched existing row: ${existing.name}`);
      } else {
        skipped += 1;
      }
      continue;
    }

    await Medicine.create({
      name: item.name,
      mfd: isoDate(item.mfdDays),
      exp: isoDate(item.expDays),
      price: item.price,
      stock: item.stock,
      prescriptionRequired: Boolean(item.rx),
      refillDays: item.refillDays,
      category,
      description: item.description,
      image: writeImage(item),
    });
    created += 1;
  }

  const total = await Medicine.countDocuments();
  const varietyRows = await Medicine.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);

  console.log(
    `\n✅ Demo catalogue: ${created} created, ${enriched} enriched, ${skipped} already complete`
  );
  console.log(
    `   Seed list : ${ITEMS.length} products across ${Object.keys(VARIETIES).length} varieties`
  );
  console.log(`   Database  : "${mongoose.connection.name}" now holds ${total} product(s)`);
  varietyRows.forEach(({ _id, count }) => {
    console.log(`   • ${String(_id || '(uncategorised)').padEnd(30)} : ${count}`);
  });
  console.log('\n   Images: backend/uploads/seed-*.svg (served at /uploads/<file>)');
}

main()
  .catch((err) => {
    console.error(`❌ Could not seed the demo data: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
    await mongoose.connection.close().catch(() => {});
  });
