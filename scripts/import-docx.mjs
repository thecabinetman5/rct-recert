#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Word question-bank importer
//
// Reads the two Word question banks + answer keys in content-raw/ and writes:
//   src/data/questions.json     validated question bank
//   src/data/quizzes.json       generated practice-test definitions
//   public/images/*             images referenced by questions
//   content-raw/_skipped.md     questions that could not be imported
//                               (matching / fill-in-table) with raw key text
//
// Run:  npm run import:docx
//
// Source layout (see BANKS below): each bank is a .docx of questions plus a
// _key.docx whose answers appear in the same order as the questions.
// Letter answers are paired to questions by position; matching-style items
// have non-letter key entries and are reported rather than imported. The
// script aborts without writing if the key does not line up with the
// questions (count mismatch or a letter outside a question's options).
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocx } from './docx-extract.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const raw = path.join(root, 'content-raw');

const BANKS = [
  {
    id: 'fund',
    label: 'Fundamentals',
    questions: 'Fundamentals.docx',
    key: 'Fundamentals_key.docx',
    stemLists: [1, 309], // numbering ids whose level-0 items are question stems
    isSpecial: (t) =>
      /^(match |identify the radiation weighting|what are the units for the following|identify the regions)/i.test(t),
    // Official titles from the RCT Fundamental Academics table of contents
    // (Sep 2024); these override the document's all-caps headings.
    modules: {
      '1.01': 'Basic Mathematics and Algebra',
      '1.02': 'Unit Analysis and Conversion',
      '1.03': 'Physical Sciences',
      '1.04': 'Nuclear Physics',
      '1.05': 'Sources of Radiation',
      '1.06': 'Radioactivity and Radioactive Decay',
      '1.07': 'Interaction of Radiation with Matter',
      '1.08': 'Biological Effects of Radiation',
      '1.09': 'Radiation Protection Standards',
      '1.10': 'ALARA',
      '1.11': 'External Exposure Control',
      '1.12': 'Internal Exposure Control',
      '1.13': 'Radiation Detector Theory',
    },
  },
  {
    id: 'site',
    label: 'Site Academics',
    questions: 'Site_Academics.docx',
    key: 'Site_Academics_key.docx',
    stemLists: [26],
    isSpecial: (t) => /^(match |fill in the following|identify emergency exposure|how would the following)/i.test(t),
    isMulti: (t) => /^which of the following would be included in a logbook entry/i.test(t),
    // The Site document has no headings; modules are inferred from the
    // objective number in each stem, e.g. "(2.04.07)" -> module 2.04.
    modules: {
      // Official titles from the RCT/HPT Site Academics table of contents (Nov 2025).
      '2.01': 'Radiological Documentation',
      '2.02': 'Communication Systems',
      '2.03': 'Counting Errors and Statistics',
      '2.04': 'Dosimetry',
      '2.05': 'Contamination Control',
      '2.06': 'Airborne Sampling Program and Methods',
      '2.07': 'Respiratory Protection',
      '2.08': 'Radioactive Source Control',
      '2.09': 'Environmental Monitoring',
      '2.10': 'Access Control and Work Area Setup',
      '2.11': 'Radiological Work Coverage',
      '2.12': 'Shipment and Receipt of Radioactive Material',
      '2.13': 'Radiological Incidents and Emergencies',
      '2.14': 'Personnel Decontamination',
      '2.15': 'Radiological Considerations for First Aid',
      '2.16': 'Radiation Survey Instrumentation',
      '2.17': 'Contamination Monitoring Instrumentation',
      '2.18': 'Air Sampling Equipment',
      '2.19': 'Counting Room Equipment',
    },
  },
];

