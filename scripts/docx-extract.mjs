// Extracts ordered paragraphs from a .docx file: list numbering ids/levels,
// text, and embedded images.
//
// Text comes out as "rich" strings that the site renders with innerHTML:
//   - plain text is HTML-escaped (&amp; &lt; &gt;)
//   - superscript / subscript runs become <sup> / <sub>
//   - Word equations (OMML) become LaTeX wrapped in $...$ (rendered by KaTeX)
//
// Used by scripts/import-docx.mjs.

import fs from 'node:fs';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  processEntities: true,
});

const tagOf = (n) => Object.keys(n).find((k) => k !== ':@' && k !== '#text');
const attrs = (n) => n[':@'] ?? {};
const kids = (n) => n[tagOf(n)] ?? [];
const child = (n, name) => kids(n).find((c) => tagOf(c) === name);

const BS = '\\'; // one backslash
// Private-use markers for bold runs; resolved per paragraph by boldToTags().
const B1 = '\uE000';
const B2 = '\uE001';

/**
 * Keep bold only where it distinguishes words inside a paragraph (the source uses it to mark
 * which of several otherwise-identical options is meant). A paragraph that is bold throughout
 * is just styling, so its bold is dropped.
 */
function boldToTags(text) {
  if (!text.includes(B1)) return text;
  const boldRun = new RegExp(B1 + '[^' + B2 + ']*' + B2, 'g');
  const rest = text.replace(boldRun, '').replace(/<[^>]+>/g, '');
  if (!rest.trim()) return text.replace(new RegExp('[' + B1 + B2 + ']', 'g'), '');
  return text
    .replace(new RegExp(B2 + '(\\s*)' + B1, 'g'), '$1')
    .replace(new RegExp(B1, 'g'), '<strong>')
    .replace(new RegExp(B2, 'g'), '</strong>');
}

const cmd = (name) => `${BS}${name} `;

const GREEK = {
  'α': cmd('alpha'), 'β': cmd('beta'), 'γ': cmd('gamma'), 'δ': cmd('delta'), 'ν': cmd('nu'),
  'υ': cmd('upsilon'), 'ε': cmd('varepsilon'), 'λ': cmd('lambda'), 'μ': cmd('mu'), 'σ': cmd('sigma'),
  'χ': cmd('chi'), 'π': cmd('pi'), '→': cmd('rightarrow'), '−': '-', '–': '-', '×': cmd('times'),
  '·': cmd('cdot'), '≥': cmd('geq'), '≤': cmd('leq'), '±': cmd('pm'), '∗': '*',
};

// HTML-escape plain text so it can be rendered with innerHTML later.
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function latexText(t) {
  if (/^[A-Za-z]{2,}$/.test(t)) return `${BS}mathrm{${t}}`;
  return [...t].map((c) => GREEK[c] ?? ('%&#_{}$\\'.includes(c) ? BS + c : c)).join('');
}

const m = (n, name) => mathText(kids(child(n, name) ?? {}));

// OMML -> LaTeX
function mathText(nodes) {
  let out = '';
  for (const n of nodes) {
    const t = tagOf(n);
    if (t === '#text') {
      out += latexText(n['#text']);
    } else if (t === 'm:t') {
      out += latexText(kids(n).map((c) => c['#text'] ?? '').join(''));
    } else if (t === 'm:f') {
      out += `${BS}frac{${m(n, 'm:num')}}{${m(n, 'm:den')}}`;
    } else if (t === 'm:sSup') {
      out += `{${m(n, 'm:e')}}^{${m(n, 'm:sup')}}`;
    } else if (t === 'm:sSub') {
      out += `{${m(n, 'm:e')}}_{${m(n, 'm:sub')}}`;
    } else if (t === 'm:sPre') {
      out += `{}^{${m(n, 'm:sup')}}_{${m(n, 'm:sub')}}{${m(n, 'm:e')}}`;
    } else if (t === 'm:rad') {
      const deg = child(n, 'm:deg') ? m(n, 'm:deg') : '';
      out += deg ? `${BS}sqrt[${deg}]{${m(n, 'm:e')}}` : `${BS}sqrt{${m(n, 'm:e')}}`;
    } else if (t === 'm:acc') {
      out += `${BS}bar{${m(n, 'm:e')}}`;
    } else if (t === 'm:d') {
      const inner = mathText(kids(n).filter((c) => tagOf(c) === 'm:e').flatMap((c) => kids(c)));
      out += `${BS}left(${inner}${BS}right)`;
    } else if (t && t.startsWith('m:') && !t.endsWith('Pr')) {
      out += mathText(kids(n));
    }
  }
  return out;
}

