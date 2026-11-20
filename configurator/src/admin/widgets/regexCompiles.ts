import type { Validator } from 'ra-core';

// Letters Java's java.util.regex accepts after a backslash, outside and inside [ ]. Any other letter is an
// "Illegal/unsupported escape sequence" there, while the browser reads it as the plain letter.
const ESCAPE_LETTERS = new Set('tnrfaecxuNdDhHsSvVwWpPbBAGZzRXk');
const CLASS_ESCAPE_LETTERS = new Set('tnrfaecxuNdDhHsSvVwWpP');
// Escapes that stand for a set of characters, which can't end a range like a-\d.
const SET_ESCAPES = new Set('dDhHsSvVwWpP');
const GROUP_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const HEX2 = /^[0-9A-Fa-f]{2}/;
const HEX4 = /^[0-9A-Fa-f]{4}/;

type Step = { next: number; set: boolean } | { problem: string };

/**
 * Why `pattern` can't be used as a rule, or null when it can.
 *
 * The pattern must compile in the browser, which applies it in the complaint forms, and in Java, which
 * applies the mobile rule in egov-user. Browsers read regexes in a lenient mode that quietly turns many
 * mistakes into literal text: `^[0-9]{5` (no closing brace) compiles there, but then matches only the text
 * "{5", so every postal code is refused. Java refuses the same pattern, so checking Java's rules as well
 * catches these typos (#2787).
 */
export function regexProblem(pattern: string): string | null {
  try {
    new RegExp(pattern);
  } catch (e) {
    return e instanceof Error ? e.message : 'invalid regex';
  }
  return javaProblem(pattern);
}