// Source-tag typos found by checking each tag against the book's objective list
// (objective numbers that don't exist in that chapter). Keyed by question id.
const OBJECTIVE_FIXES = {
  // Fundamentals: the 1.01.01 heading is a list item in the Word file, so these had no tag;
  // and the 1.01.09 heading is mistyped '1.09.09' in the source (book confirms 1.01.09).
  'fund-001': '1.01.01',
  'fund-002': '1.01.01',
  'fund-003': '1.01.01',
  'fund-004': '1.01.01',
  'fund-005': '1.01.01',
  'fund-006': '1.01.01',
  'fund-007': '1.01.01',
  'fund-008': '1.01.01',
  'fund-059': '1.01.09',
  'fund-060': '1.01.09',
  'fund-061': '1.01.09',
  'fund-062': '1.01.09',
  'fund-063': '1.01.09',
  'fund-064': '1.01.09',
  'fund-065': '1.01.09',
  'fund-066': '1.01.09',
  'site-313': '2.12.05', // shipment-limits question tagged 2.15.05; ch. 2.15 has only 4 objectives
  'site-469': '2.18.08', 'site-470': '2.18.08', 'site-471': '2.18.08', 'site-472': '2.18.08',
  'site-473': '2.18.08', // CAM operational checks tagged 2.18.09; ch. 2.18 ends at .08 (CAM operational checks)
};

// Matching questions. The Word files lay these out as two columns, so the
// importer needs to be told how to read each one. Answers always come from the
// key file (checked against the choices); nothing here supplies an answer.
//   combined: lines look like "Prompt 3. Choice" (choice numbers come from the lines)
//   choices:  choice list when the lines hold prompts only (keys then name a choice
//             by its 1-based number, or by its exact text)
//   reuse:    a choice may be used for more than one prompt
//   skip:     leave out (the key entries for it are skipped over)
const MATCH_SPECS = {
  'fund-088': { combined: true }, // SI prefixes
  'fund-104': { combined: true }, // forms of energy
  'fund-116': { combined: true, dropLines: [3], extraChoices: { 4: 'Indefinite volume / Indefinite shape' } }, // solid/liquid/gas (4th choice is an unnumbered line)
  'fund-134': { combined: true }, // A-Z-X notation
  'fund-167': { combined: true }, // k-effective
  'fund-242': { choices: ['1', '5', '10', '20'], reuse: true, keyMode: 'text' }, // radiation weighting factors
  'fund-259': { choices: ['eV / ion pair', 'ion pair / cm', 'keV / cm', 'cm'], reuse: true }, // units
  'fund-260': { combined: true },
  'fund-273': { combined: true }, // neutron classes
  'fund-279': { combined: true }, // shielding
  'fund-375': { combined: true }, // density-thickness (4th choice is an unnumbered line)
  'fund-415': {
    // gas amplification curve picture, regions numbered 1-6 on the figure
    prompts: ['Region 1', 'Region 2', 'Region 3', 'Region 4', 'Region 5', 'Region 6'],
    choices: ['Recombination', 'Ion Chamber', 'Proportional', 'Limited Proportional', 'GM', 'Continuous Discharge'],
  },
  'site-092': { skip: 21, note: 'fill-in table of dose limits; needs its table layout' },
  'site-093': { choices: ['5 Rem', '10 Rem', '&gt; 25 Rem'] },
  'site-106': { combined: true },
  'site-110': { combined: true },
  'site-111': { combined: true },
  'site-112': { combined: true },
  'site-203': { combined: true },
  'site-254': { choices: ['CA', 'HCA', 'RBA', 'RA', 'HRA', 'VHRA'] },
  'site-315': { combined: true },
  'site-334': { combined: true },
  'site-474': { combined: true },
  'site-475': { combined: true },
  'site-476': { combined: true },
};

const PASS_PERCENT = 80;
const FULL_EXAM_LENGTH = 50;
const MODULE_QUIZ_LENGTH = 20;

const errors = [];
const skipped = [];
const questions = [];
const imagesToCopy = [];

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOf\b/g, 'of')
    .replace(/Alara/g, 'ALARA')
    .replace(/&amp;/g, '&');

const clean = (s) =>
  s
    .replace(/<\/sup><sup>/g, '')
    .replace(/<\/sub><sub>/g, '')
    .replace(/(?<=[\d)]) x (?=[\d(])/g, ' × ')
    .replace(/\s+/g, ' ')
    .trim();

function splitObjective(stem) {
  // Trailing "(2.01.01)" or "(2.04.02 / 2.04.03)" tags; keep the last one.
  const re = /\s*\((\d\.\d\d\.\d\d(?:\s*\/\s*\d\.\d\d\.\d\d)*)\)\s*$/;
  const m = re.exec(stem);
  if (!m) return { text: stem, objective: null };
  return { text: stem.slice(0, m.index).trim(), objective: m[1].split('/')[0].trim() };
}

