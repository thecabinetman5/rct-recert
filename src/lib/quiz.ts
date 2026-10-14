// ---------------------------------------------------------------------------
// Question + quiz data model
//
// One question bank (src/data/questions.json) feeds every practice test.
// Quiz definitions (src/data/quizzes.json) select from the bank by category
// and length. Keep this file the single source of truth for the shapes; the
// importer script (scripts/import-questions.mjs) must emit matching JSON.
// ---------------------------------------------------------------------------

export type QuestionType = 'single' | 'multi' | 'truefalse' | 'numeric' | 'match';

export interface Option {
  id: string; // stable within a question, e.g. "a", "b", "c"
  text: string;
}

export interface BaseQuestion {
  id: string; // globally unique, stable across imports
  category: string;
  type: QuestionType;
  question: string;
  explanation?: string;
  reference?: string; // e.g. "10 CFR 835.209" or "Objective 2.01.01"
  /** Source bank, e.g. "Fundamentals" or "Site Academics". */
  bank?: string;
  /** Path under the site base, e.g. "images/site-203.png". Shown with the stem. */
  image?: string;
}

export interface ChoiceQuestion extends BaseQuestion {
  type: 'single' | 'multi' | 'truefalse';
  options: Option[];
  correct: string[]; // option ids; length 1 for single/truefalse, >=1 for multi
}

export interface NumericQuestion extends BaseQuestion {
  type: 'numeric';
  answer: number;
  tolerance?: number; // absolute; default 0
  unit?: string;
}

/** Match each prompt to one of the choices. Graded all-or-nothing. */
export interface MatchQuestion extends BaseQuestion {
  type: 'match';
  prompts: Option[];
  choices: Option[];
  /** prompt id -> choice id */
  correct: Record<string, string>;
  /** true when one choice may answer several prompts */
  reuse?: boolean;
}

export type Question = ChoiceQuestion | NumericQuestion | MatchQuestion;

export interface QuizDef {
  slug: string;
  /** Heading the test is listed under on the Practice Tests page. */
  group?: string;
  title: string;
  description: string;
  /** Only questions filed under this objective id, e.g. "2.04.07". */
  objective?: string;
  /** Category names to draw from, or "*" for the whole bank. */
  categories: string[] | '*';
  /** Number of questions to serve; if more than available, serves all. */
  length: number;
  /** Randomize question order and sampling each attempt. */
  shuffle: boolean;
  /** Optional soft time limit in minutes, shown to the user (no auto-submit). */
  timeLimitMinutes?: number;
  /** Passing score as a percentage, e.g. 80. */
  passPercent: number;
}

export function isChoice(q: Question): q is ChoiceQuestion {
  return q.type === 'single' || q.type === 'multi' || q.type === 'truefalse';
}

export function isMatch(q: Question): q is MatchQuestion {
  return q.type === 'match';
}

export function isNumeric(q: Question): q is NumericQuestion {
  return q.type === 'numeric';
}

/** Deterministic-ish shuffle (Fisher–Yates with Math.random; fine for practice). */
export function shuffled<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick the questions for a quiz attempt from the full bank. */
export function selectForQuiz(bank: Question[], def: QuizDef): Question[] {
  const pool =
    def.categories === '*'
      ? bank
      : bank.filter((q) => (def.categories as string[]).includes(q.category));
  const inObjective = def.objective
    ? pool.filter((q) => q.reference === `Objective ${def.objective}`)
    : pool;
  const ordered = def.shuffle ? shuffled(inObjective) : inObjective;
  return ordered.slice(0, Math.min(def.length, ordered.length));
}
