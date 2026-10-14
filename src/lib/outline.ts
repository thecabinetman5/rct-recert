import katex from 'katex';
import outline from '../data/outline.mjs';
import questions from '../data/questions.json';
import quizzes from '../data/quizzes.json';

export interface Objective { id: string; text: string; items?: string[] }
export interface Section { num: string; title: string; subs?: { num: string; title: string }[] }
export interface Chapter { id: string; title: string; objectives: Objective[]; sections?: Section[] }
export interface Book { id: string; bank: string; title: string; blurb: string; chapters: Chapter[] }

export const books = outline as Book[];

/** Typeset $...$ math in a rich string (server side). */
export function rich(s: string): string {
  return s.replace(/\$([^$]+)\$/g, (_, tex: string) => katex.renderToString(tex, { throwOnError: false }));
}

export function categoryOf(book: Book, ch: Chapter): string {
  return `${ch.id} ${ch.title}`;
}

/** Questions in a chapter, keyed by objective id (e.g. "2.04.07"). */
export function countsByObjective(book: Book, ch: Chapter): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of questions as any[]) {
    if (q.bank !== book.bank || !q.category.startsWith(ch.id + ' ')) continue;
    const id = /Objective (\d\.\d\d\.\d\d)/.exec(q.reference ?? '')?.[1];
    if (id) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

export function questionCount(book: Book, ch: Chapter): number {
  return (questions as any[]).filter((q) => q.bank === book.bank && q.category.startsWith(ch.id + ' ')).length;
}

/** Slug of the single-chapter practice test, if one exists. */
export function chapterQuizSlug(book: Book, ch: Chapter): string | null {
  const cat = categoryOf(book, ch);
  const q = (quizzes as any[]).find((x) => Array.isArray(x.categories) && x.categories.length === 1 && x.categories[0] === cat);
  return q?.slug ?? null;
}

/** objective id -> wording, for the answer review on quiz pages */
export function objectiveTexts(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const b of books) for (const c of b.chapters) for (const o of c.objectives) m[o.id] = o.text.replace(/:$/, '');
  return m;
}

/** Cut at a word boundary so titles never end mid-word. */
function shorten(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:s]+$/, '') + '…';
}

export function objectiveQuizSlug(id: string): string {
  return 'obj-' + id.split('.').join('-');
}

/** Plain-text version of a rich string (no tags or math), for titles. */
export function plain(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/[$][^$]*[$]/g, '…').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/:$/, '');
}

/** One practice test per objective that has questions. Built at build time, not stored. */
export function objectiveQuizzes() {
  const out: any[] = [];
  for (const b of books) {
    for (const c of b.chapters) {
      const counts = countsByObjective(b, c);
      for (const obj of c.objectives) {
        const n = counts[obj.id] ?? 0;
        if (!n) continue;
        out.push({
          slug: objectiveQuizSlug(obj.id),
          group: b.bank,
          title: `${obj.id} ${shorten(plain(obj.text), 70)}`,
          description: plain(obj.text),
          categories: [categoryOf(b, c)],
          objective: obj.id,
          length: Math.min(20, n),
          shuffle: true,
          passPercent: 80,
        });
      }
    }
  }
  return out;
}