async function importBank(bank) {
  const q = await extractDocx(path.join(raw, bank.questions));
  const k = await extractDocx(path.join(raw, bank.key));

  // ---- parse stems + options ----
  const stems = [];
  let cur = null;
  let module = null;
  let headingObjective = null;
  for (const p of q.paras) {
    if (!p.text && !p.images.length) continue;
    if (p.numId === null) {
      const mod = /^(\d\.\d\d)\s+([A-Z][A-Z &/,\-()]+)$/.exec(p.text);
      const obj = /^(\d\.\d\d\.\d\d)\s/.exec(p.text);
      if (mod) {
        module = `${mod[1]} ${bank.modules?.[mod[1]] ?? titleCase(clean(mod[2]))}`;
        cur = null;
      } else if (obj) {
        headingObjective = obj[1];
        cur = null;
      } else if (cur && /^(\d{1,2})\.\s+(.+)$/.test(p.text)) {
        const em = /^(\d{1,2})\.\s+(.+)$/.exec(p.text);
        cur.extraChoices.push({ num: Number(em[1]), text: em[2] });
      } else if (cur && p.images.length) {
        cur.images.push(...p.images);
      }
      continue;
    }
    if (bank.stemLists.includes(p.numId) && p.ilvl === 0) {
      cur = { raw: clean(p.text), options: [], images: [], extraChoices: [], module, headingObjective, hasMath: p.math };
      stems.push(cur);
    } else if (cur) {
      cur.options.push({ text: clean(p.text), hasMath: p.math, images: p.images });
    }
  }

  // ---- parse key into events: single letters, or groups of non-letter lines ----
  const tokens = [];
  let group = null;
  for (const p of k.paras) {
    if (!p.text) continue;
    if (p.ilvl === 0 && /^[a-fA-F]$/.test(p.text)) {
      group = null;
      tokens.push({ letter: p.text.toLowerCase() });
    } else {
      if (!group) {
        group = { lines: [] };
        tokens.push(group);
      }
      group.lines.push(clean(p.text));
    }
  }

  // ---- pair stems with key tokens ----
  let ti = 0;
  let prevSpecial = false;
  let lastGroup = null;
  let groupPos = 0;
  let lastObjective = null;
  stems.forEach((s, i) => {
    const { text: rawText, objective } = splitObjective(s.raw);
    // Some matching stems print their own answer, e.g. "(4,5,4,1,3)". Never show that.
    // Also drop the stray procedure reference "(3.4.1.2)" / "(3,4.1.2)" some stems carry.
    const text = rawText.replace(/\s*\(\s*\d(?:\s*,\s*\d)+\s*\)/g, '').replace(/\s*\(3[.,]4\.1\.2\)/g, '').trim();
    const special = bank.isSpecial(text);
    const multi = bank.isMulti?.(text) ?? false;
    const where = `${bank.label} #${i + 1} "${text.slice(0, 60)}"`;
    const qid = `${bank.id}-${String(i + 1).padStart(3, '0')}`;

    // Category: heading context (Fundamentals) or objective prefix (Site).
    // Untagged stems inherit the previous question's objective (same module).
    const objectiveId = OBJECTIVE_FIXES[qid] ?? objective ?? s.headingObjective ?? lastObjective;
    lastObjective = objectiveId;
    let category = s.module;
    if (!category && objectiveId) {
      const modId = objectiveId.split('.').slice(0, 2).join('.');
      const name = bank.modules?.[modId];
      category = name ? `${modId} ${name}` : `Module ${modId}`;
    }
    category ??= 'Uncategorized';

    const base = { id: qid, bank: bank.label, category };
    const ref = objectiveId ? { reference: `Objective ${objectiveId}` } : {};
    const attachImage = (qObj) => {
      const imgs = [...new Set(s.images)].filter((f) => /\.(png|jpe?g|gif)$/i.test(f));
      if (imgs.length) {
        const name = `${qid}${path.extname(imgs[0]).toLowerCase()}`;
        qObj.image = `images/${name}`;
        imagesToCopy.push({ zip: q.zip, from: `word/${imgs[0]}`, name });
      }
    };

    // ------------------------------------------------------------------ matching
    if (special) {
      if (!prevSpecial) {
        const g = tokens[ti++];
        if (!g || g.letter) {
          errors.push(`${where}: expected a matching/table key group, found ${JSON.stringify(g)}`);
          lastGroup = null;
        } else {
          lastGroup = g;
        }
        groupPos = 0;
      }
      prevSpecial = true;
      const spec = MATCH_SPECS[qid];
      const optTexts = s.options.map((o) => o.text);
      if (!spec || spec.skip) {
        skipped.push({ bank: bank.label, n: i + 1, text, options: optTexts, key: lastGroup?.lines ?? [], note: spec?.note });
        groupPos += spec?.skip ?? optTexts.length;
        return;
      }

      // prompts + choices
      let prompts = [];
      const choiceByNum = {};
      if (spec.combined) {
        for (const [li, line] of optTexts.entries()) {
          if (spec.dropLines?.includes(li)) continue;
          const mm = /^(.*)\s+(\d{1,2})\.\s+(.+)$/.exec(line) ?? /^(.*)\s+(\d{1,2})\s+(.+)$/.exec(line);
          if (mm) {
            prompts.push(mm[1].trim());
            choiceByNum[Number(mm[2])] = mm[3].trim();
          } else {
            prompts.push(line);
          }
        }
        for (const ex of s.extraChoices) choiceByNum[ex.num] = ex.text;
        Object.assign(choiceByNum, spec.extraChoices ?? {});
      } else {
        prompts = spec.prompts ?? optTexts;
        (spec.choices ?? []).forEach((c, j) => (choiceByNum[j + 1] = c));
      }
      const nums = Object.keys(choiceByNum).map(Number).sort((a, b) => a - b);
      if (!nums.length || nums.some((n, j) => n !== j + 1)) {
        errors.push(`${where}: choice numbers are not 1..n (${nums.join(',')})`);
        return;
      }
      const choices = nums.map((n) => ({ id: `c${n}`, text: clean(choiceByNum[n]) }));
      const promptObjs = prompts.map((t, j) => ({ id: `p${j + 1}`, text: clean(t) }));

      // answers from the key
      const keyLines = (lastGroup?.lines ?? []).slice(groupPos, groupPos + promptObjs.length);
      groupPos += promptObjs.length;
      if (keyLines.length !== promptObjs.length) {
        errors.push(`${where}: key has ${keyLines.length} entries for ${promptObjs.length} prompts`);
        return;
      }
      const correct = {};
      let keyOk = true;
      keyLines.forEach((line, j) => {
        let choice;
        if (spec.keyMode !== 'text' && /^\d+$/.test(line)) choice = choices[Number(line) - 1];
        else choice = choices.find((c) => c.text === line);
        if (!choice) {
          errors.push(`${where}: key entry "${line}" matches no choice`);
          keyOk = false;
          return;
        }
        correct[`p${j + 1}`] = choice.id;
      });
      if (!keyOk) return;

      const qObj = {
        ...base,
        type: 'match',
        question: text,
        prompts: promptObjs,
        choices,
        correct,
        ...ref,
      };
      if (spec.reuse) qObj.reuse = true;
      if (spec.questionSuffix) qObj.question += spec.questionSuffix;
      attachImage(qObj);
      questions.push(qObj);
      return;
    }
    prevSpecial = false;

    // ------------------------------------------------------------------ choice questions
    const tok = tokens[ti++];
    if (!tok) {
      errors.push(`${where}: ran out of key entries`);
      return;
    }

    let correct;
    let type = 'single';
    if (multi) {
      const line = tok.lines?.[0] ?? '';
      if (!/^[a-l](\s*,\s*[a-l])*$/i.test(line)) {
        errors.push(`${where}: expected a multi-select key like "a,c,d", found ${JSON.stringify(tok)}`);
        return;
      }
      correct = line.toLowerCase().split(/\s*,\s*/);
      type = 'multi';
    } else {
      if (!tok.letter) {
        errors.push(`${where}: expected a letter key, found ${JSON.stringify(tok)}`);
        return;
      }
      correct = [tok.letter];
    }

    const ids = 'abcdefghijkl'.split('');
    if (s.options.length < 2) {
      errors.push(`${where}: only ${s.options.length} option(s)`);
      return;
    }
    const opts = s.options.map((o, j) => ({ id: ids[j], text: o.text }));
    if (opts.some((o) => !o.text)) {
      errors.push(`${where}: has an empty option`);
      return;
    }
    const bad = correct.filter((c) => !opts.some((o) => o.id === c));
    if (bad.length) {
      errors.push(`${where}: key "${bad.join(',')}" is outside its ${opts.length} options (key misaligned?)`);
      return;
    }
    if (s.options.some((o) => o.images.length)) {
      skipped.push({ bank: bank.label, n: i + 1, text, options: s.options.map((o) => o.text), key: [correct.join(',')], note: 'options contain images' });
      return;
    }

    const qObj = { ...base, type, question: text, options: opts, correct, ...ref };
    // The Word file shows the A-over-Z "X" notation as a picture (.wmf) that browsers cannot show.
    if (s.images.some((f) => /\.wmf$/i.test(f)) && /symbol represents in the/i.test(text)) {
      qObj.question += ' ${}^{A}_{Z}\\mathrm{X}$';
    }
    attachImage(qObj);
    questions.push(qObj);
  });

  if (ti !== tokens.length) {
    errors.push(`${bank.label}: ${tokens.length - ti} key entries left over after pairing (of ${tokens.length}); key and questions are out of sync`);
  }
  console.log(`${bank.label}: ${stems.length} stems, ${tokens.length} key entries -> ${questions.filter((x) => x.bank === bank.label).length} imported, ${skipped.filter((x) => x.bank === bank.label).length} skipped`);
}

