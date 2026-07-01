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

  // Derive tenant mobile-number rules so specs mint numbers the target
  // tenant accepts — egov-user validates them even on _createnovalidate.
  //
  // Source order matters: the rule the server ENFORCES lives in MDMS
  // (common-masters.UserValidation — runtime-editable, Redis-cached by
  // egov-user). globalConfigs.js is a compile-time render of the same
  // host_var and goes stale the moment anyone tunes the MDMS rule, so it
  // is only a fallback for deployments that ship no UserValidation record
  // (pg/statea). Explicit CITIZEN_MOBILE_* env vars win over both.
  if (!process.env.CITIZEN_MOBILE_LENGTH || !process.env.CITIZEN_MOBILE_PREFIX || !process.env.CITIZEN_MOBILE_PATTERN) {
    const stateTenant =
      process.env.STATE_TENANT || (process.env.TENANT || 'pg.citya').split('.')[0];

    // 1. MDMS UserValidation — the runtime source of truth.
    try {
      const resp = await fetch(`${kongURL}/egov-mdms-service/v1/_search?tenantId=${stateTenant}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'e2e-global-setup', authToken: '' },
          MdmsCriteria: {
            tenantId: stateTenant,
            moduleDetails: [
              { moduleName: 'common-masters', masterDetails: [{ name: 'UserValidation' }] },
            ],
          },
        }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await resp.json()) as {
        MdmsRes?: {
          'common-masters'?: {
            UserValidation?: Array<{
              fieldType?: string;
              isActive?: boolean;
              rules?: { pattern?: string; minLength?: number };
            }>;
          };
        };
      };
      const rules = body?.MdmsRes?.['common-masters']?.UserValidation ?? [];
      const mobileRule = rules.find((r) => r.fieldType === 'mobile' && r.isActive !== false);
      if (mobileRule?.rules) {
        if (!process.env.CITIZEN_MOBILE_PATTERN && mobileRule.rules.pattern) {
          process.env.CITIZEN_MOBILE_PATTERN = String(mobileRule.rules.pattern);
        }
        if (!process.env.CITIZEN_MOBILE_LENGTH && mobileRule.rules.minLength) {
          process.env.CITIZEN_MOBILE_LENGTH = String(mobileRule.rules.minLength);
        }
        // A leading char-class (^[17]…, optionally ^0?[17]…) yields the
        // generation prefix; anything more exotic needs an explicit
        // CITIZEN_MOBILE_PREFIX — the self-assert in utils/mobile.ts
        // fails fast with that instruction if the projection is wrong.
        const lead = String(mobileRule.rules.pattern || '').match(/^\^(?:0\?)?\[?([0-9])/);
        if (!process.env.CITIZEN_MOBILE_PREFIX && lead) {
          process.env.CITIZEN_MOBILE_PREFIX = lead[1];
        }
        console.log(
          `[Global Setup] Mobile rules from MDMS UserValidation (${stateTenant}): pattern=${process.env.CITIZEN_MOBILE_PATTERN} length=${process.env.CITIZEN_MOBILE_LENGTH} prefix=${process.env.CITIZEN_MOBILE_PREFIX}`
        );
      } else {
        console.log(`[Global Setup] No MDMS UserValidation mobile rule on ${stateTenant} — trying globalConfigs`);
      }
    } catch {
      console.log('[Global Setup] MDMS UserValidation fetch failed — trying globalConfigs');
    }

    // 2. globalConfigs.js — compile-time fallback for deployments with no MDMS rule.
    //    Derive all constraints from mobileNumberRegex (single source of truth).
    if (!process.env.CITIZEN_MOBILE_LENGTH || !process.env.CITIZEN_MOBILE_PREFIX) {
      try {
        const resp = await fetch(`${baseURL}/digit-ui/globalConfigs.js`, { signal: AbortSignal.timeout(5000) });
        const text = await resp.text();
        const match = text.match(/coreMobileConfigs\s*=\s*(\{.*?\});/s);
        if (match) {
          const cfg = JSON.parse(match[1]);
          const pattern = cfg.mobileNumberRegex || cfg.mobileNumberPattern;
          if (pattern) {
            if (!process.env.CITIZEN_MOBILE_PATTERN) {
              process.env.CITIZEN_MOBILE_PATTERN = pattern;
            }
            // Derive max length from regex when not already set from MDMS
            if (!process.env.CITIZEN_MOBILE_LENGTH) {
              const lenMatch = pattern.match(/\{(\d+)(?:,(\d+))?\}/g);
              if (lenMatch) {
                const last = lenMatch[lenMatch.length - 1].match(/\{(\d+)(?:,(\d+))?\}/);
                const maxLen = last ? parseInt(last[2] || last[1], 10) + 1 : undefined;
                if (maxLen) process.env.CITIZEN_MOBILE_LENGTH = String(maxLen);
              }
            }
            // Derive first allowed starting digit from the regex's first char class
            if (!process.env.CITIZEN_MOBILE_PREFIX) {
              const firstClass = pattern.replace(/^\^/, '').match(/\[([^\]]+)\]|\d/);
              const lead = firstClass ? firstClass[1] || firstClass[0] : null;
              if (lead) process.env.CITIZEN_MOBILE_PREFIX = lead[0];
            }
          }
          console.log(
            `[Global Setup] Mobile rules from globalConfigs (compile-time fallback): pattern=${process.env.CITIZEN_MOBILE_PATTERN} length=${process.env.CITIZEN_MOBILE_LENGTH || '(default)'} prefix=${process.env.CITIZEN_MOBILE_PREFIX || '(default)'}`
          );
        }
      } catch {
        console.log('[Global Setup] Could not derive mobile rules from globalConfigs — using defaults/env');
      }
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
