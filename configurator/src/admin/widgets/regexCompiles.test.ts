import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { regexCompiles, regexProblem } from './regexCompiles';
// [pattern, whether java.util.regex.Pattern.compile accepts it], recorded with Java 17 (Temurin). It holds
// the patterns the browser reads leniently and Java refuses, plus valid ones that look close to them.
import javaCases from './regexCompiles.java-cases.json';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

const browserCompiles = (pattern: string) => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

/** Every rule pattern the repo seeds: MDMS rows, the sign-up countries, host_vars and test profiles. */
function seededPatterns(): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && /^(regex|mobileNumberRegex|postalCodePattern)$/.test(key)) found.push(value);
        else walk(value);
      }
    }
  };
  for (const file of [
    'backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json',
    'utilities/default-data-handler/src/main/resources/mdmsData/common-masters/common-masters.FormValidations.json',
    'utilities/default-data-handler/src/main/resources/mdmsData/common-masters/common-masters.MobileNumberValidation.json',
    'ansible/nairobi-mdms/mdms/common-masters/MobileNumberValidation.json',
  ]) {
    walk(JSON.parse(readFileSync(path.join(REPO, file), 'utf8')));
  }
  const text = (dir: string, keep: (name: string) => boolean) =>
    readdirSync(path.join(REPO, dir))
      .filter(keep)
      .map((name) => readFileSync(path.join(REPO, dir, name), 'utf8'));
  for (const body of [
    ...text('local-setup/ansible/inventory/host_vars', (n) => n.endsWith('.example') || n === '_example.yml'),
    ...text('tests/integration-tests/deploy', (n) => n.endsWith('.env')),
  ]) {
    for (const m of body.matchAll(/(?:mobileNumberRegex|postalCodePattern)"?\s*:\s*"([^"]+)"/g)) found.push(m[1]);
    for (const m of body.matchAll(/POSTAL_CODE_PATTERN='([^']+)'/g)) found.push(m[1]);
  }
  return found;
}

describe('regexProblem', () => {
  it('refuses a repetition the browser would read as literal text', () => {
    expect(browserCompiles('^[0-9]{5')).toBe(true);
    expect(regexProblem('^[0-9]{5')).toBe('"{" at position 7 doesn\'t start a repetition like {5} or {2,4} (write \\{ for a literal brace)');
    expect(regexProblem('^[17][0-9]{8')).toMatch(/^"\{" at position 11 /);
    expect(regexProblem('^[0-9]{5}$')).toBeNull();
    expect(regexProblem('^[0-9]\\{5')).toBeNull();
  });

  it('agrees with Java on every recorded pattern the browser compiles, and refuses the rest', () => {
    const cases = javaCases as [string, boolean][];
    expect(cases.length).toBeGreaterThan(100);
    // The table must hold both kinds, or it proves nothing.
    expect(cases.filter(([p, ok]) => ok && browserCompiles(p)).length).toBeGreaterThan(40);
    expect(cases.filter(([p, ok]) => !ok && browserCompiles(p)).length).toBeGreaterThan(30);
    const disagreements = cases
      .filter(([pattern, javaOk]) => (regexProblem(pattern) === null) !== (javaOk && browserCompiles(pattern)))
      .map(([pattern, javaOk]) => `${pattern} (Java ${javaOk ? 'accepts' : 'refuses'}): ${regexProblem(pattern)}`);
    expect(disagreements).toEqual([]);
  });

  it('accepts every pattern the repo seeds', () => {
    const seeded = seededPatterns();
    // 4 postal + 4 mobile country rules, 3 FormValidations rows, the MDMS mobile rows, host_vars and profiles.
    expect(seeded.length).toBeGreaterThanOrEqual(20);
    expect(seeded).toContain('^(?:[1-9][0-9]{3}|[0-9]{4}-[0-9]{2}|[1-3][0-9]{4}-[0-9]{3})$');
    expect(seeded.some((p) => p.includes('\\p{L}'))).toBe(true);
    expect(seeded.filter((p) => regexProblem(p) !== null)).toEqual([]);
  });

  it('reports a problem in the same "Regex error:" form the field already shows', () => {
    expect(regexCompiles('^[0-9]{5', {}, {} as never)).toBe(
      'Regex error: "{" at position 7 doesn\'t start a repetition like {5} or {2,4} (write \\{ for a literal brace)',
    );
    expect(regexCompiles('\\q', {}, {} as never)).toBe('Regex error: \\q at position 1 isn\'t a valid escape');
    expect(regexCompiles('^([0-9]{5}$', {}, {} as never)).toMatch(/^Regex error: Invalid regular expression: .*Unterminated group/);
  });
});
