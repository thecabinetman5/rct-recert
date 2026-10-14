#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Question importer
//
// Reads every .csv / .tsv file in content-raw/ and writes a validated
// src/data/questions.json. Run it with:  npm run import:questions
//
// Expected columns (header row, case-insensitive, order-independent):
//
//   id          unique, stable slug (e.g. "con-014"). If blank, one is
//               generated from category + row number.
//   category    topic area, exactly as you want it grouped/displayed
//   type        single | multi | truefalse | numeric
//   question    the stem text
//   option_a .. option_h   answer choices (leave trailing ones blank)
//   correct     for single/truefalse: one letter (a, b, ...) OR "true"/"false"
//               for multi: several letters separated by | or , (e.g. "a|c|d")
//   answer      numeric questions only: the correct number
//   tolerance   numeric questions only: allowed +/- (default 0)
//   unit        optional label shown next to the numeric input
//   explanation shown in the answer review (optional but recommended)
//   reference   citation, e.g. "10 CFR 835.202" (optional)
//
// A template you can copy is written to content-raw/_template.csv on first run.
// Existing questions.json is backed up to questions.json.bak before overwrite.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rawDir = path.join(root, 'content-raw');
const outFile = path.join(root, 'src', 'data', 'questions.json');

const LETTERS = 'abcdefgh'.split('');
const TYPES = new Set(['single', 'multi', 'truefalse', 'numeric']);

function parseDelimited(text, delim) {
  // Minimal RFC-4180-ish parser: handles quoted fields, embedded delim/newline,
  // and doubled quotes. Returns array of string arrays.
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
    return o;
  });
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

const errors = [];
const seenIds = new Set();
const out = [];

function convert(o, source, lineNo) {
  const where = `${source} row ${lineNo}`;
  const type = (o.type || '').toLowerCase();
  if (!TYPES.has(type)) {
    errors.push(`${where}: unknown type "${o.type}" (expected ${[...TYPES].join(', ')})`);
    return null;
  }
  const category = o.category || 'Uncategorized';
  let id = o.id || `${slugify(category)}-${String(lineNo).padStart(3, '0')}`;
  if (seenIds.has(id)) {
    errors.push(`${where}: duplicate id "${id}"`);
    return null;
  }
  seenIds.add(id);

  if (!o.question) {
    errors.push(`${where}: empty question text`);
    return null;
  }

  const base = { id, category, type, question: o.question };
  if (o.explanation) base.explanation = o.explanation;
  if (o.reference) base.reference = o.reference;

  if (type === 'numeric') {
    const answer = Number(o.answer);
    if (Number.isNaN(answer)) {
      errors.push(`${where}: numeric question needs a valid "answer" (got "${o.answer}")`);
      return null;
    }
    base.answer = answer;
    if (o.tolerance) base.tolerance = Number(o.tolerance) || 0;
    if (o.unit) base.unit = o.unit;
    return base;
  }

  let options;
  let correct;
  if (type === 'truefalse') {
    options = [
      { id: 't', text: 'True' },
      { id: 'f', text: 'False' },
    ];
    const v = (o.correct || '').toLowerCase();
    if (v !== 'true' && v !== 'false' && v !== 't' && v !== 'f') {
      errors.push(`${where}: truefalse "correct" must be true or false (got "${o.correct}")`);
      return null;
    }
    correct = [v.startsWith('t') ? 't' : 'f'];
  } else {
    options = LETTERS.map((L) => ({ id: L, text: o[`option_${L}`] || '' })).filter(
      (opt) => opt.text !== '',
    );
    if (options.length < 2) {
      errors.push(`${where}: need at least 2 option_x columns filled in`);
      return null;
    }
    const letters = (o.correct || '')
      .split(/[|,;/\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const valid = new Set(options.map((opt) => opt.id));
    const bad = letters.filter((L) => !valid.has(L));
    if (bad.length) {
      errors.push(`${where}: "correct" references missing option(s): ${bad.join(', ')}`);
      return null;
    }
    if (type === 'single' && letters.length !== 1) {
      errors.push(`${where}: single-answer question must have exactly one "correct" letter`);
      return null;
    }
    if (type === 'multi' && letters.length < 1) {
      errors.push(`${where}: multi question needs at least one "correct" letter`);
      return null;
    }
    correct = letters;
  }
  return { ...base, options, correct };
}

function writeTemplate() {
  const tpl = path.join(rawDir, '_template.csv');
  if (fs.existsSync(tpl)) return;
  const rows = [
    'id,category,type,question,option_a,option_b,option_c,option_d,correct,answer,tolerance,unit,explanation,reference',
    'ex-001,Radiation Fundamentals,single,"What defines an element?",Atomic number,Mass number,Neutron count,Electron count,a,,,,"The atomic number (proton count) defines the element.",DOE-HDBK-1122',
    'ex-002,Dosimetry & Dose Assessment,numeric,"400 mrem/hr at 1 ft; dose rate at 4 ft?",,,,,,25,0,mrem/hr,"Inverse square: 400/(4^2) = 25.",',
    'ex-003,Contamination Control,truefalse,"Compressed air is an acceptable way to fix contamination.",,,,,false,,,,"It disperses contamination and creates airborne activity.",DOE-STD-1098',
    'ex-004,Detection Instruments,multi,"Which are gas-filled detectors? (select all)",Ion chamber,GM tube,NaI scintillator,Proportional counter,a|b|d,,,,"Scintillators are not gas-filled.",',
  ];
  fs.writeFileSync(tpl, rows.join('\n') + '\n');
  console.log(`Wrote a starter template: ${path.relative(root, tpl)}`);
}

// --- main ---
if (!fs.existsSync(rawDir)) {
  console.error(`No content-raw/ directory found at ${rawDir}`);
  process.exit(1);
}
writeTemplate();

const files = fs
  .readdirSync(rawDir)
  .filter((f) => /\.(csv|tsv)$/i.test(f) && !f.startsWith('_template'));

if (!files.length) {
  console.log('No .csv or .tsv files in content-raw/ yet.');
  console.log('Copy content-raw/_template.csv, fill it in, and re-run: npm run import:questions');
  process.exit(0);
}

for (const f of files) {
  const full = path.join(rawDir, f);
  const delim = f.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  const objs = toObjects(parseDelimited(fs.readFileSync(full, 'utf8'), delim));
  console.log(`${f}: ${objs.length} rows`);
  objs.forEach((o, i) => {
    const q = convert(o, f, i + 2); // +2: 1 for header, 1 for 1-based
    if (q) out.push(q);
  });
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s) found — nothing written:\n`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

if (fs.existsSync(outFile)) {
  fs.copyFileSync(outFile, outFile + '.bak');
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`\nWrote ${out.length} questions to ${path.relative(root, outFile)}`);
const cats = [...new Set(out.map((q) => q.category))].sort();
console.log(`Categories (${cats.length}): ${cats.join(', ')}`);
console.log('\nNext: check src/data/quizzes.json so each quiz references categories that exist.');
