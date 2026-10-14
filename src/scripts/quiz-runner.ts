// Client-side practice-test engine. Framework-free. Given the eligible question
// pool and a quiz definition, it samples an attempt, walks the user through it
// one question at a time, scores it, and renders a full review.
//
// Question text is "rich": HTML-escaped text with <sup>/<sub>, and LaTeX between
// $...$ (rendered with KaTeX). It comes from our own import script, never from users.

import katex from 'katex';
import { recordAttempt } from './progress';
import {
  isChoice,
  isMatch,
  isNumeric,
  selectForQuiz,
  shuffled,
  type Question,
  type ChoiceQuestion,
  type MatchQuestion,
  type NumericQuestion,
  type QuizDef,
} from '../lib/quiz';

interface Payload {
  quiz: QuizDef;
  pool: Question[];
  /** objective id ("2.01.01") -> objective text, for the review screen */
  objectives?: Record<string, string>;
}

type Answer = string[] | number | Record<string, string> | null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/** Turn rich text into HTML, typesetting any $...$ math. */
function rich(html: string): string {
  return html.replace(/\$([^$]+)\$/g, (_, tex: string) => {
    try {
      return katex.renderToString(tex, { throwOnError: false });
    } catch {
      return tex;
    }
  });
}

function richEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  html: string,
): HTMLElementTagNameMap[K] {
  const node = el(tag, attrs);
  node.innerHTML = rich(html);
  return node;
}

function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function isAnswered(q: Question, a: Answer): boolean {
  if (a === null) return false;
  if (isNumeric(q)) return typeof a === 'number' && !Number.isNaN(a);
  if (isMatch(q)) {
    const m = a as Record<string, string>;
    return q.prompts.every((p) => !!m[p.id]);
  }
  return Array.isArray(a) && a.length > 0;
}

function gradeOne(q: Question, a: Answer): boolean {
  if (!isAnswered(q, a)) return false;
  if (isNumeric(q)) {
    const tol = q.tolerance ?? 0;
    return Math.abs((a as number) - q.answer) <= tol + 1e-9;
  }
  if (isMatch(q)) {
    const m = a as Record<string, string>;
    return q.prompts.every((p) => m[p.id] === q.correct[p.id]);
  }
  return arraysEqualAsSets(a as string[], (q as ChoiceQuestion).correct);
}

function fmtChoiceAnswer(q: ChoiceQuestion, ids: string[] | null): string {
  if (!ids || ids.length === 0) return '(no answer)';
  return ids.map((id) => q.options.find((o) => o.id === id)?.text ?? id).join('; ');
}

function fmtNumericAnswer(q: NumericQuestion, val: number | null): string {
  if (val === null || Number.isNaN(val)) return '(no answer)';
  return q.unit ? `${val} ${q.unit}` : String(val);
}

function choiceText(q: MatchQuestion, id: string | undefined): string {
  return q.choices.find((c) => c.id === id)?.text ?? '(no answer)';
}

