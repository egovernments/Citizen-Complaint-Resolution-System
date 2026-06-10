/**
 * EscalationConfigEditor — configurator UI regression on Bomet.
 *
 * Drives the new dedicated EscalationConfig editor (digit-configurator
 * `src/admin/themeEditor/EscalationConfigEditor.tsx`) end-to-end via the
 * configurator UI:
 *
 *   1. Logs in as ADMIN/ke through the configurator session-injection helper
 *      (loginConfigurator) and lands on /configurator/manage.
 *   2. Navigates to `/configurator/manage/escalation-config/<id>/edit` —
 *      the record uniqueIdentifier on Bomet is the literal string "3"
 *      (the EscalationConfig idField is `maxDepth`, value 3).
 *   3. Asserts the page renders the dedicated editor layout: max-depth
 *      input, SLA-by-level rows, per-service overrides section, and the
 *      DesignationTreePanel side aside. We assert via role/text rather
 *      than data-testid so trivial restyles don't break us.
 *   4. Mutates level 0's SLA to 60_000 ms (60s) via the form, clicks Save,
 *      asserts the row commits (Save button no longer dirty / success
 *      indication).
 *   5. Verifies via MDMS API that defaultSlaByLevel[0] === 60000.
 *   6. afterAll: restores the original SLA via API (the configurator
 *      doesn't currently expose an "undo last save" affordance).
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet \
 *   ROOT_TENANT=ke \
 *   npx playwright test tests/admin/escalation-configurator-bomet.spec.ts
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../utils/configurator-auth';
import { getDigitToken } from '../utils/auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

// uniqueIdentifier of the single EscalationConfig MDMS record on Bomet's `ke`
// tenant. Falls back to "3" (the value of maxDepth, which is the schema's
// idField). Override via env when running against a tenant where the record
// has been re-keyed.
const ESC_RECORD_ID = process.env.ESCALATION_RECORD_ID || '3';

// Test value we'll set + revert. 60_000 ms (1 minute) is distinctly smaller
// than any production SLA (which start at 1h) so the assertion can't be
// accidentally satisfied by the live data.
const TEST_SLA_LEVEL0_MS = 60_000;

async function fetchEscalationConfig(token: string) {
  const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, ts: Date.now() },
      MdmsCriteria: {
        tenantId: ROOT_TENANT,
        schemaCode: 'RAINMAKER-PGR.EscalationConfig',
        limit: 5,
      },
    }),
  });
  const body = await resp.json();
  return body.mdms?.[0];
}

async function updateEscalationConfigData(
  token: string,
  userInfo: Record<string, unknown>,
  record: any,
  newData: Record<string, unknown>,
): Promise<void> {
  const updated = { ...record, data: { ...record.data, ...newData } };
  const schemaCode = encodeURIComponent(record.schemaCode);
  await fetch(`${BASE_URL}/mdms-v2/v2/_update/${schemaCode}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo, ts: Date.now() },
      Mdms: updated,
    }),
  });
}

test.describe.serial('EscalationConfigEditor on Bomet configurator', () => {
  // We hold the original record so afterAll can put the SLA back even if
  // the UI test threw mid-edit.
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let originalRecord: any;

  test.beforeAll(async () => {
    const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;
    originalRecord = await fetchEscalationConfig(adminToken);
    expect(
      originalRecord,
      `Pre-flight: EscalationConfig record must exist at ${ROOT_TENANT}/${ESC_RECORD_ID}`,
    ).toBeTruthy();
    expect(originalRecord.uniqueIdentifier).toBe(ESC_RECORD_ID);
    console.log(
      `[pre-flight] EscalationConfig record found: id=${originalRecord.id}, ` +
      `uniqueId=${originalRecord.uniqueIdentifier}, slas=${JSON.stringify(originalRecord.data.defaultSlaByLevel)}`,
    );
  });

  test.afterAll(async () => {
    if (!adminToken || !originalRecord) return;
    try {
      // Re-search so we PUT against the current row (audit fields move forward
      // on every write — if we left the SLA dirtied, this restores).
      const current = await fetchEscalationConfig(adminToken);
      await updateEscalationConfigData(adminToken, adminUserInfo, current ?? originalRecord, {
        maxDepth: originalRecord.data.maxDepth,
        defaultSlaByLevel: originalRecord.data.defaultSlaByLevel,
        overrides: originalRecord.data.overrides ?? {},
      });
      console.log('Restored EscalationConfig SLAs via API');
    } catch (err) {
      console.log(`[afterAll] EscalationConfig restore failed: ${(err as Error).message}`);
    }
  });

  test('1 — edit page renders the dedicated EscalationConfig editor', {
    annotation: {
      type: 'description',
      description: `Catches regression on the customEditor escape hatch. The edit route must render the dedicated EscalationConfig editor — maxDepth integer input, three SLA-by-level rows (matches the live maxDepth=3), the per-service overrides section, and the DesignationTreePanel side aside. If the descriptor's customEditor key stops resolving, MdmsResourceEdit falls back to the generic form and none of these landmarks are present.

Steps:
1. setTimeout 90s; loginConfigurator(page).
2. Navigate to /configurator/manage/escalation-config/<id>/edit (45s timeout).
3. Wait for the editor title "Edit PGR Escalation Config" to appear (or fall back to URL match).
4. Assert there's a "Default SLA per level" label visible.
5. Assert at least three "Level N" rows are visible inside the SLA-by-level widget (Level 0 / Level 1 / Level 2 — matches maxDepth=3).
6. Assert the "Per-service overrides" section header is visible.
7. Assert the DesignationTreePanel renders — its "Designations" label is visible.
8. Assert the "Max escalation depth" integer input is visible and currently equals "3".

Doesn't mutate state — read-only sanity that the editor mounts.`,
    },
    tag: ['@area:configurator-manage', '@area:escalation', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(90_000);

    await loginConfigurator(page);
    const editUrl = `${CONFIGURATOR_BASE}/manage/escalation-config/${ESC_RECORD_ID}/edit`;
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // The editor's <DigitEdit> wraps the form in a "Edit <label>" heading.
    // Either the heading or the SLA-by-level field is enough to confirm the
    // editor mounted — but we prefer the SLA widget because the label is
    // i18n-prone and we want a hard structural assertion.
    const slaLabel = page.getByText(/Default SLA per level/i).first();
    await expect(slaLabel, 'SLA-by-level label must render').toBeVisible({ timeout: 30_000 });

    // Three rows expected on Bomet (maxDepth=3).
    for (const level of [0, 1, 2]) {
      const row = page.getByText(new RegExp(`^Level\\s+${level}$`));
      await expect(row, `Level ${level} row must render`).toBeVisible({ timeout: 10_000 });
    }

    await expect(page.getByText(/Per-service overrides/i).first(), 'overrides section header').toBeVisible();
    await expect(page.getByText(/^Designations$/).first(), 'DesignationTreePanel sidebar').toBeVisible();

    // Max escalation depth input — should currently be 3 from the live record.
    const maxDepthInput = page.locator('input[name="maxDepth"]').first();
    await expect(maxDepthInput, 'maxDepth input must render').toBeVisible({ timeout: 10_000 });
    await expect(maxDepthInput).toHaveValue('3');
    console.log('EscalationConfigEditor layout verified (SLA rows, overrides, designation panel)');
  });

  test('2 — change Level 0 SLA to 60000 ms via the UI; assert MDMS reflects the new value', {
    annotation: {
      type: 'description',
      description: `Round-trips a SLA edit through the UI: opens the Level 0 row, toggles its mode to raw ms (so we can type a plain integer instead of fighting the hh:mm:ss parser), types 60000, blurs, clicks Save. Then re-reads MDMS via API and asserts defaultSlaByLevel[0] === 60000. This is the canonical "the form actually wires to MDMS _update" assertion.

Steps:
1. setTimeout 90s; loginConfigurator(page); navigate to edit URL.
2. Find the row labelled "Level 0", toggle its mode button to "ms" if currently "hh:mm:ss".
3. Fill the row's input with "60000" and blur.
4. Click the form's Save button.
5. Wait for either a toast or a settled state (the page either navigates back to the show view or the form goes clean).
6. Sleep 5s for the MDMS persister (HTTP 202 from _update; Kafka → egov-persister).
7. Re-fetch EscalationConfig via API; assert defaultSlaByLevel[0] === 60000.

The afterAll restores the original SLA, so the test is idempotent.`,
    },
    tag: ['@area:configurator-manage', '@area:escalation', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(120_000);

    await loginConfigurator(page);
    const editUrl = `${CONFIGURATOR_BASE}/manage/escalation-config/${ESC_RECORD_ID}/edit`;
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByText(/Default SLA per level/i).first()).toBeVisible({ timeout: 30_000 });

    // The Level 0 row layout (from SlaByLevelInput.tsx):
    //   <div class="flex …">
    //     <div class="w-20 …">Level 0</div>
    //     <Input value=… />
    //     <Button> hh:mm:ss | ms </Button>
    //     <div> 1 hour </div>
    //     [<Button aria-label="remove level 0">…</Button>]
    //   </div>
    // The level-0 row is special: no remove button (canRemove=false for index 0).
    const level0Row = page.locator('div', { hasText: /^Level\s+0$/ }).first();
    // Walk up to the nearest flex container holding the inputs (safer than
    // locator('..') on a text-only div which can resolve to the wrong parent).
    const level0Container = page.locator('div.flex.items-center', { has: page.locator('text=/^Level\\s+0$/') }).first();
    await expect(level0Container).toBeVisible({ timeout: 15_000 });

    const toggleBtn = level0Container.getByRole('button', { name: /^(hh:mm:ss|ms)$/ });
    await toggleBtn.waitFor({ state: 'visible', timeout: 10_000 });

    // Switch to raw "ms" mode for predictable input.
    const initialMode = (await toggleBtn.textContent())?.trim();
    if (initialMode === 'hh:mm:ss') {
      // The button text shows the current mode; clicking flips to the other
      // and re-renders the draft. After click, the input accepts plain ms.
      await toggleBtn.click();
      await expect(toggleBtn).toHaveText('ms', { timeout: 3_000 });
    }

    const slaInput = level0Container.locator('input').first();
    await slaInput.fill(String(TEST_SLA_LEVEL0_MS));
    await slaInput.blur();

    // The footer of <DigitEdit> renders a Save button via React-Admin / ra-core.
    const saveBtn = page.getByRole('button', { name: /^Save$/i }).first();
    await saveBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await saveBtn.click();

    // React-Admin's Edit either flashes a success toast or navigates away to
    // the show view. Either outcome is a "save fired". Don't pin a single
    // selector; wait for any of three signals.
    await Promise.race([
      page.waitForURL(/escalation-config\/[^/]+(\/show)?$/, { timeout: 20_000 }).catch(() => null),
      page.getByText(/saved|updated|success/i).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null),
      page.waitForTimeout(8_000),
    ]);

    // Give the async persister time to flush
    await new Promise((r) => setTimeout(r, 5_000));

    const after = await fetchEscalationConfig(adminToken);
    console.log(`Post-save MDMS state: ${JSON.stringify(after?.data?.defaultSlaByLevel)}`);
    expect(after?.data?.defaultSlaByLevel?.[0], 'defaultSlaByLevel[0] must be 60000 after UI save').toBe(TEST_SLA_LEVEL0_MS);
  });
});
