// Progress is kept in this browser only (localStorage). Nothing is sent anywhere,
// and it does not follow the person to another device. Every access is wrapped in
// try/catch because storage can be blocked (private windows, cleared site data).

const KEY = 'rct-progress-v1';
/** An attempt must answer at least this many questions (or all, if the test is shorter) to count as a test result. */
export const MIN_ANSWERED = 5;

export interface TestResult {
  title: string;
  pct: number;
  correct: number;
  answered: number;
  total: number;
  ts: number;
}

export interface QuestionResult {
  /** category, e.g. "2.04 Dosimetry" */
  c: string;
  /** objective id, e.g. "2.04.07" (may be empty) */
  o: string;
  ok: boolean;
  ts: number;
}

export interface Progress {
  v: 1;
  /** most recent counted result per test slug */
  tests: Record<string, TestResult>;
  /** latest outcome per question id */
  q: Record<string, QuestionResult>;
  lastTest?: string;
}

const empty = (): Progress => ({ v: 1, tests: {}, q: {} });

export function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw);
    return p && p.v === 1 && p.tests && p.q ? p : empty();
  } catch {
    return empty();
  }
}

function save(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress simply isn't kept */
  }
}

export function reset(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export interface AttemptItem {
  id: string;
  category: string;
  reference?: string;
  correct: boolean;
}

/**
 * Record a finished attempt.
 * - Every answered question updates its own latest outcome.
 * - The test's "last result" is replaced only when the attempt answered enough questions,
 *   and never by a "retake missed" run (a hand-picked subset).
 */
export function recordAttempt(opts: {
  slug: string;
  title: string;
  total: number;
  items: AttemptItem[];
  subset: boolean;
}): void {
  const p = load();
  const now = Date.now();
  for (const it of opts.items) {
    p.q[it.id] = {
      c: it.category,
      o: /Objective (\d\.\d\d\.\d\d)/.exec(it.reference ?? '')?.[1] ?? '',
      ok: it.correct,
      ts: now,
    };
  }
  const answered = opts.items.length;
  const enough = answered >= Math.min(MIN_ANSWERED, opts.total);
  if (enough && !opts.subset) {
    const correct = opts.items.filter((i) => i.correct).length;
    p.tests[opts.slug] = {
      title: opts.title,
      pct: Math.round((correct / answered) * 100),
      correct,
      answered,
      total: opts.total,
      ts: now,
    };
    p.lastTest = opts.slug;
  }
  save(p);
}

export interface ChapterStat {
  category: string;
  seen: number;
  correct: number;
  pct: number;
}

/** Accuracy per chapter, from each question's latest outcome. */
export function chapterStats(p: Progress): Record<string, ChapterStat> {
  const out: Record<string, ChapterStat> = {};
  for (const r of Object.values(p.q)) {
    const s = (out[r.c] ??= { category: r.c, seen: 0, correct: 0, pct: 0 });
    s.seen++;
    if (r.ok) s.correct++;
  }
  for (const s of Object.values(out)) s.pct = Math.round((s.correct / s.seen) * 100);
  return out;
}

export interface ObjectiveStat {
  id: string;
  category: string;
  seen: number;
  correct: number;
  pct: number;
}

export function objectiveStats(p: Progress): Record<string, ObjectiveStat> {
  const out: Record<string, ObjectiveStat> = {};
  for (const r of Object.values(p.q)) {
    if (!r.o) continue;
    const s = (out[r.o] ??= { id: r.o, category: r.c, seen: 0, correct: 0, pct: 0 });
    s.seen++;
    if (r.ok) s.correct++;
  }
  for (const s of Object.values(out)) s.pct = Math.round((s.correct / s.seen) * 100);
  return out;
}
