import { test } from '@playwright/test';

test('capture MDMS calls from login page', {
  annotation: {
    type: 'description',
    description: `Diagnostic spec used to inspect what the citizen login page actually requests from MDMS — specifically which tenant it uses and which validation modules it queries (MobileNumberValidation, ValidationConfigs). The test attaches request/response listeners, navigates to the login page, and prints every relevant MDMS POST it sees plus the STATE_LEVEL_TENANT_ID the UI resolved.

Steps:
1. Attach listeners to capture every POST that hits an mdms URL plus its JSON response.
2. Navigate to https://naipepea.digit.org/digit-ui/citizen/login and wait 10s for the page to settle.
3. Walk the captured calls and print URL/tenant/modules/response for any whose body mentions MobileNumberValidation or ValidationConfigs.
4. Print the total MDMS POST count and read STATE_LEVEL_TENANT_ID off window.globalConfigs.

This is a diagnostic, not an assertion-driven test — it has no expect() calls and exists to surface what's going over the wire when mobile validation looks wrong.`,
  },
  tag: ['@area:mdms-schema', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(60_000);

  const mdmsCalls: any[] = [];

  page.on('request', req => {
    const url = req.url();
    if (url.includes('mdms') && req.method() === 'POST') {
      let bodyText = '';
      try { bodyText = req.postData() || ''; } catch {}
      mdmsCalls.push({ url, body: bodyText });
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('mdms') && url.includes('_search')) {
      try {
        const body = await resp.json();
        const tcalls = mdmsCalls.find(c => !c.response && c.url === url);
        if (tcalls) tcalls.response = body;
      } catch {}
    }
  });

  await page.goto('https://naipepea.digit.org/digit-ui/citizen/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);

  // Print all MDMS calls that mentioned mobile/Validation
  for (const c of mdmsCalls) {
    const body = c.body || '';
    if (body.includes('MobileNumberValidation') || body.includes('mobileNumberValidation') || body.includes('ValidationConfigs')) {
      console.log('=== MDMS CALL ===');
      console.log('URL:', c.url);
      try {
        const parsed = JSON.parse(body);
        console.log('Tenant:', parsed?.MdmsCriteria?.tenantId);
        console.log('Modules:', JSON.stringify(parsed?.MdmsCriteria?.moduleDetails));
      } catch {
        console.log('Body (raw):', body.slice(0, 300));
      }
      if (c.response) {
        const tc = c.response?.mdms;
        console.log('Returned MobileNumberValidation records:', JSON.stringify(tc));
      }
    }
  }

  console.log('---');
  console.log('Total MDMS POSTs:', mdmsCalls.length);

  // Also check what stateId the UI sees
  const stateId = await page.evaluate(() => (window as any).globalConfigs?.getConfig?.('STATE_LEVEL_TENANT_ID'));
  console.log('STATE_LEVEL_TENANT_ID in window.globalConfigs:', stateId);
});
