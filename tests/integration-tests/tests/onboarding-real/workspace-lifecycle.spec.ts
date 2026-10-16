import { test, expect, request as playwright, type APIRequestContext } from '@playwright/test';
import { citizenSignIn, identityJson, selectContext } from '../utils/identity-bff';
import {
  BOUNDARIES, COMPLAINT_TYPES, DEPARTMENTS, DESIGNATION, Digit, act, activateAccount, allowing, baseURL, brandingStep, commandOtp,
  complaint, complaintTypesStep, departmentsStep, emailDomain, employeeSignIn, fileComplaint, geographyStep, hireAndLink, history,
  inbox, labelLocales, mailedLink, markDone, missingConfig, removeMember, runSlug, signupFounder, strict, testMobile, testPassword,
  unresolvedLabels, workspace, type Hired,
} from '../utils/workspace-setup';

/**
 * #2266: one fresh tenant per run, from signup to a closed complaint and a
 * removed member. Runs leave the tenant behind (no tenant delete API exists);
 * its slug starts with `e2e-`.
 */
test('signup -> workspace DONE -> complaint lifecycle -> member removal on a fresh tenant', async () => {
  const missing = missingConfig();
  test.skip(missing.length > 0, `Real-stack onboarding gate; unset: ${missing.join(', ')}`);
  test.setTimeout(20 * 60_000);
  const base = baseURL();
  const slug = runSlug();
  const mail = (who: string) => `${slug}-${who}@${emailDomain()}`;
  test.info().annotations.push({ type: 'tenant-slug', description: slug });

  const contexts: APIRequestContext[] = [];
  const session = async (label: string) => {
    const context = strict(await playwright.newContext({ ignoreHTTPSErrors: process.env.ONBOARDING_E2E_IGNORE_HTTPS_ERRORS === '1' }), label);
    contexts.push(context);
    return context;
  };
  try {
    const founderHttp = await session('founder');
    let tenantId = '';
    let founder!: Digit;
    let locales: string[] = [];

    await test.step('1. magic-link signup, provisioning operation SUCCEEDED', async () => {
      ({ tenantId } = await signupFounder(founderHttp, base, { slug, email: mail('founder'), mobile: testMobile() }));
      expect(tenantId).toMatch(/^[a-z]{2,63}$/);
      test.info().annotations.push({ type: 'tenant-id', description: tenantId });
    });

    await test.step('2. founder _select; workspace NOT_STARTED', async () => {
      founder = new Digit(founderHttp, base, await selectContext(founderHttp, base, 'configurator', tenantId), tenantId);
      const { Workspace } = await workspace(founder);
      expect(Workspace.status).toBe('NOT_STARTED');
      locales = await labelLocales(founder);
    });

    await test.step('3a. Branding: logo upload + ThemeConfig, step DONE', async () => {
      await brandingStep(founder);
    });
    await test.step('3b. Geography: 2-level hierarchy, step DONE', async () => {
      await geographyStep(founder, locales);
    });
    await test.step('3c. Departments: 2 departments + 1 designation, step DONE', async () => {
      await departmentsStep(founder, locales);
    });

    const passwords = new Map<string, string>();
    let staff: Hired[] = [];
    await test.step('3d. Employees: HRMS _create + BFF _link, activation sets password, step DONE', async () => {
      const rule = (await founder.mdms('common-masters.MobileNumberValidation')).map(r => r.data).find(d => d.default === true)?.mobileNumberRegex;
      const people = [
        { key: 'gro-water', name: 'E2E Water Gro', role: 'GRO' as const, department: 'WATER', jurisdiction: 'E2E_COUNTY' },
        // The COMPLAINT_TYPES probe needs a current GRO in every routed department.
        { key: 'gro-roads', name: 'E2E Roads Gro', role: 'GRO' as const, department: 'ROADS', jurisdiction: 'E2E_COUNTY' },
        { key: 'lme', name: 'E2E Water Lme', role: 'PGR_LME' as const, department: 'WATER', jurisdiction: 'E2E_WARD_A' },
      ].map(p => ({ ...p, email: mail(p.key), mobile: testMobile() }));
      if (rule) for (const p of people) expect(p.mobile, 'test mobile satisfies the tenant rule').toMatch(new RegExp(rule));
      staff = await hireAndLink(founder, base, people);
      for (const member of staff.filter(m => m.key !== 'gro-roads')) {
        const { link } = await mailedLink(member.email);
        const password = testPassword();
        await activateAccount(await session(`${member.key}-activation`), link, password);
        passwords.set(member.key, password);
      }
      const listed = await identityJson<{ members: Array<{ digitUuid: string; state: string }> }>(
        await founderHttp.get(`${base}/identity/v1/workspace-members?tenantId=${tenantId}&first=0&max=100`));
      for (const member of staff) expect(listed.members.map(m => m.digitUuid), `${member.key} listed`).toContain(member.uuid);
      await markDone(founder, 'EMPLOYEES');
    });

    await test.step('3e. Complaint types: 2 leaves routed with SLA; workspace DONE', async () => {
      const final = await complaintTypesStep(founder, locales);
      expect(final.status).toBe('DONE');
      const { Workspace, Probes } = await workspace(founder);
      expect(Workspace.status).toBe('DONE');
      expect(Object.values(Workspace.steps).map(s => s.state)).toEqual(Array(5).fill('DONE'));
      expect(Probes, 'every live probe agrees').toEqual(Object.fromEntries(Object.keys(Workspace.steps).map(step => [step, true])));
    });

    await test.step('3f. labels written by the steps resolve for en_IN', async () => {
      const missingLabels = await unresolvedLabels(founder, 'en_IN', {
        'rainmaker-common': [...DEPARTMENTS.map(d => `COMMON_MASTERS_DEPARTMENT_${d.code}`), `COMMON_MASTERS_DESIGNATION_${DESIGNATION.code}`],
        'rainmaker-pgr': COMPLAINT_TYPES.flatMap(t => [t, ...t.leaves]).map(r => `COMPLAINT_HIERARCHY.${r.code}`),
        'rainmaker-boundary-admin': BOUNDARIES.map(b => b.code),
      });
      expect(missingLabels).toEqual([]);
    });

    const staffSession = async (key: string) => {
      const member = staff.find(m => m.key === key)!;
      const http = await session(key);
      await employeeSignIn(http, base, slug, member.email, passwords.get(key)!);
      return { member, http, digit: new Digit(http, base, await selectContext(http, base, 'employee', tenantId), tenantId) };
    };
    let gro!: Awaited<ReturnType<typeof staffSession>>;
    let lme!: Awaited<ReturnType<typeof staffSession>>;
    let citizen!: Digit;
    let id = '';

    await test.step('4. GRO and LME sign in with their own passwords', async () => {
      gro = await staffSession('gro-water');
      lme = await staffSession('lme');
      expect(gro.digit.user.roles as Array<{ code: string }>).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GRO' })]));
      expect(lme.digit.user.roles as Array<{ code: string }>).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PGR_LME' })]));
    });

    await test.step('5. citizen OTP sign-in at /{slug}/ and files a complaint', async () => {
      const http = await session('citizen');
      const context = await citizenSignIn(http, base, testMobile(), commandOtp, slug);
      citizen = new Digit(http, base, context, tenantId);
      const filed = await fileComplaint(citizen, 'WaterLeak', 'E2E_WARD_A');
      id = filed.serviceRequestId;
      expect(filed.applicationStatus).toBe('PENDINGFORASSIGNMENT');
      test.info().annotations.push({ type: 'complaint', description: id });
    });

    await test.step('6. GRO sees it in the inbox and assigns it to the LME', async () => {
      await expect.poll(() => inbox(gro.digit, 'TEAM'), { message: 'unassigned complaint in the GRO team inbox', timeout: 60_000 }).toContain(id);
      const service = await complaint(gro.digit, id);
      expect(service?.applicationStatus).toBe('PENDINGFORASSIGNMENT');
      expect(await act(gro.digit, service!, { action: 'ASSIGN', assignes: [lme.member.uuid], hrmsAssignes: [lme.member.uuid], comments: 'e2e assign' }))
        .toBe('PENDINGATLME');
    });

    await test.step('7. LME (ABAC scope) sees it and resolves it', async () => {
      await expect.poll(async () => (await complaint(lme.digit, id))?.applicationStatus, { message: 'assigned complaint visible to the LME', timeout: 60_000 })
        .toBe('PENDINGATLME');
      // MINE reads the workflow assignee, which egov-workflow saves apart from the PGR row polled above.
      await expect.poll(() => inbox(lme.digit, 'MINE'), { message: 'assigned complaint in the LME inbox', timeout: 60_000 }).toContain(id);
      expect(await act(lme.digit, (await complaint(lme.digit, id))!, { action: 'RESOLVE', comments: 'e2e resolved' })).toBe('RESOLVED');
    });

    await test.step('8. citizen rates and closes it; workflow history is complete', async () => {
      await expect.poll(async () => (await complaint(citizen, id))?.applicationStatus, { timeout: 60_000 }).toBe('RESOLVED');
      const service = { ...(await complaint(citizen, id))!, rating: 5 };
      expect(await act(citizen, service, { action: 'RATE', comments: 'e2e thanks', verificationDocuments: [] })).toBe('CLOSEDAFTERRESOLUTION');
      await expect.poll(() => history(gro.digit, id), { timeout: 60_000 }).toEqual(['APPLY', 'ASSIGN', 'RESOLVE', 'RATE']);
    });

    await test.step('9. founder removes the LME: HRMS inactive, binding gone, sessions and tokens revoked', async () => {
      const removed = await removeMember(founder, base, lme.member);
      expect(removed.state).toBe('removed');
      const row = (await founder.post(`/egov-hrms/employees/_search?tenantId=${tenantId}&codes=${lme.member.code}`, {}, founder.ri({ action: '_search' }))).Employees[0];
      expect(row.isActive).toBe(false);
      const listed = await identityJson<{ members: Array<{ digitUuid: string }> }>(
        await founderHttp.get(`${base}/identity/v1/workspace-members?tenantId=${tenantId}&first=0&max=100`));
      expect(listed.members.map(m => m.digitUuid)).not.toContain(lme.member.uuid);
      await expect.poll(async () => (await lme.http.get(`${base}/identity/v1/session?surface=employee`)).status(),
        { message: 'LME BFF session ends', timeout: 30_000 }).toBe(401);
      // Only an auth rejection proves revocation: a 400 business error would come from a still-valid token.
      await expect.poll(() => allowing(lme.http, [403], async () => String((await lme.digit.raw(`/pgr-services/v2/request/_search?tenantId=${tenantId}&limit=1`)).status())),
        { message: 'LME DIGIT token rejected (401/403)', timeout: 30_000 }).toMatch(/^40[13]$/);
      // The remaining staff are untouched.
      expect((await gro.http.get(`${base}/identity/v1/session?surface=employee`)).status()).toBe(200);
    });
  } finally {
    await Promise.all(contexts.map(context => context.dispose()));
  }
});
