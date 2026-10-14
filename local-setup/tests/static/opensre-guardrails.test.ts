/**
 * OpenSRE redaction rules (local-setup/opensre/guardrails.yml) — what reaches
 * the model provider.
 *
 * OpenSRE compiles each pattern with Python's `re` (IGNORECASE) and silently
 * SKIPS one that does not compile, so a typo weakens redaction without an
 * error anywhere. This compiles every pattern with Python (a failure fails the
 * test) and runs samples through a replica of OpenSRE 0.1.2026.9.21's
 * GuardrailEvaluator.scan + _redact (infrastructure/safety/guardrails/
 * evaluator.py): every match of every rule, overlapping spans merged, capped
 * at 1000 matches. `opensre guardrails test` previews with a simpler loop that
 * garbles overlapping matches, so it is not the reference.
 *
 * Every sample is checked three ways: raw, JSON-encoded once and twice. That
 * is how a log line reaches the rules: OpenSRE masks the conversation as one
 * text, where a tool result is JSON-encoded and a JSON log line inside it is
 * encoded again (seen in local-setup/tests/opensre-redaction/run.sh).
 * The end-to-end check of the real image is that script.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RULES = path.resolve(__dirname, '..', '..', 'opensre', 'guardrails.yml');

/** The rules file uses one shape only: `- name:` per rule, `- '<regex>'` per pattern. */
function parseRules(text: string) {
  const rules: { name: string; patterns: string[] }[] = [];
  let inPatterns = false;
  for (const line of text.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const name = line.match(/^ {2}- name: (\S+)$/);
    if (name) {
      rules.push({ name: name[1], patterns: [] });
      inPatterns = false;
      continue;
    }
    if (/^ {4}patterns:$/.test(line)) {
      inPatterns = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      inPatterns = false;
      continue;
    }
    if (inPatterns) {
      const p = line.match(/^ {6}- '(.*)'$/);
      // Anything else under patterns: would be invisible to this parser.
      expect(p).not.toBeNull();
      rules[rules.length - 1].patterns.push(p![1].replace(/''/g, "'"));
    }
  }
  return rules;
}

const REPLICA = `
import json, re, sys
data = json.load(sys.stdin)
compiled = [(r['name'], [re.compile(p, re.IGNORECASE) for p in r['patterns']]) for r in data['rules']]
def apply(text):
    matches = []
    for name, pats in compiled:
        for p in pats:
            for m in p.finditer(text):
                matches.append((m.start(), m.end(), name))
                if len(matches) >= 1000: break
            if len(matches) >= 1000: break
        if len(matches) >= 1000: break
    merged = []
    for s, e, name in sorted(matches, key=lambda m: (m[0], -m[1])):
        w = e - s
        if merged and s < merged[-1][1]:
            ps, pe, pn, pw = merged[-1]
            merged[-1] = (ps, max(pe, e), name if w > pw else pn, max(w, pw))
        else:
            merged.append((s, e, name, w))
    for s, e, name, _ in reversed(merged):
        text = text[:s] + '[REDACTED:' + name + ']' + text[e:]
    return text
print(json.dumps([apply(t) for t in data['texts']]))
`;

