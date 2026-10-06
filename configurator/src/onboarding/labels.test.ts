import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS } from './steps';
import { BRAND_THEMES } from './brandThemes';
import { STEP_REQUIREMENT, WORKSPACE_ERRORS } from './errors';
import { INVITE_ERRORS } from './employees/inviteStatus';

/**
 * Onboarding's English lives in the code, as each t(key, english) call's fallback. The two
 * configurator-ui copies, the ansible bundle and pgr-services' workspace pack, must carry the same
 * en_IN entries, so translators and the Localization screen see every string.
 *
 * Out of date? Regenerate both: UPDATE_LABELS=1 npx vitest run src/onboarding/labels.test.ts
 * (existing workspaces get new pack entries with the next platform seed version bump).
 */

const CONFIGURATOR = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(CONFIGURATOR, '..');
const ANSIBLE = path.join(REPO, 'local-setup/ansible/files/configurator-localization/configurator-ui.json');
const PACK = path.join(REPO, 'backend/pgr-services/src/main/resources/onboarding/l10n/en_IN/configurator-ui.json');

interface Message {
  code: string;
  message: string;
  module: string;
  locale: string;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

/** t('key', 'English') calls, the key as written (bare, or app.* for a shared label). */
function staticCalls(): Map<string, string> {
  const found = new Map<string, string>();
  const call = /\bt\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
  for (const file of [...sources(path.join(CONFIGURATOR, 'src/onboarding')), path.join(CONFIGURATOR, 'src/App.tsx')]) {
    for (const [, key, raw] of readFileSync(file, 'utf8').matchAll(call)) {
      const english = raw.replace(/\\n/g, '\n').replace(/\\'/g, "'");
      const seen = found.get(key);
      if (seen !== undefined && seen !== english) {
        throw new Error(`${key} has two English texts: "${seen}" and "${english}" (${path.relative(REPO, file)})`);
      }
      found.set(key, english);
    }
  }
  return found;
}

/** The keys built at runtime, from the lists they come from. */
function dynamicKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const step of ONBOARDING_STEPS) {
    keys.set(`steps.${step.id}`, step.label);
    keys.set(`groups.${step.group.toLowerCase()}`, step.group);
  }
  for (const theme of BRAND_THEMES) keys.set(`branding.themes.${theme.id}`, theme.label);
  for (const [step, english] of Object.entries(STEP_REQUIREMENT)) keys.set(`requirements.${step.toLowerCase()}`, english);
  for (const [code, english] of Object.entries(WORKSPACE_ERRORS)) keys.set(`errors.${code}`, english);
  for (const [code, english] of Object.entries(INVITE_ERRORS)) keys.set(`invite_errors.${code}`, english);
  return keys;
}

/** Onboarding's own keys, and the shared app.* labels it uses (which a file may already carry). */
function expected(): { own: Map<string, string>; shared: Map<string, string> } {
  const own = new Map<string, string>();
  const shared = new Map<string, string>();
  for (const [key, english] of new Map([...staticCalls(), ...dynamicKeys()])) {
    if (key.startsWith('app.')) shared.set(key, english);
    else own.set(`app.onboarding.${key}`, english);
  }
  return { own, shared };
}

const isOwn = (m: Message) => m.locale === 'en_IN' && m.code.startsWith('app.onboarding.');
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Message[];
const entries = (own: Map<string, string>): Message[] =>
  [...own].sort(([a], [b]) => a.localeCompare(b)).map(([code, message]) => ({ code, message, module: 'configurator-ui', locale: 'en_IN' }));

// Each file keeps its own layout: the bundle pretty-printed, the pack one message per line.
const FORMAT: Record<string, (list: Message[]) => string> = {
  [ANSIBLE]: (list) => `${JSON.stringify(list, null, 2)}\n`,
  [PACK]: (list) =>
    `[\n${list.map((m) => `{${Object.entries(m).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`).join(',\n')}\n]\n`,
};

describe('onboarding labels', () => {
  const { own, shared } = expected();

  it.each([ANSIBLE, PACK].map((file) => [path.relative(REPO, file), file]))('%s carries every onboarding string in en_IN', (_name, file) => {
    const english = (list: Message[]) => new Set(list.filter((m) => m.locale === 'en_IN').map((m) => m.code));
    if (process.env.UPDATE_LABELS) {
      const kept = read(file).filter((m) => !isOwn(m));
      const has = english(kept);
      const missingShared = new Map([...shared].filter(([code]) => !has.has(code)));
      writeFileSync(file, FORMAT[file]([...kept, ...entries(missingShared), ...entries(own)]));
    }
    const list = read(file);
    expect(Object.fromEntries(list.filter(isOwn).map((m) => [m.code, m.message]))).toEqual(Object.fromEntries(own));
    const codes = english(list);
    expect([...shared.keys()].filter((code) => !codes.has(code))).toEqual([]);
  });

  it('found the strings', () => {
    expect(own.size).toBeGreaterThan(100);
    expect(own.get('app.onboarding.step.save_continue')).toBe('Save and continue');
  });
});
