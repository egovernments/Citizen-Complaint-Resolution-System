/**
 * seed-workspace.ts — build a v2.20 test workspace the whole suite can run against.
 *
 * Since v2.20 the suite targets a WORKSPACE (a self-serve tenant named by its
 * slug) and staff sign in through Keycloak with their email. This drives the
 * same journey a new customer does, with the suite's own onboarding helpers
 * (tests/utils/workspace-setup.ts, the ones onboarding-real asserts on):
 *
 *   magic-link signup -> Branding -> Geography (E2E_COUNTY > E2E_WARD_A/B)
 *   -> Departments (WATER, ROADS) -> Employees -> Complaint types
 *
 * Employees: a GRO in WATER scoped to E2E_WARD_A (it doubles as the inbox
 * viewer), a GRO in ROADS (the complaint-types step needs a GRO in every routed
 * department), and an LME in WATER scoped to E2E_WARD_A. The GRO and LME follow
 * their activation mail and set a password. Then, through Keycloak's admin CLI
 * inside the `keycloak` container (so: a local or self-managed box only), the
 * founder gets a password and a login probe with no DIGIT link is created
 * (employee/login.spec.ts posts wrong passwords to it).
 *
 * It writes two files, and nothing else about the workspace is pinned: the
 * suite discovers tenant, boundaries, complaint types, rules and roles per run.
 *   <outdir>/workspace.env  slug + persona logins (public)
 *   <outdir>/secrets.env    passwords + citizen OTP (mode 0600, never commit)
 *
 * Needs the onboarding-real env (ONBOARDING_E2E_BASE_URL, ONBOARDING_E2E_MAILPIT_URL)
 * and, for the citizen OTP, the BFF's fixed OTP (identity_dev_fixed_otp: true).
 *
 * Usage:
 *   cd tests/integration-tests
 *   ONBOARDING_E2E_BASE_URL=http://localhost ONBOARDING_E2E_MAILPIT_URL=http://127.0.0.1:18025/api/v1 \
 *   ONBOARDING_E2E_OTP_COMMAND=true npx tsx scripts/seed-workspace.ts <slug> <outdir>
 *   set -a; source deploy/maputo-local.env; source <outdir>/workspace.env; source <outdir>/secrets.env; set +a
 *   npx playwright test
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { selectContext } from '../tests/utils/identity-bff';
import {
  Digit, activateAccount, baseURL, brandingStep, complaintTypesStep, departmentsStep, geographyStep, hireAndLink,
  labelLocales, mailedLink, markDone, signupFounder, testMobile, testPassword,
} from '../tests/utils/workspace-setup';

const log = (...a: unknown[]) => console.log(`[seed-workspace ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const kc = (...args: string[]) => sh('docker', ['exec', 'keycloak', '/opt/keycloak/bin/kcadm.sh', ...args]);

function kcLogin(): void {
  const user = sh('docker', ['exec', 'keycloak', 'printenv', 'KC_BOOTSTRAP_ADMIN_USERNAME']);
  const password = sh('docker', ['exec', 'keycloak', 'printenv', 'KC_BOOTSTRAP_ADMIN_PASSWORD']);
  const port = sh('docker', ['exec', 'keycloak', 'sh', '-c', 'echo ${KC_HTTP_PORT:-8080}']);
  kc('config', 'credentials', '--server', `http://localhost:${port}`, '--realm', 'master', '--user', user, '--password', password);
}

function kcUserId(username: string): string {
  const users = JSON.parse(kc('get', 'users', '-r', 'digit', '-q', `username=${username}`, '-q', 'exact=true')) as Array<{ id: string }>;
  if (!users[0]) throw new Error(`no Keycloak user ${username} in realm digit`);
  return users[0].id;
}

async function main(): Promise<void> {
  const [slug, out] = process.argv.slice(2);
  if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug) || !out) throw new Error('usage: seed-workspace.ts <slug> <outdir>');
  const base = baseURL();
  const mail = (who: string) => `${slug}-${who}@${process.env.ONBOARDING_E2E_EMAIL_DOMAIN || 'e2e.test'}`;

  const http = await request.newContext();
  try {
    log('signup', slug);
    const { tenantId } = await signupFounder(http, base, { slug, email: mail('admin'), mobile: testMobile() });
    const founder = new Digit(http, base, await selectContext(http, base, 'configurator', tenantId), tenantId);
    const locales = await labelLocales(founder);
    await brandingStep(founder);
    await geographyStep(founder, locales);
    await departmentsStep(founder, locales);
    log('tenant', tenantId, '— branding, geography, departments DONE');

    const people = [
      { key: 'gro', name: 'IT Water Gro', role: 'GRO' as const, department: 'WATER', jurisdiction: 'E2E_WARD_A' },
      { key: 'gro-roads', name: 'IT Roads Gro', role: 'GRO' as const, department: 'ROADS', jurisdiction: 'E2E_COUNTY' },
      { key: 'lme', name: 'IT Water Lme', role: 'PGR_LME' as const, department: 'WATER', jurisdiction: 'E2E_WARD_A' },
    ].map((p) => ({ ...p, email: mail(p.key), mobile: testMobile() }));
    const staff = await hireAndLink(founder, base, people);
    const passwords: Record<string, string> = {};
    for (const member of staff.filter((s) => s.key !== 'gro-roads')) {
      const { link } = await mailedLink(member.email);
      passwords[member.key] = testPassword();
      await activateAccount(await request.newContext(), link, passwords[member.key]);
    }
    await markDone(founder, 'EMPLOYEES');
    const final = await complaintTypesStep(founder, locales);
    log('employees + complaint types DONE; workspace', final.status);

    kcLogin();
    passwords.admin = testPassword();
    kc('set-password', '-r', 'digit', '--userid', kcUserId(mail('admin')), '--new-password', passwords.admin);
    kc('create', 'users', '-r', 'digit', '-s', `username=${mail('login-probe')}`, '-s', `email=${mail('login-probe')}`,
      '-s', 'enabled=true', '-s', 'emailVerified=true', '-s', 'firstName=Login', '-s', 'lastName=Probe');
    kc('set-password', '-r', 'digit', '--userid', kcUserId(mail('login-probe')), '--new-password', testPassword());
    log('founder password + login probe set');

    const otp = sh('docker', ['exec', 'identity-bff', 'printenv', 'CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE']);
    const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    mkdirSync(out, { recursive: true, mode: 0o700 });
    writeFileSync(`${out}/secrets.env`, [
      `ADMIN_PASSWORD=${quote(passwords.admin)}`, `CITY_ADMIN_PASS=${quote(passwords.admin)}`,
      `GRO_PASSWORD=${quote(passwords.gro)}`, `EMPLOYEE_PASSWORD=${quote(passwords.lme)}`,
      `IDENTITY_TEST_OTP_CODE=${quote(otp)}`, '',
    ].join('\n'), { mode: 0o600 });
    writeFileSync(`${out}/workspace.env`, [
      `export IDENTITY_TEST_TENANT_SLUG=${slug}`,
      `export ADMIN_USER=${mail('admin')}`, `export CITY_ADMIN_USER=${mail('admin')}`,
      `export GRO_USER=${mail('gro')}`, `export EMPLOYEE_USER=${mail('lme')}`,
      `export LOGIN_PROBE_LOGIN=${mail('login-probe')}`, '',
    ].join('\n'));
    log('wrote', `${out}/workspace.env`, `${out}/secrets.env`);
  } finally {
    await http.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
