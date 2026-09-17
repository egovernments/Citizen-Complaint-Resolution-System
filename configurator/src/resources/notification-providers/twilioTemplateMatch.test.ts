import { describe, it, expect } from 'vitest';
import { matchTwilioTemplates, bodyTokens } from './twilioTemplateMatch';

const routing = [
  { audience: 'CITIZEN', action: 'APPLY', toState: 'PENDINGFORASSIGNMENT', channel: 'WHATSAPP', active: true },
  { audience: 'CITIZEN', action: 'RATE', toState: 'CLOSEDAFTERRESOLUTION', channel: 'WHATSAPP', active: true },
  { audience: 'CITIZEN', action: 'RATE', toState: 'CLOSEDAFTERREJECTION', channel: 'WHATSAPP', active: true },
  { audience: 'GRO', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'WHATSAPP', active: true },
  { audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', active: true },
];
const templates = [
  { audience: 'CITIZEN', action: 'APPLY', toState: 'PENDINGFORASSIGNMENT', channel: 'WHATSAPP', locale: 'en_IN', body: 'Your {complaint_type} complaint {id} was filed on {date}.', placeholders: [] , active: true },
  { audience: 'GRO', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'WHATSAPP', locale: 'en_IN', body: '', placeholders: ['id', 'emp_name'], active: true },
];
const tw = (name: string, status = 'approved', language = 'en') => ({ templateId: 'HX' + name.length, templateName: name, language, approvalStatus: status, tokens: name.toLowerCase().split('_') });

describe('matchTwilioTemplates', () => {
  it('derives toState from the tenant routing rows and variables from the template body', () => {
    const { matched } = matchTwilioTemplates([tw('complaints_apply_message_new')], routing, templates);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ audience: 'CITIZEN', action: 'APPLY', toState: 'PENDINGFORASSIGNMENT', locale: 'en_IN', variables: ['complaint_type', 'id', 'date'] });
  });

  it('role-code audiences are recognised when they are routed on WhatsApp', () => {
    const { matched } = matchTwilioTemplates([tw('complaints_gro_assign_message')], routing, templates);
    expect(matched[0]).toMatchObject({ audience: 'GRO', action: 'ASSIGN', variables: ['id', 'emp_name'] });
  });

  it('a state token in the name disambiguates same-action routes; otherwise the first routed state wins', () => {
    const named = matchTwilioTemplates([tw('complaints_rate_closedafterrejection_message')], routing, templates).matched[0];
    expect(named.toState).toBe('CLOSEDAFTERREJECTION');
    const bare = matchTwilioTemplates([tw('complaints_rate_message')], routing, templates).matched[0];
    expect(bare.toState).toBe('CLOSEDAFTERRESOLUTION');
  });

  it('unapproved, unrouted and unconventional names are reported, not guessed', () => {
    const { matched, unmatched } = matchTwilioTemplates([
      tw('complaints_apply_message', 'pending'),
      tw('complaints_resolve_message'),
      tw('otp_login_message'),
    ], routing, templates);
    expect(matched).toHaveLength(0);
    expect(unmatched.map((u) => u.skipReason)).toEqual([
      "WhatsApp approval status is not 'approved'",
      'no WHATSAPP routing row for any action named in this template',
      'friendly_name does not match complaints_…_message[_new] convention',
    ]);
  });

  it('the _new variant supersedes a plain one for the same key; a second plain one is a duplicate', () => {
    const { matched, unmatched } = matchTwilioTemplates([tw('complaints_apply_message'), tw('complaints_apply_message_new'), tw('complaints_apply_v2_message')], routing, templates);
    expect(matched).toHaveLength(1);
    expect(matched[0].templateName).toBe('complaints_apply_message_new');
    expect(unmatched).toHaveLength(1);
  });

  it('bodyTokens keeps first-appearance order and dedupes', () => {
    expect(bodyTokens('{id} then {date} then {id}')).toEqual(['id', 'date']);
    expect(bodyTokens(undefined)).toEqual([]);
  });
});
