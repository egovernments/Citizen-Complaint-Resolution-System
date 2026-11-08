// Browser/Node port of backend/severity-service: text cleaning, CatBoost tree evaluation and the
// Critical-override decision. No dependencies. The sentence embedding is computed elsewhere
// (app.js uses transformers.js) and passed in as a 384-float vector.

export const CRITICAL_THRESHOLD = 0.5; // return "Critical" when P(Critical) >= this, even if not the top class
export const REVIEW_THRESHOLD = 0.6; // needs_review when the returned severity's probability is below this
export const DEFAULT_CTYPE = "Others";

// ---- text cleaning: mirrors app/preprocess.py (text_for_model) --------------------------------

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
// Python html.unescape rules for numeric references (only the common named entities above are
// supported; rarer ones like &copy; are left as-is, where Python would decode them).
const CP1252 = {
  0x00: 0xfffd, 0x0d: 0x0d, 0x80: 0x20ac, 0x81: 0x81, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8d: 0x8d,
  0x8e: 0x017d, 0x8f: 0x8f, 0x90: 0x90, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9d: 0x9d,
  0x9e: 0x017e, 0x9f: 0x0178,
};

function numericRef(cp) {
  if (cp in CP1252) return String.fromCodePoint(CP1252[cp]);
  if ((cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return "�";
  if (
    (cp >= 0x1 && cp <= 0x8) || (cp >= 0xe && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0xfdd0 && cp <= 0xfdef) || cp === 0xb || (cp & 0xfffe) === 0xfffe
  ) return "";
  return String.fromCodePoint(cp);
}

function unescapeHtml(s) {
  return s.replace(/&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|(amp|lt|gt|quot|apos|nbsp);?)/g, (m, dec, hex, name) => {
    if (name) return NAMED[name];
    return numericRef(dec ? parseInt(dec, 10) : parseInt(hex, 16));
  });
}

function stripChars(s, chars) {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

export function clean(s) {
  if (typeof s !== "string") return "";
  s = unescapeHtml(unescapeHtml(s)); // twice: decodes &#2980; Tamil entities and &#13;&#10;
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/​/g, " ").replace(/﻿/g, " ");
  s = s.replace(/[\r\n\t]+/g, " ");
  s = stripChars(s.replace(/\s+/g, " "), " .,;:-}{");
  return s.trim();
}

export function textForModel(raw) {
  let s = clean(raw);
  if (s.includes("@")) s = s.split("@", 1)[0]; // "Type@address" template: keep the part before @
  s = s.replace(/(?<![\p{L}\p{N}_])\p{Nd}{4}-[0-9A-Z]{6}(?![\p{L}\p{N}_])/gu, " "); // complaint numbers 2024-297EJL
  s = s.replace(/\+?\p{Nd}[\p{Nd}\s-]{8,}\p{Nd}/gu, " "); // phone numbers
  return s.replace(/\s+/g, " ").trim();
}

// ---- model --------------------------------------------------------------------------------------

/** meta: parsed model.json; leaves: Float32Array from model.bin. */
export function buildModel(meta, leaves) {
  const ctypeIndex = new Map(meta.ctypes.map((c, i) => [c, i]));
  return { ...meta, leaves, ctypeIndex, unseen: meta.ctypes.length };
}

export function isKnownCtype(model, ctype) {
  return model.ctypeIndex.has(ctype);
}

/** Class probabilities (softmax of summed leaf values) for a 384-d embedding and a complaint type. */
export function predictProba(model, embedding, ctype) {
  const { dim, trees, depth, feat, border, ctrSlot, leaves, ctrBits } = model;
  const ci = model.ctypeIndex.has(ctype) ? model.ctypeIndex.get(ctype) : model.unseen;
  const bits = ctrBits[ci];
  const raw = new Float64Array(dim);
  for (let t = 0; t < trees; t++) {
    let idx = 0;
    for (let pos = 0; pos < depth; pos++) {
      const k = t * depth + pos;
      const f = feat[k];
      const bit = f >= 0 ? (embedding[f] > border[k] ? 1 : 0) : bits.charCodeAt(ctrSlot[k]) - 48;
      idx |= bit << pos;
    }
    const base = t * 64 * dim + idx * dim;
    for (let c = 0; c < dim; c++) raw[c] += leaves[base + c];
  }
  let max = -Infinity;
  for (const v of raw) if (v > max) max = v;
  let sum = 0;
  const p = Array.from(raw, (v) => { const e = Math.exp(v - max); sum += e; return e; });
  return p.map((v) => v / sum);
}

/** Same decision rule as the API: argmax, overridden to the top class when P(Critical) is high. */
export function decide(model, probs) {
  const critical = model.labels.length - 1;
  let sev = probs.indexOf(Math.max(...probs));
  if (probs[critical] >= CRITICAL_THRESHOLD) sev = critical;
  const confidence = probs[sev];
  return {
    severity: model.labels[sev],
    severity_id: sev,
    confidence: Math.round(confidence * 10000) / 10000,
    probabilities: Object.fromEntries(model.labels.map((l, i) => [l, Math.round(probs[i] * 10000) / 10000])),
    needs_review: confidence < REVIEW_THRESHOLD,
  };
}