function walkPara(nodes, state) {
  for (const n of nodes) {
    const t = tagOf(n);
    if (t === 'w:r') {
      const rpr = child(n, 'w:rPr');
      const va = rpr && child(rpr, 'w:vertAlign');
      const val = va ? attrs(va)['@_w:val'] : null;
      const bEl = rpr && child(rpr, 'w:b');
      const bold = !!bEl && !['0', 'false', 'off'].includes(String(attrs(bEl)['@_w:val'] ?? '1'));
      const inner = { text: '', images: state.images, numId: null, ilvl: null, math: false };
      walkPara(kids(n), inner);
      let out = inner.text;
      if (val === 'superscript' || val === 'subscript') {
        const tag = val === 'superscript' ? 'sup' : 'sub';
        out = out.trim() ? `<${tag}>${out}</${tag}>` : out;
      }
      if (bold && out.trim()) out = B1 + out + B2;
      if (inner.math) state.math = true;
      state.text += out;
      continue;
    }
    if (t === 'w:t') {
      state.text += esc(kids(n).map((c) => c['#text'] ?? '').join(''));
    } else if (t === 'w:tab') {
      state.text += '\t';
    } else if (t === 'w:br') {
      state.text += ' ';
    } else if (t === 'm:oMath' || t === 'm:oMathPara') {
      state.text += ' $' + mathText(kids(n)) + '$ ';
      state.math = true;
    } else if (t === 'a:blip') {
      const id = attrs(n)['@_r:embed'];
      if (id) state.images.push(id);
    } else if (t === 'v:imagedata') {
      const id = attrs(n)['@_r:id'];
      if (id) state.images.push(id);
    } else if (t === 'w:numPr') {
      for (const c of kids(n)) {
        if (tagOf(c) === 'w:ilvl') state.ilvl = Number(attrs(c)['@_w:val']);
        if (tagOf(c) === 'w:numId') state.numId = Number(attrs(c)['@_w:val']);
      }
    } else if (t === 'w:rPr' || t === 'w:pPr' || t === 'mc:Fallback') {
      // pPr may hold numPr; rPr/Fallback hold nothing we need
      if (t === 'w:pPr') walkPara(kids(n), state);
    } else if (Array.isArray(kids(n))) {
      walkPara(kids(n), state);
    }
  }
}

export async function extractDocx(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const doc = parser.parse(await zip.file('word/document.xml').async('string'));
  const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
  const rels = {};
  for (const mt of relsXml.matchAll(/<Relationship [^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(mt[0])?.[1];
    const target = /Target="([^"]+)"/.exec(mt[0])?.[1];
    if (id && target) rels[id] = target;
  }
  const body = kids(doc.find((n) => tagOf(n) === 'w:document')).find((n) => tagOf(n) === 'w:body');
  const paras = [];
  const visit = (nodes) => {
    for (const n of nodes) {
      const t = tagOf(n);
      if (t === 'w:p') {
        const st = { text: '', images: [], numId: null, ilvl: null, math: false };
        walkPara(kids(n), st);
        paras.push({
          numId: st.numId,
          ilvl: st.ilvl,
          text: boldToTags(st.text.replace(/[ \t\r\n]+/g, ' ').trim()),
          images: st.images.map((id) => rels[id]).filter(Boolean),
          math: st.math,
        });
      } else if (t === 'w:tbl' || t === 'w:tr' || t === 'w:tc' || t === 'w:sdt' || t === 'w:sdtContent') {
        visit(kids(n));
      }
    }
  };
  visit(kids(body));
  return { paras, zip };
}
