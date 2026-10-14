# Hanford RCT Recert Prep

A static study site for the Hanford Radiological Control Technician (RCT)
recertification exam. Two features:

- **Practice tests** — scored, browser-only quizzes with a full answer review
  (explanations + references). Supports multiple-choice, select-all, true/false,
  and numeric-entry questions.
- **Study guides** — downloadable PDFs.

No backend, no accounts, no tracking. Built with [Astro](https://astro.build).

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL it prints (default <http://localhost:4321>).

## Project layout

| Path | What it is |
| --- | --- |
| `src/data/questions.json` | The question bank. One array of question objects. |
| `src/data/quizzes.json` | Practice-test definitions (which categories, how many questions, pass %). |
| `src/data/study-guides.json` | PDF catalog shown on the Study Guides page. |
| `public/pdfs/` | Drop PDF files here. See `public/pdfs/README.md`. |
| `src/lib/quiz.ts` | Question/quiz types + sampling logic (source of truth for the data shapes). |
| `src/scripts/quiz-runner.ts` | The client-side quiz engine. |
| `scripts/import-questions.mjs` | CSV/TSV → `questions.json` importer. |

## Adding questions

**By hand:** edit `src/data/questions.json`. Each entry:

```jsonc
// multiple choice (single answer)
{
  "id": "con-014",
  "category": "Contamination Control",
  "type": "single",              // single | multi | truefalse | numeric
  "question": "…",
  "options": [{ "id": "a", "text": "…" }, { "id": "b", "text": "…" }],
  "correct": ["a"],              // array of option ids; multiple for "multi"
  "explanation": "…",            // shown in review (optional)
  "reference": "10 CFR 835.209"  // optional
}

// numeric
{
  "id": "dos-020",
  "category": "Dosimetry & Dose Assessment",
  "type": "numeric",
  "question": "…",
  "answer": 25,
  "tolerance": 0.5,             // optional, absolute; default 0
  "unit": "mrem/hr",           // optional label
  "explanation": "…"
}
```

**Note:** the original Word banks live in `content-raw/` on the author's PC and are not in the public repo (`npm run import:docx` needs them). The generated `src/data/questions.json` is what the site uses.

**From a spreadsheet:** export each sheet as CSV into `content-raw/`, then:

```bash
npm run import:questions
```

The first run drops `content-raw/_template.csv` showing the expected columns.
The importer validates everything and refuses to write if anything is wrong.

After importing, make sure every `categories` value in `src/data/quizzes.json`
matches a category that actually exists in the bank.

## Deploying

### GitHub Pages (included)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
One-time setup: in the repo, **Settings → Pages → Build and deployment →
Source → GitHub Actions**. The workflow figures out the correct site URL and
base path automatically (works for `user.github.io/repo` project sites and for
custom domains).

### Cloudflare Pages / Netlify

Both host the same output. Build command `npm run build`, output directory
`dist`. If serving from the domain root, no env vars are needed. If serving
from a subpath, set `SITE_BASE=/that-path` in the build environment.

## Disclaimer

Unofficial. Not affiliated with or endorsed by the U.S. Department of Energy or
any Hanford site contractor. For study only; not a substitute for
site-required training or official references.
