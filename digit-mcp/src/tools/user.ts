import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import { autoPaginate, PAGINATION_SCHEMA_PROPERTIES } from '../utils/pagination.js';
import type { PaginationOptions } from '../utils/pagination.js';
import { validateTenantId, validateMobileNumber, rejectControlChars, validateStringLength } from '../utils/validation.js';
import { sanitizeUserContent } from '../utils/sanitize.js';
import { applyFieldMask } from '../utils/field-mask.js';

export function registerUserTools(registry: ToolRegistry): void {
  registry.register({
    name: 'user_search',
    group: 'admin',
    category: 'user',
    risk: 'read',
    description:
      'Search DIGIT platform users by username, mobile number, UUID, role, or user type (CITIZEN/EMPLOYEE/SYSTEM). ' +
      'Returns user details including roles, active status, and tenant. ' +
      'Useful for verifying if a citizen or employee user exists before creating complaints or employees.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search users in',
        },
        user_name: {
          type: 'string',
          description: 'Filter by username',
        },
        mobile_number: {
          type: 'string',
          description: 'Filter by mobile number',
        },
        uuid: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by user UUIDs',
        },
        role_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by role codes (e.g. ["CITIZEN", "GRO"])',
        },
        user_type: {
          type: 'string',
          enum: ['CITIZEN', 'EMPLOYEE', 'SYSTEM'],
          description: 'Filter by user type',
        },
        limit: { type: 'number', description: 'Max results (default: 100)' },
        offset: { type: 'number', description: 'Offset for pagination (default: 0)' },
        ...PAGINATION_SCHEMA_PROPERTIES,
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: only return these fields per result. Available: id, uuid, userName, name, mobileNumber, emailId, type, active, tenantId, roles',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      try {
        const tenantId = args.tenant_id as string;
        const searchOpts = {
          userName: args.user_name as string | undefined,
          mobileNumber: args.mobile_number as string | undefined,
          uuid: args.uuid as string[] | undefined,
          roleCodes: args.role_codes as string[] | undefined,
          userType: args.user_type as string | undefined,
        };
        const pageOpts = args as PaginationOptions;

        let users: Record<string, unknown>[];
        let paginationMeta: Record<string, unknown> | undefined;

        if (pageOpts.page_all) {
          const result = await autoPaginate(
            (limit, offset) => digitApi.userSearch(tenantId, { ...searchOpts, limit, offset }),
            pageOpts,
            100,
          );
          users = result.items;
          paginationMeta = { totalFetched: result.totalFetched, pages: result.pages, truncated: result.truncated };
        } else {
          users = await digitApi.userSearch(tenantId, {
            ...searchOpts,
            limit: (args.limit as number) || 100,
            offset: (args.offset as number) || 0,
          });
        }

        const fields = args.fields as string[] | undefined;
        const mapped = users.map((u) => ({
          id: u.id,
          uuid: u.uuid,
          userName: u.userName,
          name: sanitizeUserContent(u.name as string),
          mobileNumber: u.mobileNumber,
          emailId: u.emailId,
          type: u.type,
          active: u.active,
          tenantId: u.tenantId,
          roles: ((u.roles || []) as Array<{ code: string; name?: string; tenantId?: string }>).map((r) => ({
            code: r.code,
            name: r.name,
            tenantId: r.tenantId,
          })),
        }));
        const { items: masked, truncated } = applyFieldMask(mapped, fields);

        return JSON.stringify(
          {
            success: true,
            tenantId: args.tenant_id,
            count: users.length,
            ...(paginationMeta ? { pagination: paginationMeta } : {}),
            users: masked,
            truncated,
            ...(fields ? { fieldsApplied: fields } : {}),
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: msg,
          hint: 'User search failed. Some filter combinations (e.g. user_type) may not be supported by all DIGIT environments.',
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'user_create',
    group: 'admin',
    category: 'user',
    risk: 'write',
    description:
      'Create a new user in the DIGIT platform. Creates users without OTP validation (admin operation). ' +
      'Use this to create CITIZEN users for PGR complaints or EMPLOYEE users for HRMS. ' +
      'For creating employees with department/designation/jurisdiction, use employee_create instead — it creates the user automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for the user',
        },
        name: {
          type: 'string',
          description: 'Full name of the user',
        },
        mobile_number: {
          type: 'string',
          description: 'Mobile number (10 digits, used as username for CITIZEN)',
        },
        user_type: {
          type: 'string',
          enum: ['CITIZEN', 'EMPLOYEE'],
          description: 'User type (default: CITIZEN)',
        },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Role code' },
              name: { type: 'string', description: 'Role name' },
            },
            required: ['code', 'name'],
          },
          description: 'Roles to assign. For CITIZEN users, CITIZEN role is auto-added.',
        },
        email: {
          type: 'string',
          description: 'Optional email address',
        },
        gender: {
          type: 'string',
          enum: ['MALE', 'FEMALE', 'TRANSGENDER'],
          description: 'Optional gender',
        },
        username: {
          type: 'string',
          description: 'Username (defaults to mobile_number for CITIZEN, required for EMPLOYEE)',
        },
        password: {
          type: 'string',
          description: 'Password for the user (default: "eGov@123")',
        },
      },
      required: ['tenant_id', 'name', 'mobile_number'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateMobileNumber(args.mobile_number, 'mobile_number');
      rejectControlChars(args.name as string, 'name');
      validateStringLength(args.name as string, 200, 'name');

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const userType = (args.user_type as string) || 'CITIZEN';
      const mobileNumber = args.mobile_number as string;

      // Derive role tenant from the target tenant's root (not env.stateTenantId)
      // e.g. "tenant.city1" → "tenant", "pg.citya" → "pg", "pg" → "pg"
      const roleTenant = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

      const roles = ((args.roles as Array<{ code: string; name: string }>) || []).map((r) => ({
        code: r.code,
        name: r.name,
        tenantId: roleTenant,
      }));

      // Ensure appropriate default role
      if (userType === 'CITIZEN' && !roles.some((r) => r.code === 'CITIZEN')) {
        roles.push({ code: 'CITIZEN', name: 'Citizen', tenantId: roleTenant });
      }

      const user: Record<string, unknown> = {
        name: args.name as string,
        mobileNumber,
        userName: (args.username as string) || mobileNumber,
        password: (args.password as string) || 'eGov@123',
        type: userType,
        active: true,
        emailId: (args.email as string) || null,
        gender: (args.gender as string) || null,
        roles,
        tenantId: roleTenant,
      };

      try {
        const created = await digitApi.userCreate(user, tenantId);

        return JSON.stringify(
          {
            success: true,
            message: `User created: ${created.userName || 'unknown'}`,
            user: {
              id: created.id,
              uuid: created.uuid,
              userName: created.userName,
              name: created.name,
              mobileNumber: created.mobileNumber,
              type: created.type,
              active: created.active,
              tenantId: created.tenantId,
              roles: ((created.roles || []) as Array<{ code: string }>).map((r) => r.code),
            },
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isDuplicate = msg.includes('already exists') || msg.includes('duplicate') || msg.includes('already registered');
        return JSON.stringify({
          success: false,
          error: msg,
          hint: isDuplicate
            ? 'A user with this mobile number/username may already exist. Use user_search to find existing users.'
            : 'User creation failed. Verify the tenant_id and role codes are valid.',
          alternatives: [
            { tool: 'user_search', purpose: 'Search existing users by mobile/name' },
            { tool: 'access_roles_search', purpose: 'List valid role codes' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'user_role_add',
    group: 'admin',
    category: 'user',
    risk: 'write',
    description:
      'Add roles to an existing user for a specific tenant. CRITICAL for cross-tenant operations: ' +
      'DIGIT checks that user roles are tagged to the target tenant root. If a user authenticated on "pg" ' +
      'tries to create PGR complaints on "tenant.coimbatore", they need roles tagged to "tenant". ' +
      'This tool fetches the user, adds the missing roles for the target tenant, and updates the user record. ' +
      'Use this when pgr_create or pgr_update fails with "User is not authorized" due to cross-tenant role mismatch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Target tenant ID (will be resolved to root, e.g. "tenant.live" → "tenant")',
        },
        username: {
          type: 'string',
          description: 'Username of the user to update (default: current logged-in user)',
        },
        role_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Role codes to add (default: ["CITIZEN","EMPLOYEE","CSR","GRO","PGR_LME","DGRO","SUPERUSER"] — standard PGR roles)',
        },
        city_level: {
          type: 'boolean',
          description: 'If true, tag roles to the exact tenant ID passed (e.g. "mz.chimoio") instead of auto-resolving to the state root ("mz"). Use this when roles need to be scoped to a specific city tenant.',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const targetTenant = args.tenant_id as string;
      const cityLevel = args.city_level === true;
      const rootTenant = cityLevel ? targetTenant : (targetTenant.includes('.') ? targetTenant.split('.')[0] : targetTenant);

      // Determine which user to update
      const authInfo = digitApi.getAuthInfo();
      const username = (args.username as string) || authInfo.user?.userName;
      if (!username) {
        return JSON.stringify({ success: false, error: 'No username specified and no user is logged in.' });
      }

      // Roles to add
      const defaultRoles = ['CITIZEN', 'EMPLOYEE', 'CSR', 'GRO', 'PGR_LME', 'DGRO', 'SUPERUSER'];
      const roleCodes = (args.role_codes as string[]) || defaultRoles;

      try {
        // Search for the user to get their full record
        const searchTenant = authInfo.user?.tenantId || digitApi.getEnvironmentInfo().stateTenantId;
        const users = await digitApi.userSearch(searchTenant, { userName: username, limit: 1 });
        if (users.length === 0) {
          return JSON.stringify({ success: false, error: `User "${username}" not found on tenant "${searchTenant}".` });
        }

        const user = users[0];
        const existingRoles = (user.roles || []) as Array<{ code: string; name: string; tenantId: string }>;

        // Find which roles are missing for the target root tenant
        const existingForTarget = new Set(
          existingRoles.filter((r) => r.tenantId === rootTenant).map((r) => r.code)
        );
        const newRoles = roleCodes
          .filter((code) => !existingForTarget.has(code))
          .map((code) => ({ code, name: code, tenantId: rootTenant }));

        if (newRoles.length === 0) {
          return JSON.stringify({
            success: true,
            message: `User "${username}" already has all requested roles on "${rootTenant}".`,
            existingRoles: existingRoles.filter((r) => r.tenantId === rootTenant).map((r) => r.code),
          }, null, 2);
        }

        // Update user with combined roles
        const updatedUser = await digitApi.userUpdate({
          ...user,
          roles: [...existingRoles, ...newRoles],
        });

        const addedCodes = newRoles.map((r) => r.code);
        return JSON.stringify({
          success: true,
          message: `Added ${addedCodes.length} roles for "${rootTenant}" to user "${username}": ${addedCodes.join(', ')}`,
          user: username,
          targetTenant: rootTenant,
          rolesAdded: addedCodes,
          hint: 'Roles added. You may need to call configure again to refresh the auth token with the new roles.',
        }, null, 2);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: msg,
          hint: 'Failed to update user roles. Verify the user exists and the tenant is valid.',
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
