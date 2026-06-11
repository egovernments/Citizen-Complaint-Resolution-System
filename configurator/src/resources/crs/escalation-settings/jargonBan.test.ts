/**
 * Source-level jargon ban for the Escalation Settings cards.
 *
 * skipReasonCopy.test.ts guards the skip-reason dictionary; this test
 * sweeps the card sources themselves so resolver internals (R1/R2/R3),
 * the singleton implementation detail and raw CRS.* schema codes can't
 * sneak into operator-facing copy via a placeholder, label or paragraph.
 *
 * The extraction is a heuristic, not a parser: comments are stripped,
 * then single-line string literals and brace-free JSX text runs are
 * pulled out. Code identifiers (singletonKey, schema constants) never
 * enter the extracted set, so they don't trip the ban — only quoted or
 * rendered copy is checked. Confining literals to a single line keeps
 * stray apostrophes in prose ("the holders' manager") from pairing
 * across lines of code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The escalation-settings surfaces that render operator-facing copy. */
const CARD_SOURCES = [
  'PolicyCard.tsx',
  'RoleSupervisorsTable.tsx',
  'VerifyCard.tsx',
  'CascadeCard.tsx',
  'StateMappingCard.tsx',
];

// Same ban as the dictionary test: resolver internals (R1/R2/R3), the
// singleton implementation detail and CRS.* schema codes must never
// reach operator-facing copy.
const BANNED = /\bR[123]\b|singleton|CRS\./;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Pull every string literal and JSX text run out of a card source. */
function extractRenderedCopy(source: string): string[] {
  const code = stripComments(source);
  const copy: string[] = [];
  // Single-line ' " ` literals (a template literal stays one chunk).
  for (const match of code.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g)) {
    copy.push(match[0]);
  }
  // JSX text: anything between a > and the next < that crosses no brace —
  // interpolations and attribute code always carry { }, so brace-free
  // runs are rendered prose (plus a few harmless code fragments).
  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
    copy.push(match[1]);
  }
  return copy;
}

describe('escalation-settings cards obey the jargon ban in rendered copy', () => {
  for (const file of CARD_SOURCES) {
    it(`${file} has no banned tokens in string literals or JSX text`, () => {
      const copy = extractRenderedCopy(readFileSync(join(HERE, file), 'utf8'));
      // Heuristic guard: if extraction ever finds this little, the regexes
      // have rotted and the ban is no longer really being enforced.
      expect(copy.length).toBeGreaterThan(20);
      for (const text of copy) {
        expect(text).not.toMatch(BANNED);
      }
    });
  }
});
