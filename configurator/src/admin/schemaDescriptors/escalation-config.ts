import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.EscalationConfig` — the PGR scheduler's
 * per-tenant escalation rules.
 *
 * Shape:
 *   - maxDepth: integer (1-10) — how many escalation levels are supported
 *   - defaultSlaByLevel: number[] of milliseconds — one SLA per level. Length
 *     SHOULD equal maxDepth; the scheduler tolerates shorter arrays by falling
 *     back to the last entry.
 *   - overrides: Record<serviceCode, number[]> — per-service per-level SLAs
 *     that supersede `defaultSlaByLevel`. Service codes come from MDMS
 *     `common-masters.ServiceDefs` (a.k.a. `RAINMAKER-PGR.ServiceDefs`).
 *
 * Only lives at the root tenant (e.g. `ke`). City tenants inherit this config.
 *
 * Sample live record (root `ke` as of 2026-06-08):
 *   { "maxDepth": 3,
 *     "defaultSlaByLevel": [3600000, 14400000, 86400000],
 *     "overrides": {} }
 *
 * The widgets `sla-by-level` and `service-overrides` are bespoke — see
 * `src/components/widgets/SlaByLevelInput.tsx` and `ServiceOverridesEditor.tsx`.
 */
export const escalationConfigDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.EscalationConfig',
  // Mounted via custom editor so the DesignationTreePanel can render alongside
  // the form. The widgets themselves are still the generic ones declared
  // below — the custom editor just lays them out.
  customEditor: 'escalation-config',
  groups: [
    { title: 'Depth & default SLAs', fields: ['maxDepth', 'defaultSlaByLevel'] },
    { title: 'Per-service overrides', fields: ['overrides'] },
  ],
  fields: [
    {
      path: 'maxDepth',
      widget: 'integer',
      required: true,
      min: 1,
      max: 10,
      label: 'Max escalation depth',
      help: 'Number of escalation levels supported (1-10). The scheduler stops promoting beyond this depth.',
    },
    {
      path: 'defaultSlaByLevel',
      widget: 'sla-by-level',
      required: true,
      label: 'Default SLA per level',
      help: 'SLA per escalation level, in milliseconds. The length should match maxDepth.',
    },
    {
      path: 'overrides',
      widget: 'service-overrides',
      label: 'Per-service overrides',
      help: 'Per-service-code SLA overrides. Service codes come from common-masters.ServiceDefs.',
    },
  ],
};
