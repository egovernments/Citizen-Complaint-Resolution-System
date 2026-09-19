import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.EscalationConfig`.
 *
 * Configurator edits the singleton policy (`code: DEFAULT`) consumed by
 * `pgr-services`. When edited via the generic MDMS resource page, `customEditor: 'escalation-policy'`
 * routes directly to the dedicated EscalationPolicyEditor.
 */
export const escalationConfigDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.EscalationConfig',
  customEditor: 'escalation-policy',
  groups: [
    { title: 'Identity', fields: ['code', 'maxDepth'] },
    { title: 'Trigger States', fields: ['eligibleStatuses'] },
    {
      title: 'Thresholds',
      fields: ['defaultSlaPercentageByLevel', 'defaultSlaByLevel', 'enabledByLevel'],
    },
    { title: 'Overrides', fields: ['overrides'] },
  ],
  fields: [
    {
      path: 'code',
      label: 'Policy code',
      help: 'Singleton policy key. Must be "DEFAULT".',
      hidden: 'edit',
    },
    {
      path: 'maxDepth',
      widget: 'integer',
      label: 'Maximum escalation levels',
      help: 'Maximum reporting-tree hops (1 to 5).',
      min: 1,
      max: 5,
    },
    {
      path: 'eligibleStatuses',
      widget: 'chip-array',
      label: 'Automatic escalation states',
      help: 'Workflow statuses evaluated by the escalation scheduler (e.g. PENDINGATLME).',
    },
    {
      path: 'defaultSlaPercentageByLevel',
      widget: 'json',
      label: 'Default SLA % by level',
      help: 'Cumulative percentages against complaint SLA hours (e.g. [80, 120, 200]).',
    },
    {
      path: 'defaultSlaByLevel',
      widget: 'json',
      label: 'Default SLA fallback (ms)',
      help: 'Cumulative millisecond fallbacks when percentages cannot be resolved.',
    },
    {
      path: 'enabledByLevel',
      widget: 'json',
      label: 'Auto-escalation enabled by level',
      help: 'Boolean flag per level controlling automatic triggering.',
    },
    {
      path: 'overrides',
      widget: 'json',
      label: 'Complaint-type overrides',
      help: 'Map of leaf serviceCode -> custom escalation ladder.',
    },
  ],
};