for (const b of BANKS) await importBank(b);

if (errors.length) {
  console.error(`\n${errors.length} problem(s) — nothing written:\n`);
  for (const e of errors.slice(0, 50)) console.error('  - ' + e);
  process.exit(1);
}

// ---- write images ----
const imgDir = path.join(root, 'public', 'images');
fs.mkdirSync(imgDir, { recursive: true });
for (const im of imagesToCopy) {
  fs.writeFileSync(path.join(imgDir, im.name), await im.zip.file(im.from).async('nodebuffer'));
}

// ---- write questions (drop bookkeeping field) ----
const out = questions.map(({ reviewNote, ...rest }) => rest);
fs.writeFileSync(path.join(root, 'src', 'data', 'questions.json'), JSON.stringify(out, null, 2) + '\n');

// ---- generate quiz definitions ----
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const quizzes = [];
for (const b of BANKS) {
  const inBank = out.filter((x) => x.bank === b.label);
  const cats = [...new Set(inBank.map((x) => x.category))].sort();
  quizzes.push({
    slug: `${b.id}-full-exam`,
    group: b.label,
    title: `${b.label} — Full Practice Exam`,
    description: `A random mix of questions from every ${b.label} module.`,
    categories: cats,
    length: Math.min(FULL_EXAM_LENGTH, inBank.length),
    shuffle: true,
    passPercent: PASS_PERCENT,
  });
  for (const c of cats) {
    const n = inBank.filter((x) => x.category === c).length;
    quizzes.push({
      slug: `${b.id}-${slugify(c)}`,
      group: b.label,
      title: c,
      description: `${n} question${n === 1 ? '' : 's'} in this module.`,
      categories: [c],
      length: Math.min(MODULE_QUIZ_LENGTH, n),
      shuffle: true,
      passPercent: PASS_PERCENT,
    });
  }
}
fs.writeFileSync(path.join(root, 'src', 'data', 'quizzes.json'), JSON.stringify(quizzes, null, 2) + '\n');

// ---- skipped report ----
const md = ['# Questions not imported', '', 'These use formats the practice engine does not support yet (matching, fill-in table) or need a manual look.', ''];
for (const s of skipped) {
  md.push(`## ${s.bank} #${s.n}: ${s.text}`, '');
  if (s.note) md.push(`_${s.note}_`, '');
  s.options.forEach((o) => md.push(`- ${o}`));
  md.push('', `Key: ${s.key.join(' | ') || '(none)'}`, '');
}
fs.writeFileSync(path.join(raw, '_skipped.md'), md.join('\n'));

console.log(`\nWrote ${out.length} questions, ${quizzes.length} quizzes, ${imagesToCopy.length} image(s).`);
console.log(`Skipped ${skipped.length} (see content-raw/_skipped.md).`);
const byCat = {};
out.forEach((x) => (byCat[x.category] = (byCat[x.category] || 0) + 1));
console.log(Object.entries(byCat).sort().map(([c, n]) => `  ${n}\t${c}`).join('\n'));
