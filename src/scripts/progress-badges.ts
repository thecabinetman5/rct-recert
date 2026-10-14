// Adds "Last 80%" badges next to practice links, and fills the home-page "Continue" strip.
import { load, chapterStats } from './progress';

const base = (document.querySelector('meta[name="site-base"]') as HTMLMetaElement | null)?.content ?? '/';
const p = load();

function decorate(): void {
  document.querySelectorAll<HTMLElement>('[data-prog-test]').forEach((el) => {
    const r = p.tests[el.dataset.progTest!];
    if (!r) return;
    const b = document.createElement('span');
    b.className = 'prog-badge' + (r.pct >= 80 ? ' good' : ' low');
    b.textContent = `Last ${r.pct}%`;
    b.title = `${r.correct} of ${r.answered} correct`;
    el.insertAdjacentElement('afterend', b);
  });
}

function continueStrip(): void {
  const box = document.getElementById('continue');
  if (!box) return;
  const last = p.lastTest ? p.tests[p.lastTest] : null;
  const stats = Object.values(chapterStats(p)).filter((s) => s.seen >= 3);
  stats.sort((a, b) => a.pct - b.pct || b.seen - a.seen);
  const weak = stats.find((s) => s.pct < 80);
  if (!last && !weak) return;
  const frag: string[] = [];
  if (last) {
    frag.push(
      `<div><strong>Pick up where you left off:</strong> <a href="${base}practice/${p.lastTest}">${esc(last.title)}</a> <span class="prog-badge ${last.pct >= 80 ? 'good' : 'low'}">Last ${last.pct}%</span></div>`,
    );
  }
  if (weak) {
    const id = weak.category.split(' ')[0];
    const book = id.startsWith('1.') ? 'fund' : 'site';
    frag.push(
      `<div><strong>Weakest chapter:</strong> <a href="${base}chapters/${book}/${id}">${esc(weak.category)}</a> (${weak.pct}% of ${weak.seen} answered) &middot; <a href="${base}progress">See all progress</a></div>`,
    );
  } else {
    frag.push(`<div><a href="${base}progress">See all progress</a></div>`);
  }
  box.innerHTML = frag.join('');
  box.hidden = false;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

decorate();
continueStrip();
