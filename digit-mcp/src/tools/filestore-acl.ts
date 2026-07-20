import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';

export function registerFilestoreAclTools(registry: ToolRegistry): void {
  // ──────────────────────────────────────────
  // Filestore tools
  // ──────────────────────────────────────────

  registry.register({
    name: 'filestore_get_urls',
    group: 'admin',
    category: 'filestore',
    risk: 'read',
    description:
      'Get download URLs for files stored in DIGIT filestore. Takes file store IDs (from tenant logos, employee documents, etc.) and returns signed URLs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID',
        },
        file_store_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'File store IDs to get URLs for',
        },
      },
      required: ['tenant_id', 'file_store_ids'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const files = await digitApi.filestoreGetUrl(
        args.tenant_id as string,
        args.file_store_ids as string[]
      );

      return JSON.stringify(
        {
          success: true,
          tenantId: args.tenant_id,
          count: files.length,
          files: files.map((f) => ({
            id: f.id,
            url: f.url,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'filestore_upload',
    group: 'admin',
    category: 'filestore',
    risk: 'write',
    description:
      'Upload a file to DIGIT filestore. Accepts base64-encoded file content, a filename, and a module name. ' +
      'Returns the fileStoreId which can be used with other tools (e.g. boundary_mgmt_process). ' +
      'Common modules: "PGR" for complaint attachments, "HRMS" for employee documents, "boundary" for boundary data files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID',
        },
        module: {
          type: 'string',
          description: 'Module name (e.g. "PGR", "HRMS", "boundary", "rainmaker-pgr")',
        },
        file_name: {
          type: 'string',
          description: 'File name with extension (e.g. "boundaries.xlsx", "photo.jpg")',
        },
        file_content_base64: {
          type: 'string',
          description: 'Base64-encoded file content',
        },
        content_type: {
          type: 'string',
          description: 'MIME type (e.g. "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/jpeg"). Default: "application/octet-stream"',
        },
      },
      required: ['tenant_id', 'module', 'file_name', 'file_content_base64'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const fileBuffer = Buffer.from(args.file_content_base64 as string, 'base64');
      const contentType = (args.content_type as string) || 'application/octet-stream';

      try {
        const files = await digitApi.filestoreUpload(
          args.tenant_id as string,
          args.module as string,
          fileBuffer,
          args.file_name as string,
          contentType
        );

        return JSON.stringify(
          {
            success: true,
            message: `File "${args.file_name}" uploaded`,
            count: files.length,
            files: files.map((f) => ({
              fileStoreId: f.fileStoreId,
              tenantId: f.tenantId,
            })),
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: msg,
          hint: 'File upload failed. Verify: (1) tenant_id is valid, (2) module name matches expected values, (3) file content is valid base64.',
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // Access Control tools
  // ──────────────────────────────────────────

  registry.register({
    name: 'access_roles_search',
    group: 'admin',
    category: 'access-control',
    risk: 'read',
    description:
      'Search all defined roles in the access control system. Returns role codes, names, and descriptions. Use this to verify role codes referenced in employee assignments or MDMS role configs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search roles for',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const roles = await digitApi.accessRolesSearch(args.tenant_id as string);

      return JSON.stringify(
        {
          success: true,
          tenantId: args.tenant_id,
          count: roles.length,
          roles: roles.map((r) => ({
            code: r.code,
            name: r.name,
            description: r.description,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'access_actions_search',
    group: 'admin',
    category: 'access-control',
    risk: 'read',
    description:
      'Search actions/permissions available to specific roles. Shows which API endpoints and UI actions each role can access. Useful for debugging permission issues.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID',
        },
        role_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Role codes to look up actions for (e.g. ["GRO", "PGR_LME"])',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      try {
        const actions = await digitApi.accessActionsSearch(
          args.tenant_id as string,
          args.role_codes as string[] | undefined
        );

        return JSON.stringify(
          {
            success: true,
            tenantId: args.tenant_id,
            roleCodes: args.role_codes || '(all)',
            count: actions.length,
            actions: actions.slice(0, 100).map((a) => ({
              url: a.url,
              displayName: a.displayName,
              serviceName: a.serviceName,
              enabled: a.enabled,
            })),
            truncated: actions.length > 100,
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: msg,
          hint: 'Access control actions search failed. The ACCESSCONTROL-ACTIONS MDMS data may not be seeded for this environment.',
        }, null, 2);
      }
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
