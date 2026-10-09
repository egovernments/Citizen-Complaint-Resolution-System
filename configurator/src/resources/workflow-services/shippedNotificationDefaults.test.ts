import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateNotifications,
  placeholderTokens,
  type ProviderTemplateRow,
  type RoutingRow,
  type TemplateRow,
} from './validateNotifications';
import type { EventCatalogueRow } from '../notification-configure/eventCatalogue';

// The defaults a new tenant (deploy seed, workspace signup, `migrate-notifications.py --adopt-defaults`)
// is given: utilities/default-data-handler/.../mdmsData-dev/NOTIFICATIONS/*.json. Vitest's cwd is
// configurator/, like validation.postalCode.test.ts.
const DIR = resolve(process.cwd(), '../utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS');
const read = <T,>(name: string): T[] => JSON.parse(readFileSync(resolve(DIR, `NOTIFICATIONS.${name}.json`), 'utf8')) as T[];

const catalogue = read<EventCatalogueRow>('EventCatalogue');
const routingRows = read<RoutingRow>('Routing');
const templateRows = read<TemplateRow & { placeholders?: string[] }>('Template');
const providerTemplateRows = read<ProviderTemplateRow>('ProviderTemplate');

describe('the shipped notification defaults', () => {
  it('pass the template validator with no error', () => {
    const findings = validateNotifications({
      catalogue,
      routingRows,
      templateRows,
      // The routing audiences are actors only (ACTOR:citizen / ACTOR:assignee); no role vocabulary needed.
      roleCodes: [],
      providerTemplateRows,
    });
    expect(findings.filter((f) => f.level === 'error')).toEqual([]);
    // unknown-token: every token is one the event fills, so no literal {braces} ship.
    expect(findings.filter((f) => f.rule === 'unknown-token' || f.rule === 'whatsapp-variable-unmapped')).toEqual([]);
  });

  it('carry no deployment- or country-specific wording', () => {
    // Field finding (dev deployment, 2026-10-07): every message signed "EGOVS", the assignee SMS
    // addressed "Shri ..." and signed "{ao_designation} - {ulb}", with {ulb} delivered literally on
    // a single-level tenant (no district to localize).
    for (const row of templateRows) {
      const text = `${row.subject ?? ''}\n${row.body}`;
      for (const banned of ['EGOVS', 'Shri ', 'municipal office', 'ई-गव फाउंडेशन', 'DIGIT:', '{ulb}', '{ao_designation}']) {
        expect(text, `${row.eventName} ${row.audience} ${row.channel} ${row.locale}`).not.toContain(banned);
      }
    }
  });

  it('declare exactly the tokens each body and subject use', () => {
    for (const row of templateRows) {
      const used = [...new Set([...placeholderTokens(row.body), ...placeholderTokens(row.subject ?? '')])].sort();
      expect(row.placeholders, `${row.eventName} ${row.audience} ${row.channel} ${row.locale}`).toEqual(used);
    }
  });

  it('keep every WhatsApp provider-template variable a token of its template', () => {
    for (const pt of providerTemplateRows) {
      const template = templateRows.find((t) => t.eventName === pt.eventName && t.audience === pt.audience
        && t.channel === 'WHATSAPP' && t.locale === pt.locale);
      if (!template) continue; // a provider template without a WhatsApp body is the validator's concern
      const tokens = new Set(placeholderTokens(template.body));
      for (const variable of pt.variables ?? []) {
        expect(tokens.has(variable), `${pt.eventName} ${pt.locale}: ${variable}`).toBe(true);
      }
    }
  });
});