export function runQuiz(payload: Payload): void {
  const root = document.getElementById('quiz-root');
  if (!root) return;
  const passPercent = Number(root.dataset.passpercent ?? '80');

  const beginBtn = document.getElementById('btn-begin');
  beginBtn?.addEventListener('click', () => start());

  function start(only?: Question[]): void {
    // `only` = a specific set of questions (used to retake the ones just missed).
    const questions = only ? shuffled(only) : selectForQuiz(payload.pool.slice(), payload.quiz);
    const isSubset = !!only;
    const answers: Answer[] = questions.map(() => null);
    // Questions the user has checked (locked, with feedback shown).
    const checked: boolean[] = questions.map(() => false);
    // Matching choices are shown in a random order (stable within one attempt).
    const choiceOrder = new Map<number, string[]>();
    let index = 0;
    const startedAt = Date.now();

    root.innerHTML = '';
    const card = el('div', { class: 'quiz' });
    root.append(card);

    const timerNote = payload.quiz.timeLimitMinutes ? el('span', {}, '') : null;
    let timerId = 0;
    if (timerNote) {
      const limit = payload.quiz.timeLimitMinutes! * 60;
      const tick = () => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const remaining = limit - elapsed;
        const sign = remaining < 0 ? '+' : '';
        const s = Math.abs(remaining);
        const mm = Math.floor(s / 60);
        const ss = String(s % 60).padStart(2, '0');
        timerNote.textContent = `Time: ${sign}${mm}:${ss}`;
        timerNote.style.color = remaining < 0 ? 'var(--bad)' : 'var(--text-muted)';
      };
      tick();
      timerId = window.setInterval(tick, 1000);
    }

    function render(): void {
      const q = questions[index];
      card.innerHTML = '';
      card.dataset.qid = q.id;

      const progress = el('div', { class: 'quiz-progress' });
      progress.append(el('span', {}, `Question ${index + 1} of ${questions.length}`));
      if (timerNote) progress.append(timerNote);
      progress.append(
        el('span', {}, `${answers.filter((a, i) => isAnswered(questions[i], a)).length} answered`),
      );
      card.append(progress);

      const bar = el('div', { class: 'quiz-bar' });
      bar.append(el('span', { style: `width:${((index + 1) / questions.length) * 100}%` }));
      card.append(bar);

      card.append(el('div', { class: 'q-cat' }, q.category));
      card.append(richEl('p', { class: 'q-text' }, q.question));
      if (q.image) {
        card.append(
          el('img', {
            class: 'q-image',
            src: import.meta.env.BASE_URL + q.image,
            alt: 'Figure for this question',
          }),
        );
      }

      if (isChoice(q) && q.options.some((o) => o.text.includes('<strong>'))) {
        card.append(el('p', { class: 'file-desc', style: 'margin:-0.5rem 0 0.75rem;' }, 'Note: bold words are part of each answer choice.'));
      }
      if (isChoice(q)) {
        const multi = q.type === 'multi';
        const list = el('ul', { class: 'options' });
        if (multi) {
          card.append(el('p', { class: 'file-desc', style: 'margin:-0.5rem 0 0.75rem;' }, 'Select all that apply.'));
        }
        for (const opt of q.options) {
          const input = el('input', {
            type: multi ? 'checkbox' : 'radio',
            name: `q${index}`,
            value: opt.id,
          }) as HTMLInputElement;
          const cur = answers[index];
          if (Array.isArray(cur) && cur.includes(opt.id)) input.checked = true;
          input.addEventListener('change', () => {
            if (multi) {
              const set = new Set(Array.isArray(answers[index]) ? (answers[index] as string[]) : []);
              if (input.checked) set.add(opt.id);
              else set.delete(opt.id);
              answers[index] = [...set];
            } else {
              answers[index] = [opt.id];
            }
            syncNav();
          });
          const label = el('label', { class: 'option' }, input, richEl('span', {}, opt.text));
          if (checked[index]) {
            input.disabled = true;
            if (q.correct.includes(opt.id)) label.classList.add('is-correct');
            else if (input.checked) label.classList.add('is-wrong');
          }
          list.append(label);
        }
        card.append(list);
      } else if (isMatch(q)) {
        card.append(
          el(
            'p',
            { class: 'file-desc', style: 'margin:-0.5rem 0 0.75rem;' },
            q.reuse
              ? 'Choose an answer for each item. An answer can be used more than once.'
              : 'Choose the matching answer for each item.',
          ),
        );
        let order = choiceOrder.get(index);
        if (!order) {
          order = shuffled(q.choices.map((c) => c.id));
          choiceOrder.set(index, order);
        }
        const rows = el('div', { class: 'match' });
        for (const p of q.prompts) {
          const sel = el('select', { class: 'match-select', 'aria-label': `Answer for ${p.text.replace(/<[^>]+>|\$/g, '')}` }) as HTMLSelectElement;
          sel.append(el('option', { value: '' }, '— choose —'));
          for (const id of order) {
            const opt = el('option', { value: id });
            // <option> cannot hold markup, so show a plain-text version
            opt.textContent = choiceText(q, id).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            sel.append(opt);
          }
          const cur = answers[index] as Record<string, string> | null;
          if (cur?.[p.id]) sel.value = cur[p.id];
          if (checked[index]) sel.disabled = true;
          sel.addEventListener('change', () => {
            const next = { ...((answers[index] as Record<string, string> | null) ?? {}) };
            if (sel.value) next[p.id] = sel.value;
            else delete next[p.id];
            answers[index] = Object.keys(next).length ? next : null;
            syncNav();
          });
          const rowEl = el('div', { class: 'match-row' }, richEl('div', { class: 'match-prompt' }, p.text), sel);
          if (checked[index]) {
            const ok = cur?.[p.id] === q.correct[p.id];
            rowEl.classList.add(ok ? 'is-correct' : 'is-wrong');
            if (!ok) rowEl.append(richEl('div', { class: 'match-fix' }, `Correct: ${choiceText(q, q.correct[p.id])}`));
          }
          rows.append(rowEl);
        }
        card.append(rows);
      } else if (isNumeric(q)) {
        const wrap = el('div', { style: 'margin-bottom:1.25rem;' });
        const input = el('input', {
          type: 'number',
          step: 'any',
          class: 'numeric-input',
          inputmode: 'decimal',
          'aria-label': 'Your numeric answer',
        }) as HTMLInputElement;
        const cur = answers[index];
        if (typeof cur === 'number' && !Number.isNaN(cur)) input.value = String(cur);
        if (checked[index]) input.disabled = true;
        input.addEventListener('input', () => {
          answers[index] = input.value === '' ? null : Number(input.value);
          syncNav();
        });
        wrap.append(input);
        if (q.unit) wrap.append(el('span', { class: 'numeric-unit' }, q.unit));
        card.append(wrap);
      }

      if (checked[index]) {
        const ok = gradeOne(q, answers[index]);
        const box = el('div', { class: `feedback ${ok ? 'correct' : 'incorrect'}`, role: 'status' });
        box.append(el('div', { class: 'verdict' }, ok ? '✓ Correct' : '✗ Incorrect'));
        if (!ok && !isMatch(q)) {
          box.append(
            richEl(
              'div',
              {},
              `Correct answer: ${
                isNumeric(q) ? fmtNumericAnswer(q, q.answer) : fmtChoiceAnswer(q as ChoiceQuestion, (q as ChoiceQuestion).correct)
              }`,
            ),
          );
        }
        if (q.explanation) box.append(el('div', { class: 'fb-exp' }, q.explanation));
        const objId = /Objective (d.dd.dd)/.exec(q.reference ?? '')?.[1];
        if (objId) {
          const t = payload.objectives?.[objId];
          box.append(richEl('div', { class: 'fb-ref' }, t ? `Objective ${objId} — ${t}` : `Objective ${objId}`));
        }
        card.append(box);
        // bring the verdict into view (the pinned bar would otherwise hide it below the fold)
        window.requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
      }

      // Controls live in a bar pinned to the bottom of the screen on phones.
      const go = (to: number) => {
        index = Math.max(0, Math.min(questions.length - 1, to));
        render();
        card.scrollIntoView({ block: 'start' });
      };
      const nav = el('div', { class: 'q-nav' });
      const prev = el('button', { class: 'btn secondary q-prev', type: 'button', 'aria-label': 'Previous question' }) as HTMLButtonElement;
      prev.innerHTML = '<span aria-hidden="true">←</span><span class="lbl"> Previous</span>';
      prev.disabled = index === 0;
      prev.addEventListener('click', () => go(index - 1));

      const check = el('button', { class: 'btn secondary q-check', type: 'button', id: 'btn-check' }) as HTMLButtonElement;
      check.innerHTML = 'Check<span class="lbl"> answer</span>';
      check.disabled = checked[index] || !isAnswered(q, answers[index]);
      if (checked[index]) check.style.display = 'none';
      check.addEventListener('click', () => {
        if (!isAnswered(q, answers[index])) return;
        checked[index] = true;
        render();
      });

      const next = el('button', { class: 'btn q-next', type: 'button' }, 'Next →') as HTMLButtonElement;
      if (index >= questions.length - 1) next.style.display = 'none';
      next.addEventListener('click', () => go(index + 1));

      const submit = el('button', { class: 'btn q-submit', type: 'button', id: 'btn-submit' }) as HTMLButtonElement;
      submit.innerHTML = 'Submit<span class="lbl"> test</span>';
      // No window.confirm(): browsers (especially phones and in-app browsers) can silently
      // block it, which made the button look dead. Warn inline and ask for a second click.
      let armed = false;
      const warn = el('p', { class: 'submit-warn', role: 'alert' });
      submit.addEventListener('click', () => {
        const unanswered = answers.filter((a, i) => !isAnswered(questions[i], a)).length;
        if (unanswered > 0 && !armed) {
          armed = true;
          warn.textContent = `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. They won’t be counted — only the questions you answered will be scored. Press the button again to finish.`;
          submit.textContent = 'Finish now';
          warn.scrollIntoView({ block: 'center' });
          return;
        }
        try {
          finish();
        } catch (err) {
          warn.textContent = 'Something went wrong while scoring. Please reload the page and try again.';
          console.error(err);
        }
      });

      nav.append(prev, check, next, submit);
      card.append(warn);
      card.append(nav);

      function syncNav(): void {
        const answeredCount = answers.filter((a, i) => isAnswered(questions[i], a)).length;
        const counter = progress.lastChild as HTMLElement;
        if (counter) counter.textContent = `${answeredCount} answered`;
        check.disabled = checked[index] || !isAnswered(q, answers[index]);
      }
    }

    function finish(): void {
      if (timerId) window.clearInterval(timerId);
      // Only questions the user answered are scored and reviewed, so stopping early
      // grades what was attempted, not the full length of the module.
      const results = questions
        .map((q, i) => ({ q, given: answers[i], correct: gradeOne(q, answers[i]) }))
        .filter((r) => isAnswered(r.q, r.given));
      const skipped = questions.length - results.length;
      const numCorrect = results.filter((r) => r.correct).length;
      const pct = results.length ? Math.round((numCorrect / results.length) * 100) : 0;
      const passed = pct >= passPercent;
      try {
        recordAttempt({
          slug: payload.quiz.slug,
          title: payload.quiz.title,
          total: questions.length,
          subset: isSubset,
          items: results.map((r) => ({ id: r.q.id, category: r.q.category, reference: r.q.reference, correct: r.correct })),
        });
      } catch {
        /* progress is optional */
      }
      const elapsedMin = Math.max(1, Math.round((Date.now() - startedAt) / 60000));

      root.innerHTML = '';

      const hero = el('div', { class: 'quiz' });
      const figure = el('div', { class: `score-figure ${passed ? 'pass' : 'fail'}` }, `${pct}%`);
      const heroInner = el('div', { class: 'score-hero' });
      heroInner.append(
        figure,
        el(
          'div',
          { class: 'score-sub' },
          results.length === 0
            ? 'No questions were answered.'
            : `${numCorrect} of ${results.length} answered correct · ${passed ? 'PASS' : 'below passing'} (need ${passPercent}%) · ~${elapsedMin} min`,
        ),
      );
      hero.append(heroInner);
      if (skipped > 0 && results.length > 0) {
        hero.append(
          el('p', { class: 'file-desc', style: 'text-align:center;margin:0 0 1rem;' }, `${skipped} unanswered question${skipped === 1 ? ' was' : 's were'} not counted (${questions.length} in this test).`),
        );
      }

      const actions = el('div', { style: 'display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;' });
      const retake = el('button', { class: 'btn', type: 'button' }, 'Retake with a new draw');
      retake.addEventListener('click', () => {
        root.innerHTML = '';
        root.dataset.passpercent = String(passPercent);
        start();
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const missed = results.filter((r) => !r.correct).map((r) => r.q);
      const retakeMissed = el('button', { class: 'btn secondary', type: 'button' }, `Retake missed questions (${missed.length})`);
      retakeMissed.addEventListener('click', () => {
        root.innerHTML = '';
        root.dataset.passpercent = String(passPercent);
        start(missed);
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      actions.append(retake);
      if (missed.length > 0) actions.append(retakeMissed);
      const all = el('a', { class: 'btn secondary', href: import.meta.env.BASE_URL + 'practice' }, 'All practice tests');
      actions.append(all);
      hero.append(actions);
      root.append(hero);

      root.append(el('h2', {}, 'Answer review'));

      const line = (label: string, html: string) =>
        el('p', { class: 'r-line' }, el('span', { class: 'label' }, label), richEl('span', {}, html));

      for (const [i, r] of results.entries()) {
        const item = el('div', { class: `review-item ${r.correct ? 'correct' : 'incorrect'}` });
        item.append(richEl('p', { class: 'r-q' }, `${i + 1}. ${r.q.question}`));
        if (r.q.image) {
          item.append(el('img', { class: 'q-image', src: import.meta.env.BASE_URL + r.q.image, alt: 'Figure for this question' }));
        }

        if (isMatch(r.q)) {
          const mq = r.q;
          const given = (r.given ?? {}) as Record<string, string>;
          const table = el('div', { class: 'match-review' });
          for (const p of mq.prompts) {
            const ok = given[p.id] === mq.correct[p.id];
            const row = el('div', { class: `match-review-row ${ok ? 'ok' : 'bad'}` });
            row.append(richEl('div', { class: 'match-prompt' }, p.text));
            const right = el('div', { class: 'match-answers' });
            right.append(richEl('div', {}, `<span class="label">Your answer:</span> ${choiceText(mq, given[p.id])}`));
            if (!ok) right.append(richEl('div', {}, `<span class="label">Correct:</span> ${choiceText(mq, mq.correct[p.id])}`));
            row.append(right);
            table.append(row);
          }
          item.append(table);
        } else {
          item.append(
            line(
              'Your answer:',
              isNumeric(r.q)
                ? fmtNumericAnswer(r.q, r.given as number | null)
                : fmtChoiceAnswer(r.q as ChoiceQuestion, r.given as string[] | null),
            ),
          );
          item.append(
            line(
              'Correct:',
              isNumeric(r.q)
                ? fmtNumericAnswer(r.q, r.q.answer)
                : fmtChoiceAnswer(r.q as ChoiceQuestion, (r.q as ChoiceQuestion).correct),
            ),
          );
        }
        item.append(
          el(
            'p',
            { class: 'r-line' },
            el('span', { class: 'label' }, 'Result:'),
            el('span', { class: `verdict ${r.correct ? 'correct' : 'incorrect'}` }, r.correct ? 'Correct' : 'Incorrect'),
          ),
        );
        if (r.q.explanation) {
          const exp = el('div', { class: 'explanation' });
          exp.append(document.createTextNode(r.q.explanation));
          item.append(exp);
        }
        const objId = /Objective (\d\.\d\d\.\d\d)/.exec(r.q.reference ?? '')?.[1];
        item.append(line('Topic:', r.q.category));
        if (objId) {
          const text = payload.objectives?.[objId];
          item.append(line('Objective:', text ? `${objId} — ${text}` : objId));
        } else if (r.q.reference) {
          item.append(line('Reference:', r.q.reference));
        }
        root.append(item);
      }

      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    render();
  }
}
