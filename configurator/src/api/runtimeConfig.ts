// Runtime configuration channel for the configurator SPA.
//
// WHY THIS EXISTS
// ---------------
// The configurator is a standalone Vite app. Historically every
// deployment-specific value (`VITE_STATE_TENANT_ID`, `VITE_OVERPASS_URL`, …)
// was read straight from `import.meta.env`, i.e. baked in at BUILD time. That
// made the bundle deployment-specific: the only way to get a correct
// configurator was to rebuild it on the target box with the right env exported
// (`local-setup/ansible/files/configurator-build.sh`). A pre-built image — the
// one the nightly publishes to `egovio/configurator` — always baked these
// EMPTY, which silently degrades the app rather than failing it: the login
// screen loses its pre-filled tenant, and the Phase-2 boundary fetch falls back
// to the public rate-limited Overpass instance.
//
// digit-ui solved the same problem by loading a small config script at runtime
// (`/digit-ui/globalConfigs.js`, rendered per-tenant by the ansible deploy).
// This mirrors that: `<base>/config.js` assigns `window.__CONFIGURATOR_CONFIG__`
// and is loaded from index.html BEFORE the module bundle. One image now serves
// every deployment; configuration is a file next to the bundle, not a rebuild.
//
// PRECEDENCE: runtime (config.js) > build-time (import.meta.env) > code default.
// Build-time is retained as a fallback so `npm run dev` and any existing
// build-with-env workflow keep working unchanged.

export interface ConfiguratorRuntimeConfig {
  STATE_TENANT_ID?: string;
  OVERPASS_URL?: string;
  TURBOPASS_URL?: string;
  BOUNDARY_SEARCH_LIMIT?: string | number;
}

declare global {
  interface Window {
    __CONFIGURATOR_CONFIG__?: ConfiguratorRuntimeConfig;
  }
}

/**
 * Resolve a configuration value.
 *
 * `buildTimeValue` MUST be passed as a literal `import.meta.env.VITE_*` member
 * access at the call site — Vite only statically replaces that exact form, so
 * an indexed lookup (`import.meta.env[key]`) would silently resolve to
 * undefined in a production build.
 *
 * Empty/whitespace-only values are treated as unset at every layer, so a
 * config.js rendered with a blank field falls through to the build-time value
 * instead of overriding it with "".
 */
export function resolveConfig(
  key: keyof ConfiguratorRuntimeConfig,
  buildTimeValue?: unknown,
): string {
  const runtime =
    typeof window !== 'undefined' ? window.__CONFIGURATOR_CONFIG__?.[key] : undefined;
  const fromRuntime = runtime === undefined || runtime === null ? '' : String(runtime).trim();
  if (fromRuntime) return fromRuntime;

  const fromBuild =
    buildTimeValue === undefined || buildTimeValue === null ? '' : String(buildTimeValue).trim();
  return fromBuild;
}

/**
 * Turn a resolved config string into a positive count (a page size, a timeout,
 * a retry budget), applying `fallback` ONLY when the value cannot be honoured.
 *
 * Why this is not `Number(raw) || fallback`: `||` rejects on truthiness, so it
 * swallows `0` — and `0` is a value an operator can legitimately have written
 * into config.js. Rejecting it silently via `||` would break the precedence
 * contract in the one place it is most visible (an explicitly configured value
 * being ignored). This rejects EXPLICITLY instead, on stated rules:
 *
 *   - blank            -> fallback (nothing was configured; see resolveConfig)
 *   - not a number     -> fallback ("abc", "12px", NaN, Infinity)
 *   - <= 0             -> fallback (see below)
 *   - anything else    -> the configured number, `0`-adjacent values included
 *
 * `0` and negatives are rejected because these are COUNTS: a page size of 0
 * asks the server for nothing, which is never what "configure the limit" means
 * — it would render an empty map rather than an obviously broken one, i.e. the
 * silent degradation this whole runtime-config change exists to remove. A
 * caller that genuinely wants "no cap" should be given a sentinel, not 0.
 */
export function resolvePositiveNumber(raw: string, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
