import type { ToolMetadata, ToolGroup } from '../types/index.js';
import { ALL_GROUPS } from '../types/index.js';
import type { ToolRegistry } from './registry.js';

export function registerDiscoverTools(registry: ToolRegistry): void {
  registry.register({
    name: 'discover_tools',
    group: 'core',
    category: 'discovery',
    risk: 'read',
    description:
      'List all available CRS validator tools grouped by domain. Shows which groups are currently enabled and what tools each group contains. Use this to understand what capabilities are available before enabling additional groups.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const summary = registry.getSummary();
      return JSON.stringify(
        {
          success: true,
          message: `${summary.enabledTools} of ${summary.totalTools} tools enabled`,
          groups: summary.groups,
          usage:
            'Call enable_tools with group names to load more tools. Groups: mdms (tenant validation + MDMS CRUD + tenant bootstrap/cleanup), boundary (boundary hierarchy + boundary management), masters (departments, designations, complaint types), employees (HRMS employee create/update/validate), localization (UI labels), pgr (complaints + workflow), admin (filestore upload/download + access control + user search/create), idgen (ID generation), location (geographic boundaries), encryption (encrypt/decrypt data), docs (search DIGIT documentation + full OpenAPI 3.0 API catalog), monitoring (persister health, Kafka lag, DB counts, E2E parity), tracing (distributed trace search, debug API failures, find slow operations).',
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'enable_tools',
    group: 'core',
    category: 'discovery',
    risk: 'read',
    description:
      'Enable or disable tool groups on demand. Groups: mdms (tenant validation + MDMS search/create), boundary (boundary hierarchy + boundary management CRUD), masters (departments, designations, complaint types), employees (HRMS employee create/update/validate), localization (search/upsert UI labels), pgr (PGR complaints + workflow), admin (filestore upload/download + access control + user search/create), idgen (ID generation), location (geographic boundaries), encryption (encrypt/decrypt), docs (search DIGIT documentation at docs.digit.org + full OpenAPI 3.0 API catalog), monitoring (persister health, Kafka lag, DB counts, E2E parity), tracing (distributed trace search, debug API failures, find slow operations). The "core" group is always enabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        enable: {
          type: 'array',
          items: { type: 'string', enum: ALL_GROUPS },
          description: 'Groups to enable (e.g. ["mdms", "pgr"])',
        },
        disable: {
          type: 'array',
          items: { type: 'string', enum: ALL_GROUPS.filter((g) => g !== 'core') },
          description: 'Groups to disable (cannot disable "core")',
        },
      },
    },
    handler: async (args) => {
      const enable = (args.enable || []) as ToolGroup[];
      const disable = (args.disable || []) as ToolGroup[];

      const enableResult = enable.length > 0 ? registry.enableGroups(enable) : null;
      const disableResult = disable.length > 0 ? registry.disableGroups(disable) : null;

      const summary = registry.getSummary();

      return JSON.stringify(
        {
          success: true,
          enabled: enableResult,
          disabled: disableResult,
          activeGroups: registry.getEnabledGroups(),
          toolCount: `${summary.enabledTools} of ${summary.totalTools} tools now enabled`,
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);
}
