// scripts/lib/transform-css.js

// Pure CSS-variable substitution. Given upstream CSS source, a list of tokens
// (each mapping a hex literal to a CSS variable name + fallback), and a string
// to prepend, return the transformed CSS plus a per-token replacement count.
//
// Exported as a pure function so it can be unit-tested without network or fs.

function transformCss(source, tokens, rootBlock) {
  // Normalize 3-digit hex shorthands (e.g., #eee, #fff) to their 6-digit form
  // so a single regex per token suffices. Negative lookahead prevents matching
  // the middle of longer hex colors (e.g., the ea in #c84c0ea0).
  let out = source.replace(
    /#([0-9a-f])([0-9a-f])([0-9a-f])(?![0-9a-f])/gi,
    "#$1$1$2$2$3$3"
  );
  const counts = {};
  for (const t of tokens) {
    // Negative lookahead avoids matching longer hex colors like #c84c0ea0.
    const re = new RegExp(`#${t.hex}(?![0-9a-f])`, "gi");
    let n = 0;
    out = out.replace(re, () => {
      n++;
      return `var(${t.varName}, ${t.fallback})`;
    });
    counts[t.varName] = n;
  }

  // Second pass: rewrite Tailwind's bg-opacity / text-opacity companion lines.
  // Tailwind 1.x emits two color declarations for each utility: a plain
  // var-themable one followed by `rgba(R, G, B, var(--<prop>-opacity))`. The
  // rgba line wins the cascade and discards every MDMS theme override.
  // We rewrite the rgba to relative-color syntax so both theming AND opacity
  // continue to work: `rgb(from var(--color-X, #fallback) r g b / <opacity>)`.
  // Browser support: Chrome/Edge 111+, Firefox 113+, Safari 16.4+ (all 2023).
  const rgbToToken = new Map();
  for (const t of tokens) {
    const r = parseInt(t.hex.slice(0, 2), 16);
    const g = parseInt(t.hex.slice(2, 4), 16);
    const b = parseInt(t.hex.slice(4, 6), 16);
    rgbToToken.set(`${r},${g},${b}`, t);
  }
  let rgbaRewrites = 0;
  out = out.replace(
    /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*var\((--[a-z0-9-]+-opacity)\)\s*\)/gi,
    (match, r, g, b, opVar) => {
      const tok = rgbToToken.get(`${r},${g},${b}`);
      if (!tok) return match;
      rgbaRewrites++;
      return `rgb(from var(${tok.varName}, ${tok.fallback}) r g b / var(${opVar}))`;
    }
  );
  counts._rgbaRewrites = rgbaRewrites;

  return { css: (rootBlock || "") + out, counts };
}

module.exports = { transformCss };
