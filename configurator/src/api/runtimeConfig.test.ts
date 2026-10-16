import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { resolveConfig, resolvePositiveNumber } from './runtimeConfig';

// Precedence contract: runtime (config.js) > build-time (import.meta.env) >
// caller's in-code default. A blank value at any layer must FALL THROUGH rather
// than win — otherwise a config.js rendered with an empty field (the normal
// state for an unconfigured deployment) would override a perfectly good
// build-time value with "".
describe('resolveConfig', () => {
  afterEach(() => {
    delete window.__CONFIGURATOR_CONFIG__;
  });

  it('prefers the runtime value over the build-time one', () => {
    window.__CONFIGURATOR_CONFIG__ = { STATE_TENANT_ID: 'mz' };
    expect(resolveConfig('STATE_TENANT_ID', 'pg')).toBe('mz');
  });

  it('falls back to the build-time value when the runtime key is absent', () => {
    window.__CONFIGURATOR_CONFIG__ = {};
    expect(resolveConfig('STATE_TENANT_ID', 'pg')).toBe('pg');
  });

  it('falls back when config.js is missing entirely', () => {
    expect(resolveConfig('STATE_TENANT_ID', 'pg')).toBe('pg');
  });

  it('treats a blank runtime value as unset (the unconfigured-deployment case)', () => {
    window.__CONFIGURATOR_CONFIG__ = { STATE_TENANT_ID: '   ' };
    expect(resolveConfig('STATE_TENANT_ID', 'pg')).toBe('pg');
  });

  it('returns empty when neither layer supplies a value, so callers apply their default', () => {
    window.__CONFIGURATOR_CONFIG__ = { OVERPASS_URL: '' };
    expect(resolveConfig('OVERPASS_URL', undefined)).toBe('');
  });

  it('trims and stringifies (BOUNDARY_SEARCH_LIMIT arrives as a number or string)', () => {
    window.__CONFIGURATOR_CONFIG__ = { BOUNDARY_SEARCH_LIMIT: 500 };
    expect(resolveConfig('BOUNDARY_SEARCH_LIMIT', '300')).toBe('500');
    expect(resolvePositiveNumber(resolveConfig('BOUNDARY_SEARCH_LIMIT', '300'), 300)).toBe(500);
  });

  it('a blank limit falls through to the build-time value, then the code default', () => {
    window.__CONFIGURATOR_CONFIG__ = { BOUNDARY_SEARCH_LIMIT: '' };
    expect(resolvePositiveNumber(resolveConfig('BOUNDARY_SEARCH_LIMIT', undefined), 300)).toBe(300);
  });
});

// The numeric layer on top of resolveConfig. `Number(x) || fallback` was the
// original form and it rejected on TRUTHINESS, which silently swallowed an
// explicitly-configured 0 — a configured value being ignored is exactly the
// failure mode the precedence contract exists to prevent. These pin the
// explicit rules instead.
describe('resolvePositiveNumber', () => {
  afterEach(() => {
    delete window.__CONFIGURATOR_CONFIG__;
  });

  it('honours a configured positive number', () => {
    expect(resolvePositiveNumber('500', 300)).toBe(500);
  });

  it('applies the fallback for a blank value (nothing configured)', () => {
    expect(resolvePositiveNumber('', 300)).toBe(300);
  });

  it('rejects 0 and negatives by the stated rule, not by truthiness', () => {
    // The rejection is `parsed <= 0`, not `!parsed`: -1 is TRUTHY as a number
    // and '0' is TRUTHY as a string, so neither is caught by `||` at the layer
    // it would have to be caught at. A fraction is positive, so it is honoured
    // — we reject non-positive counts, we do not round.
    expect(resolvePositiveNumber('0', 300)).toBe(300);
    expect(resolvePositiveNumber('-1', 300)).toBe(300);
    expect(resolvePositiveNumber('0.5', 300)).toBe(0.5);
  });

  it('rejects a non-numeric value rather than propagating NaN', () => {
    expect(resolvePositiveNumber('abc', 300)).toBe(300);
    expect(resolvePositiveNumber('300px', 300)).toBe(300);
    expect(resolvePositiveNumber('Infinity', 300)).toBe(300);
  });

  it('rejects a 0 that arrived through config.js as a real number', () => {
    // config.js can assign a JS number, not just a string (the ansible
    // template renders BOUNDARY_SEARCH_LIMIT unquoted when it is set).
    window.__CONFIGURATOR_CONFIG__ = { BOUNDARY_SEARCH_LIMIT: 0 };
    expect(resolveConfig('BOUNDARY_SEARCH_LIMIT', '250')).toBe('0');
    expect(resolvePositiveNumber(resolveConfig('BOUNDARY_SEARCH_LIMIT', '250'), 300)).toBe(300);
  });
});

// STATE_TENANT_ID is the only one of the four settings that used to have no
// in-code default, which is what made a blank config.js mean "retype the tenant
// on every login". It now falls back to 'pg' (the tenant the seed dump always
// creates) like the other three fall back to their own defaults.
//
// These exercise the PRODUCTION consumer in ./config.ts, not a test-side copy of
// the `|| 'pg'` expression. That distinction is load-bearing: with the fallback
// re-implemented here, deleting it from config.ts left every case green (checked
// by mutation), so the suite could not have caught the regression it exists to
// prevent. config.ts resolves STATE_TENANT_ID once at module scope, so each case
// resets the module registry and re-imports to pick up the new window state.
describe('STATE_TENANT_ID (as config.ts resolves it)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete window.__CONFIGURATOR_CONFIG__;
    vi.unstubAllEnvs();
  });

  it('honours a configured tenant over the default', async () => {
    window.__CONFIGURATOR_CONFIG__ = { STATE_TENANT_ID: 'mz' };
    const { STATE_TENANT_ID } = await import('./config');
    expect(STATE_TENANT_ID).toBe('mz');
  });

  it("falls back to 'pg' when nothing is configured at any layer", async () => {
    // Blank the build-time layer EXPLICITLY rather than assuming it is unset.
    // vitest loads VITE_*-prefixed variables from the environment and .env
    // files, so a stray VITE_STATE_TENANT_ID=pg would satisfy this assertion
    // through the build-time layer and the case would still pass with the
    // in-code default deleted — i.e. it would stop testing the default at all.
    vi.stubEnv('VITE_STATE_TENANT_ID', '');
    window.__CONFIGURATOR_CONFIG__ = { STATE_TENANT_ID: '' };
    const { STATE_TENANT_ID, DEFAULT_STATE_TENANT_ID } = await import('./config');
    expect(STATE_TENANT_ID).toBe('pg');
    expect(STATE_TENANT_ID).toBe(DEFAULT_STATE_TENANT_ID);
  });

  it('a blank runtime value still defers to a build-time one before the default', async () => {
    vi.stubEnv('VITE_STATE_TENANT_ID', 'ke');
    window.__CONFIGURATOR_CONFIG__ = { STATE_TENANT_ID: '' };
    const { STATE_TENANT_ID } = await import('./config');
    expect(STATE_TENANT_ID).toBe('ke');
  });

  it('getConfiguredRootTenant collapses a city code and is never empty', async () => {
    window.__CONFIGURATOR_CONFIG__ = { STATE_TENANT_ID: 'mz.maputo' };
    const { getConfiguredRootTenant } = await import('./config');
    expect(getConfiguredRootTenant()).toBe('mz');
  });
});
