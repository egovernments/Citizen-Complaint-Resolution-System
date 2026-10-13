import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.InboxVisibilityConfig`, the state-level switch for the employee inbox's
 * My / All tabs (one INBOX_VISIBILITY record). `enabled` is read by the inbox; `serverSide` and `reporteeDepth`
 * by pgr-services' visibility resolver. An unset flag reads as off, so the boxes show that without writing it.
 */
export const inboxVisibilityDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.InboxVisibilityConfig',
  groups: [
    { title: 'Inbox tabs', fields: ['code', 'enabled'] },
    { title: 'Server-side visibility', fields: ['serverSide', 'reporteeDepth', 'jurisdictionScoped', 'version'] },
  ],
  fields: [
    { path: 'code', widget: 'text', required: true, hidden: 'edit', pattern: '^INBOX_VISIBILITY$', label: 'Record key',
      help: 'Use INBOX_VISIBILITY: the record is a singleton per tenant.' },
    { path: 'enabled', widget: 'boolean', whenUnset: false, label: 'My / All tabs in the employee inbox',
      help: 'Off (or no record): the inbox shows its classic single list.' },
    { path: 'serverSide', widget: 'boolean', whenUnset: false, label: 'Resolve visibility on the server',
      help: 'The inbox asks pgr-services which complaints each tab holds. Needs PGR_VISIBILITY_ENABLED on the deployment.' },
    { path: 'reporteeDepth', widget: 'integer', min: 0, label: 'Reportee depth',
      help: 'How many levels of reportees the All tab includes (default 1).' },
    { path: 'jurisdictionScoped', widget: 'boolean', whenUnset: false, label: 'Also limit by jurisdiction' },
    { path: 'version', widget: 'text', pattern: '^v[1-3]$', label: 'Rule version', help: 'v1, v2 or v3.' },
  ],
};