function redact(texts: string[]): string[] {
  const rules = parseRules(fs.readFileSync(RULES, 'utf8'));
  const r = spawnSync('python3', ['-c', REPLICA], { input: JSON.stringify({ rules, texts }), encoding: 'utf8' });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

// Every value below is a stand-in secret marked S3CRET; none may survive.
const MUST_MASK = [
  // Review 4181060078: Kubernetes env entries, where a quote-comma or a
  // newline sits between the name and the value.
  '{"name":"SPRING_DATASOURCE_PASSWORD","value":"S3CRET"}',
  "{'name': 'DB_PASSWORD', 'value': 'S3CRET', 'value_from': None}",
  '- name: DB_PASSWORD\n  value: S3CRET',
  '- name: "NOVU_API_KEY"\n  value: "S3CRET with a space"',
  '{"name": "IDENTITY_CREDENTIAL_KEYS", "value": "S3CRET"}',
  '{"name":"ENC_MASTER_SALT","value":"S3CRET"}',
  '{"name":"AWS_KEY","value":"S3CRET"}',
  '{"name":"IDENTITY_CONTROL_PLANE_TOKEN","value":"S3CRET"}',
  // Env-style NAME=value and NAME: value, with the keyword inside the name.
  'IDENTITY_CONTROL_PLANE_TOKEN=S3CRET',
  '"NOVU_SECRET_KEY=S3CRET"',
  'NOVU_STORE_ENCRYPTION_KEY=S3CRET',
  'IDENTITY_CREDENTIAL_KEY_CURRENT=S3CRET',
  'ENC_MASTER_SALT=S3CRET',
  'AWS_KEY=S3CRET',
  'KEYCLOAK_BFF_CLIENT_SECRET: S3CRET',
  '"PGPASSWORD=S3CRET"',
  'TWILIO_AUTH_TOKEN=S3CRET',
  '      DB_PASSWORD:  S3CRET',
  // The rules that were there before.
  'GET /user/_details?access_token=S3CRET&tenantId=pg',
  'postgresql://egov:S3CRET@postgres-db:5432/egov',
  'Authorization: Bearer S3CRET',
  '{"password": "S3CRET, with a comma"}',
  'X-Vault-Token: S3CRET',
  // JSON-formatted service logs, as Loki returns them.
  '{"level":"ERROR","msg":"login failed","password":"S3CRET","mobileNumber":"0712345678"}',
  '{"access_token":"S3CRET","token_type":"bearer"}',
  '{"headers":{"Authorization":"Bearer S3CRET"}}',
  '{"X-Vault-Token":"S3CRET"}',
  '{"userName":"S3CRET citizen"}',
];

// Infrastructure detail the agent needs, which no rule may touch.
const LEFT_ALONE = [
  '- name: DB_PASSWORD\n  valueFrom:\n    secretKeyRef:\n      name: db\n      key: password',
  'envFrom:\n  - secretRef:\n      name: pgr-secrets',
  '{"name":"SERVER_PORT","value":"8080"}',
  '{"name": "pgr-services", "value": "8080"}',
  'KEYCLOAK_URL=http://keycloak:8080',
  'IDENTITY_KEYCLOAK_IMAGE=egovio/identity-keycloak:develop',
  'GATUS_PROFILE_KEYCLOAK=true',
  'kafka consumer lag partition=3 offset=1200 group=egov-persister',
  'max_tokens: 4096',
];

const ENCODINGS: [string, (text: string) => string][] = [
  ['raw', (t) => t],
  ['JSON-encoded once', (t) => JSON.stringify(t)],
  ['JSON-encoded twice', (t) => JSON.stringify(JSON.stringify(t))],
];

describe('OpenSRE redaction rules', () => {
  test('every pattern compiles in Python, so OpenSRE does not skip it', () => {
    const rules = parseRules(fs.readFileSync(RULES, 'utf8'));
    expect(rules.length).toBeGreaterThan(5);
    for (const r of rules) expect(r.patterns.length).toBeGreaterThan(0);
    expect(redact(['nothing to mask here'])).toEqual(['nothing to mask here']);
  });

  describe.each(ENCODINGS)('%s', (_how, encode) => {
    test('masks every secret', () => {
      const out = redact(MUST_MASK.map(encode));
      const leaked = MUST_MASK.filter((_t, i) => /S3CRET/i.test(out[i]) || !out[i].includes('[REDACTED:'));
      expect(leaked).toEqual([]);
    });

    test('leaves infrastructure detail alone', () => {
      const texts = LEFT_ALONE.map(encode);
      expect(redact(texts)).toEqual(texts);
    });
  });
});
