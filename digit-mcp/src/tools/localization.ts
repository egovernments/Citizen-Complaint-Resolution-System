import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import { validateTenantId, rejectControlChars } from '../utils/validation.js';
import { sanitizeUserContent } from '../utils/sanitize.js';
import { applyFieldMask } from '../utils/field-mask.js';

export function registerLocalizationTools(registry: ToolRegistry): void {
  registry.register({
    name: 'localization_search',
    group: 'localization',
    category: 'localization',
    risk: 'read',
    description:
      'Search localization messages for a tenant. Returns translated strings by locale and module. Useful for verifying that UI labels exist for departments, designations, complaint types, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search localization for',
        },
        locale: {
          type: 'string',
          description: 'Locale code (default: "en_IN")',
        },
        module: {
          type: 'string',
          description: 'Module filter (e.g. "rainmaker-pgr", "rainmaker-common")',
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: only return these fields per result. Available: code, message, module',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const locale = (args.locale as string) || 'en_IN';
      const module = args.module as string | undefined;

      const messages = await digitApi.localizationSearch(tenantId, locale, module);

      const fields = args.fields as string[] | undefined;
      const mapped = messages.map((m) => ({
        code: m.code,
        message: sanitizeUserContent(m.message as string),
        module: m.module,
      }));
      const { items: masked, truncated } = applyFieldMask(mapped, fields);

      return JSON.stringify(
        {
          success: true,
          tenantId,
          locale,
          module: module || '(all)',
          count: messages.length,
          messages: masked,
          truncated,
          ...(fields ? { fieldsApplied: fields } : {}),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'localization_upsert',
    group: 'localization',
    category: 'localization',
    risk: 'write',
    description:
      'Create or update localization messages for a tenant. Upserts translated strings — if a code already exists it is updated, otherwise created. Use for adding UI labels for new departments, complaint types, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID',
        },
        locale: {
          type: 'string',
          description: 'Locale code (default: "en_IN")',
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Localization key (e.g. "DEPT_HEALTH")' },
              message: { type: 'string', description: 'Translated text' },
              module: { type: 'string', description: 'Module name (e.g. "rainmaker-common")' },
            },
            required: ['code', 'message', 'module'],
          },
          description: 'Array of localization messages to upsert',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, validate inputs and check prerequisites without executing. Returns a preview of what would happen.',
        },
      },
      required: ['tenant_id', 'messages'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      const messages = args.messages as { code: string; message: string; module: string }[];
      for (const msg of messages) {
        rejectControlChars(msg.code, 'message.code');
        rejectControlChars(msg.message, 'message.message');
      }

      const tenantId = args.tenant_id as string;
      const locale = (args.locale as string) || 'en_IN';
      const dryRun = args.dry_run === true;

      if (dryRun) {
        const issues: string[] = [];

        if (!digitApi.isAuthenticated()) {
          issues.push('Not authenticated. Call "configure" first.');
        }

        return JSON.stringify({
          success: true,
          dry_run: true,
          valid: issues.length === 0,
          issues,
          preview: {
            tenantId,
            locale,
            messageCount: messages.length,
            messages: messages.slice(0, 5),
          },
        }, null, 2);
      }

      await ensureAuthenticated();

      const result = await digitApi.localizationUpsert(tenantId, locale, messages);

      return JSON.stringify(
        {
          success: true,
          tenantId,
          locale,
          upserted: result.length,
          messages: result.map((m) => ({
            code: m.code,
            message: m.message,
            module: m.module,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);
}

async function ensureAuthenticated(): Promise<void> {
  if (digitApi.isAuthenticated()) return;
  const username = process.env.CRS_USERNAME;
  const password = process.env.CRS_PASSWORD;
  const tenantId = process.env.CRS_TENANT_ID || digitApi.getEnvironmentInfo().stateTenantId;
  if (!username || !password) {
    throw new Error('Not authenticated. Call the "configure" tool first, or set CRS_USERNAME/CRS_PASSWORD env vars.');
  }
  await digitApi.login(username, password, tenantId);
}