function javaProblem(p: string): string | null {
  const names = new Set<string>();
  const at = (i: number) => `at position ${i + 1}`;

  const escape = (i: number, inClass: boolean): Step => {
    const e = p[i + 1];
    if (e === undefined) return { next: i + 1, set: false };
    if (e === 'Q') {
      const end = p.indexOf('\\E', i + 2);
      return { next: end < 0 ? p.length : end + 2, set: false };
    }
    if (e === 'E') return { problem: `\\E ${at(i)} has no \\Q before it` };
    if (e >= '0' && e <= '9') {
      if (e === '0') {
        if (!/[0-7]/.test(p[i + 2] ?? '')) return { problem: `\\0 ${at(i)} needs an octal digit after it, as in \\012` };
        return { next: i + 3, set: false };
      }
      if (inClass) return { problem: `\\${e} ${at(i)} can't refer to a group inside [ ]` };
      return { next: i + 2, set: false };
    }
    if (!/[A-Za-z]/.test(e)) return { next: i + 2, set: false };
    if (!(inClass ? CLASS_ESCAPE_LETTERS : ESCAPE_LETTERS).has(e)) {
      return { problem: `\\${e} ${at(i)} isn't a valid escape` };
    }
    const rest = p.slice(i + 2);
    switch (e) {
      case 'x': {
        if (rest.startsWith('{')) {
          const m = /^\{([0-9A-Fa-f]+)\}/.exec(rest);
          if (!m || parseInt(m[1], 16) > 0x10ffff) {
            return { problem: `\\x{…} ${at(i)} needs a hex code point, as in \\x{41}` };
          }
          return { next: i + 2 + m[0].length, set: false };
        }
        if (!HEX2.test(rest)) return { problem: `\\x ${at(i)} needs two hex digits, as in \\x41` };
        return { next: i + 4, set: false };
      }
      case 'u':
        if (!HEX4.test(rest)) return { problem: `\\u ${at(i)} needs four hex digits, as in \\u0041` };
        return { next: i + 6, set: false };
      case 'c':
        if (rest === '') return { problem: `\\c ${at(i)} needs a letter after it` };
        return { next: i + 3, set: false };
      case 'k': {
        const m = /^<([^>]*)>/.exec(rest);
        if (!m || !names.has(m[1])) {
          return { problem: `\\k ${at(i)} must name a group defined before it, as in (?<code>…)\\k<code>` };
        }
        return { next: i + 2 + m[0].length, set: false };
      }
      case 'N': {
        const m = /^\{[^}]+\}/.exec(rest);
        if (!m) return { problem: `\\N ${at(i)} needs a character name, as in \\N{LATIN SMALL LETTER A}` };
        return { next: i + 2 + m[0].length, set: false };
      }
      case 'p':
      case 'P': {
        const m = /^(\{[^}]+\}|[A-Za-z])/.exec(rest);
        if (!m) return { problem: `\\${e} ${at(i)} needs a property, as in \\${e}{L}` };
        return { next: i + 2 + m[0].length, set: true };
      }
      case 'b':
        return { next: rest.startsWith('{g}') ? i + 5 : i + 2, set: false };
      default:
        return { next: i + 2, set: SET_ESCAPES.has(e) };
    }
  };

  // The character class whose "[" is at `open`, read the way Java reads it: a "]" right after "[" or "[^"
  // is a literal, and a "[" inside opens a nested class. Returns the index after its closing "]".
  const charClass = (open: number): { next: number } | { problem: string } => {
    let i = open + 1;
    if (p[i] === '^') i++;
    let lastStart = -1; // where the last single character began, while it can still start a range
    let rangeStart = -1; // where an open range like "a-" began
    if (p[i] === ']') {
      lastStart = i;
      i++;
    }
    while (i < p.length) {
      const c = p[i];
      if (c === ']') return { next: i + 1 };
      const start = i;
      let set: boolean;
      if (c === '[') {
        const inner = charClass(i);
        if ('problem' in inner) return inner;
        i = inner.next;
        set = true;
      } else if (c === '&' && p[i + 1] === '&') {
        i += 2;
        lastStart = -1;
        rangeStart = -1;
        continue;
      } else if (c === '\\') {
        const step = escape(i, true);
        if ('problem' in step) return step;
        if (rangeStart >= 0 && step.set) {
          return { problem: `the range ${at(rangeStart)} can't end in ${p.slice(i, step.next)}` };
        }
        i = step.next;
        set = step.set;
      } else if (c === '-' && lastStart >= 0 && rangeStart < 0 && p[i + 1] !== ']') {
        rangeStart = lastStart;
        i++;
        continue;
      } else {
        i++;
        set = false;
      }
      // A finished range like a-z can't start another one.
      lastStart = !set && rangeStart < 0 ? start : -1;
      rangeStart = -1;
    }
    return { problem: `"[" ${at(open)} is never closed` };
  };

  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '\\') {
      const step = escape(i, false);
      if ('problem' in step) return step.problem;
      i = step.next;
    } else if (c === '[') {
      const cls = charClass(i);
      if ('problem' in cls) return cls.problem;
      i = cls.next;
    } else if (c === '{') {
      const m = /^\{\d+(,\d*)?\}/.exec(p.slice(i));
      if (!m) return `"{" ${at(i)} doesn't start a repetition like {5} or {2,4} (write \\{ for a literal brace)`;
      i += m[0].length;
    } else if (p.startsWith('(?<', i) && p[i + 3] !== '=' && p[i + 3] !== '!') {
      const m = /^\(\?<([^>]*)>/.exec(p.slice(i));
      if (!m || !GROUP_NAME.test(m[1])) {
        return `the group name ${at(i)} must be letters and digits, starting with a letter`;
      }
      names.add(m[1]);
      i += m[0].length;
    } else {
      i++;
    }
  }
  return null;
}

/** Refuses a pattern that can't be used as a rule; see regexProblem. */
export const regexCompiles: Validator = (value) => {
  if (typeof value !== 'string' || value === '') return undefined;
  const problem = regexProblem(value);
  return problem ? `Regex error: ${problem}` : undefined;
};
