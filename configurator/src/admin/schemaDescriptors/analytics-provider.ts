import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.AnalyticsProvider` — one row per analytics or
 * error-tracking destination the citizen/employee SPA may initialise.
 *
 * The real screen is the dedicated editor (customEditor below): a destination
 * list needs inherited-vs-owned provenance, per-type field sets, and a
 * residency acknowledgement before a cloud destination can be switched on, none
 * of which the generic form can express. This descriptor still matters for two
 * reasons: it is where the labels and help text live (one source of truth, the
 * dedicated editor reads them from here), and it keeps the generic Edit form
 * usable as a fallback if the customEditor key ever fails to resolve.
 *
 * `settings` and `adapter` use the 'json' widget deliberately. The generic form
 * skips any non-null object value outright, so without an explicit json field
 * those two would be invisible AND unsaveable — and a stringified object round-
 * tripped through a plain text input would silently corrupt the record.
 *
 * `code` is hidden on edit: it IS the MDMS uniqueIdentifier and is immutable
 * after create. Descriptor-claimed fields bypass the generic form's
 * id-immutability guard, so listing it without `hidden` would render the
 * identity as an editable text box and let it drift from the uniqueIdentifier.
 */
export const analyticsProviderDescriptor: SchemaDescriptor = {
  schema: 'common-masters.AnalyticsProvider',
  customEditor: 'analytics-provider',
  groups: [
    { title: 'Identity', fields: ['code', 'type', 'enabled', 'order'] },
    {
      title: 'Destination',
      fields: ['siteId', 'scriptUrl', 'endpointUrl', 'measurementId', 'apiKey', 'dsn', 'globalName'],
    },
    {
      title: 'Behaviour',
      fields: ['surfaces', 'sampleRate', 'disablePageViews', 'trackClicks', 'trackErrors', 'scrubPatterns'],
    },
    { title: 'Advanced', fields: ['settings', 'adapter'] },
  ],
  fields: [
    {
      path: 'code',
      label: 'Code',
      help: 'Permanent identity of this destination. Also the MDMS uniqueIdentifier, so it cannot be changed after create.',
      hidden: 'edit',
    },
    {
      path: 'type',
      label: 'Provider',
      help: 'MATOMO | GA4 | POSTHOG | SENTRY | CUSTOM. The SPA has an adapter per type and ignores any type it does not recognise.',
    },
    {
      path: 'enabled',
      widget: 'boolean',
      label: 'Enabled',
      help: 'Off by default. While this is off the SPA does not load this destination at all.',
    },
    {
      path: 'order',
      widget: 'integer',
      label: 'Order',
      help: 'Optional display order. Does not affect which destinations run.',
    },
    { path: 'siteId', label: 'Matomo site ID', help: 'A string, so leading zeros survive.' },
    {
      path: 'scriptUrl',
      label: 'Script URL',
      help: 'https only. The host must be in the allowed script hosts; ops controls that list via ANALYTICS_SCRIPT_HOSTS and it cannot be widened from here.',
    },
    {
      path: 'endpointUrl',
      label: 'Endpoint URL',
      help: 'Matomo: the matomo.php collector. PostHog: the API host (defaults to https://us.i.posthog.com).',
    },
    { path: 'measurementId', label: 'GA4 measurement ID', help: 'G-XXXXXXX.' },
    { path: 'apiKey', label: 'PostHog project key', help: 'The write-only project key (phc_…), not a personal API key.' },
    { path: 'dsn', label: 'Sentry DSN', help: 'https://<publicKey>@<host>/<projectId>.' },
    {
      path: 'globalName',
      label: 'Global queue name',
      help: 'CUSTOM only. Must match /^_[A-Za-z0-9_]{1,40}$/ and must not shadow an application global.',
    },
    {
      path: 'surfaces',
      label: 'Surfaces',
      help: 'Comma separated: citizen, employee. Leave empty for both.',
    },
    {
      path: 'sampleRate',
      widget: 'number',
      label: 'Sample rate',
      help: '0 to 1. Empty or 1 sends every event.',
      min: 0,
      max: 1,
    },
    {
      path: 'disablePageViews',
      widget: 'boolean',
      label: 'Do not send page views',
      help: 'Negatively named on purpose: MDMS never applies schema defaults and the create form writes false for every boolean, so a positively named flag would be born off.',
    },
    { path: 'trackClicks', widget: 'boolean', label: 'Track tagged clicks', help: 'Only elements carrying data-analytics-event are ever reported.' },
    { path: 'trackErrors', widget: 'boolean', label: 'Report front-end errors' },
    {
      path: 'scrubPatterns',
      label: 'Extra scrub patterns',
      help: 'Comma separated regular expressions, ADDED to the built-in PII scrubbers. They can never replace or weaken them.',
    },
    {
      path: 'settings',
      widget: 'json',
      label: 'Settings',
      help: 'Open bucket for options that do not have a field yet. Also holds residencyAck for cloud destinations.',
    },
    {
      path: 'adapter',
      widget: 'json',
      label: 'Custom adapter',
      help: 'CUSTOM only: { scriptUrl, globalName, callTemplates: { init, pageView, event } }. Values are DATA — interpolated from a fixed placeholder list and never executed as code.',
    },
  ],
};
