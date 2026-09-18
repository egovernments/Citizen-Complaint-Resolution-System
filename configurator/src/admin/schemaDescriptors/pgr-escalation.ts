import type { SchemaDescriptor } from './types';

/**
 * Editor contract for the single PGR escalation policy record.
 *
 * The generic MDMS editor deliberately skips arrays and objects. Escalation is
 * almost entirely arrays/objects, so registering the resource without this
 * descriptor produced a form that could show maxDepth but could not edit the
 * percentage ladder, eligible states, per-level flags, or complaint-type
 * overrides (#2034).
 *
 * Keep percentage and fallback ladders as JSON arrays. This preserves numeric
 * values (a chip-array is string-only), lets operators add/remove hierarchy
 * levels, and leaves the authoritative ordering/range checks to the MDMS schema
 * and pgr-services. Overrides remain one JSON object because their keys are
 * tenant-specific leaf serviceCodes.
 */
export const pgrEscalationDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.EscalationConfig',
  groups: [
    { title: 'Policy', fields: ['code', 'maxDepth', 'eligibleStatuses'] },
    {
      title: 'Default thresholds',
      fields: ['defaultSlaPercentageByLevel', 'defaultSlaByLevel', 'enabledByLevel'],
    },
    { title: 'Complaint-type overrides', fields: ['overrides'] },
  ],
  fields: [
    {
      path: 'code',
      widget: 'text',
      required: true,
      hidden: 'edit',
      label: 'Record key',
      help: 'Use DEFAULT. This is the immutable key of the singleton policy record.',
    },
    {
      path: 'maxDepth',
      widget: 'integer',
      required: true,
      min: 0,
      label: 'Maximum escalation depth',
      help: 'Maximum number of upward reportingTo hops. The configured ladder may stop earlier.',
    },
    {
      path: 'eligibleStatuses',
      widget: 'chip-array',
      required: true,
      label: 'Automatic-escalation states',
      help: 'Workflow application statuses scanned automatically. Each state must have an ESCALATE self-loop for SYSTEM. Shipped value: PENDINGATLME.',
    },
    {
      path: 'defaultSlaPercentageByLevel',
      widget: 'json',
      label: 'Cumulative SLA percentages',
      help: 'Preferred cumulative thresholds against the complaint type SLA, for example [80, 120, 200]. Values must strictly increase and cannot exceed 200.',
    },
    {
      path: 'defaultSlaByLevel',
      widget: 'json',
      required: true,
      label: 'Absolute fallback thresholds (ms)',
      help: 'Strictly increasing cumulative complaint-age thresholds in milliseconds. Used only when percentages or the complaint type SLA are unavailable.',
    },
    {
      path: 'enabledByLevel',
      widget: 'json',
      label: 'Automatic levels enabled',
      help: 'Optional boolean array, for example [true, true, false]. It controls automatic triggering only; manual escalation remains available up to maximum depth.',
    },
    {
      path: 'overrides',
      widget: 'json',
      label: 'Complaint-type overrides',
      help: 'JSON object keyed by the exact leaf serviceCode. Example: {"StreetLightNotWorking":{"slaPercentageByLevel":[50,100,150]}}.',
    },
  ],
};
