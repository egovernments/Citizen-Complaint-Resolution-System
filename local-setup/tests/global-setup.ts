/**
 * Global setup hook for Playwright tests.
 *
 * Verifies the DIGIT stack is reachable before running tests.
 * Checks both the esbuild dev server and the Kong API gateway.
 */
export default async function globalSetup() {
  const baseURL = process.env.BASE_URL || 'http://localhost:18080';
  const kongURL = 'http://localhost:18000';
  const maxRetries = 30;
  const retryDelay = 2000;

  console.log('[Global Setup] Checking DIGIT stack readiness...');

  // Check esbuild dev server
  let esbuildReady = false;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const resp = await fetch(`${baseURL}/digit-ui/employee/user/login`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        console.log(`[Global Setup] esbuild dev server ready (HTTP ${resp.status})`);
        esbuildReady = true;
        break;
      }
      console.log(`[Global Setup] esbuild returned HTTP ${resp.status} (attempt ${i}/${maxRetries})`);
    } catch (e) {
      console.log(`[Global Setup] esbuild not ready (attempt ${i}/${maxRetries})`);
    }
    await new Promise(r => setTimeout(r, retryDelay));
  }

  if (!esbuildReady) {
    throw new Error('[Global Setup] esbuild dev server not reachable. Run: cd frontend/micro-ui/web && node esbuild.dev.js');
  }

  // Derive tenant mobile-number rules from the deployment's
  // globalConfigs.js so specs mint numbers the target tenant accepts —
  // egov-user validates the tenant rule even on _createnovalidate.
  // Explicit CITIZEN_MOBILE_* env vars win; if the fetch fails the
  // utils/mobile.ts pg defaults (10 digits starting 9) apply.
  if (!process.env.CITIZEN_MOBILE_LENGTH || !process.env.CITIZEN_MOBILE_PREFIX) {
    try {
      const resp = await fetch(`${baseURL}/digit-ui/globalConfigs.js`, { signal: AbortSignal.timeout(5000) });
      const text = await resp.text();
      const match = text.match(/coreMobileConfigs\s*=\s*(\{.*?\});/s);
      if (match) {
        const cfg = JSON.parse(match[1]);
        if (!process.env.CITIZEN_MOBILE_LENGTH && cfg.mobileNumberLength) {
          process.env.CITIZEN_MOBILE_LENGTH = String(cfg.mobileNumberLength);
        }
        const starts = cfg.mobileNumberAllowedStartingCharacters;
        if (!process.env.CITIZEN_MOBILE_PREFIX && Array.isArray(starts) && starts.length > 0) {
          process.env.CITIZEN_MOBILE_PREFIX = String(starts[0]);
        }
        console.log(
          `[Global Setup] Mobile rules from globalConfigs: length=${process.env.CITIZEN_MOBILE_LENGTH || '(default 10)'} prefix=${process.env.CITIZEN_MOBILE_PREFIX || '(default 9)'}`
        );
      }
    } catch {
      console.log('[Global Setup] Could not derive mobile rules from globalConfigs — using defaults/env');
    }
  }

  // Check Kong gateway (API proxy target)
  try {
    const resp = await fetch(`${kongURL}/user/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=password&username=ADMIN&password=eGov%40123&tenantId=pg&scope=read&userType=EMPLOYEE',
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      console.log('[Global Setup] Kong gateway reachable, auth working');
    } else {
      console.log(`[Global Setup] Warning: Kong auth returned HTTP ${resp.status} — tests may fail`);
    }
  } catch (e) {
    console.log('[Global Setup] Warning: Kong gateway not reachable — API tests may fail');
  }

  console.log('[Global Setup] Complete — ready for tests.');
}
