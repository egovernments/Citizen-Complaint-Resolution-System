import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import { autoPaginate, PAGINATION_SCHEMA_PROPERTIES } from '../utils/pagination.js';
import type { PaginationOptions } from '../utils/pagination.js';
import { validateTenantId, validateMobileNumber, rejectControlChars, validateStringLength, validateResourceId } from '../utils/validation.js';
import { sanitizeUserContent } from '../utils/sanitize.js';
import { applyFieldMask } from '../utils/field-mask.js';

export function registerPgrWorkflowTools(registry: ToolRegistry): void {
  // ──────────────────────────────────────────
  // PGR tools
  // ──────────────────────────────────────────

  registry.register({
    name: 'pgr_search',
    group: 'pgr',
    category: 'pgr',
    risk: 'read',
    description:
      'Search PGR complaints/service requests for a tenant. Can filter by service request ID or status. Returns complaint details including service code, description, status, and workflow state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search complaints in',
        },
        service_request_id: {
          type: 'string',
          description: 'Specific service request ID to look up',
        },
        status: {
          type: 'string',
          enum: ['PENDINGFORASSIGNMENT', 'PENDINGATLME', 'PENDINGFORREASSIGNMENT', 'RESOLVED', 'REJECTED', 'CLOSEDAFTERRESOLUTION'],
          description: 'Filter by complaint status',
        },
        limit: { type: 'number', description: 'Max results (default: 50)' },
        offset: { type: 'number', description: 'Offset for pagination (default: 0)' },
        ...PAGINATION_SCHEMA_PROPERTIES,
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: only return these fields per result. Available: serviceRequestId, serviceCode, description, status, priority, rating, citizen, address, workflow, createdTime, lastModifiedTime',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const searchOpts = {
        serviceRequestId: args.service_request_id as string | undefined,
        status: args.status as string | undefined,
      };
      const pageOpts = args as PaginationOptions;

      let complaints: Record<string, unknown>[];
      let paginationMeta: Record<string, unknown> | undefined;

      if (pageOpts.page_all) {
        const result = await autoPaginate(
          (limit, offset) => digitApi.pgrSearch(tenantId, { ...searchOpts, limit, offset }),
          pageOpts,
          50,
        );
        complaints = result.items;
        paginationMeta = { totalFetched: result.totalFetched, pages: result.pages, truncated: result.truncated };
      } else {
        complaints = await digitApi.pgrSearch(tenantId, {
          ...searchOpts,
          limit: (args.limit as number) || 50,
          offset: (args.offset as number) || 0,
        });
      }

      const mapped = complaints.map((sw) => {
        const svc = sw.service as Record<string, unknown> | undefined;
        const wf = sw.workflow as Record<string, unknown> | undefined;
        const citizen = svc?.citizen as Record<string, unknown> | undefined;
        const address = svc?.address as Record<string, unknown> | undefined;
        const audit = svc?.auditDetails as Record<string, unknown> | undefined;
        return {
          serviceRequestId: svc?.serviceRequestId,
          serviceCode: svc?.serviceCode,
          description: sanitizeUserContent(svc?.description as string),
          status: svc?.applicationStatus,
          priority: svc?.priority,
          rating: svc?.rating,
          citizen: citizen ? {
            name: sanitizeUserContent(citizen.name as string),
            mobileNumber: citizen.mobileNumber,
            uuid: citizen.uuid,
          } : null,
          address: address ? {
            locality: address.locality,
            city: address.city,
            district: address.district,
          } : null,
          workflow: wf ? {
            action: wf.action,
            state: wf.state,
            assignes: wf.assignes,
            comment: wf.comments,
          } : null,
          createdTime: audit?.createdTime,
          lastModifiedTime: audit?.lastModifiedTime,
        };
      });

      const fields = args.fields as string[] | undefined;
      const { items: masked, truncated } = applyFieldMask(mapped, fields);

      return JSON.stringify({
        success: true,
        tenantId,
        count: complaints.length,
        ...(paginationMeta ? { pagination: paginationMeta } : {}),
        complaints: masked,
        truncated,
        ...(fields ? { fieldsApplied: fields } : {}),
      }, null, 2);
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'pgr_create',
    group: 'pgr',
    category: 'pgr',
    risk: 'write',
    description:
      'Create a new PGR complaint/service request. Requires tenant ID, a valid service code (from validate_complaint_types), description, address with boundary locality code, and citizen info (name + mobile number of the person filing the complaint). ' +
      'The logged-in user does NOT need to be a citizen — any user with EMPLOYEE, CITIZEN, or CSR role can create complaints. ' +
      'The ADMIN user already has EMPLOYEE role and can create complaints for any tenant. Pass citizen details via citizen_name/citizen_mobile. ' +
      'You do NOT need to re-authenticate as a different user to create complaints.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID (e.g. "pg.citya")',
        },
        service_code: {
          type: 'string',
          description: 'Service code for the complaint type (e.g. "StreetLightNotWorking"). Use validate_complaint_types to list valid codes.',
        },
        description: {
          type: 'string',
          description: 'Description of the complaint',
        },
        address: {
          type: 'object',
          properties: {
            locality: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Locality boundary code (use validate_boundary to find codes)' },
              },
              required: ['code'],
            },
            city: { type: 'string', description: 'City name' },
          },
          required: ['locality'],
          description: 'Address with locality boundary code',
        },
        citizen_name: {
          type: 'string',
          description: 'Name of the citizen filing the complaint (required)',
        },
        citizen_mobile: {
          type: 'string',
          description: 'Mobile number of the citizen (required; tenant UserValidation enforces the pattern)',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, validate inputs and check prerequisites without executing. Returns a preview of what would happen.',
        },
      },
      required: ['tenant_id', 'service_code', 'description', 'address', 'citizen_name', 'citizen_mobile'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateMobileNumber(args.citizen_mobile, 'citizen_mobile');
      rejectControlChars(args.description as string, 'description');
      validateStringLength(args.description as string, 2000, 'description');
      rejectControlChars(args.citizen_name as string, 'citizen_name');
      validateStringLength(args.citizen_name as string, 200, 'citizen_name');
      validateResourceId(args.service_code as string, 'service_code');

      const tenantId = args.tenant_id as string;
      const serviceCode = args.service_code as string;
      const description = args.description as string;
      const citizenName = args.citizen_name as string;
      const citizenMobile = args.citizen_mobile as string;
      const address = args.address as Record<string, unknown>;
      const dryRun = args.dry_run === true;

      if (dryRun) {
        const issues: string[] = [];

        // Check auth
        if (!digitApi.isAuthenticated()) {
          issues.push('Not authenticated. Call "configure" first.');
        }

        // Check complaint type exists
        if (digitApi.isAuthenticated()) {
          try {
            const stateRoot = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
            const types = await digitApi.mdmsV2Search(stateRoot, 'RAINMAKER-PGR.ServiceDefs');
            const codes = types.map((t) => (t.data as Record<string, unknown>)?.serviceCode);
            if (!codes.includes(serviceCode)) {
              issues.push(`Service code "${serviceCode}" not found. Available: ${codes.slice(0, 10).join(', ')}`);
            }
          } catch { /* skip if can't check */ }
        }

        return JSON.stringify({
          success: true,
          dry_run: true,
          valid: issues.length === 0,
          issues,
          preview: {
            tenantId,
            serviceCode,
            description: description.slice(0, 100),
            citizen: { name: citizenName, mobile: citizenMobile },
            address,
          },
        }, null, 2);
      }

      await ensureAuthenticated();

      const env = digitApi.getEnvironmentInfo();
      const rootTenant = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

      // Pre-create the citizen user via _createnovalidate so they get password-based auth.
      // PGR auto-creates citizens with OTP-only auth — those users can't login with a password.
      // By creating the user first, PGR finds the existing user instead of creating a new one.
      let citizenCredentials: { username: string; password: string; loginTenantId: string } | null = null;
      let citizenUser: Record<string, unknown> | null = null;
      try {
        // Check if citizen already exists
        const existing = await digitApi.userSearch(rootTenant, { mobileNumber: citizenMobile, limit: 1 });
        if (existing.length > 0) {
          citizenUser = existing[0];
          // Reset password in case it was created by PGR previously (OTP-only)
          try { await digitApi.userUpdate({ ...citizenUser, password: 'eGov@123' }); } catch (pwErr) { console.error(`[pgr_create] Citizen password reset failed: ${pwErr instanceof Error ? pwErr.message : String(pwErr)}`); }
        } else {
          // Create new citizen with password auth.
          // IMPORTANT: Use type EMPLOYEE (not CITIZEN) because DIGIT's OAuth only supports
          // password auth for EMPLOYEE-type users. CITIZEN-type uses OTP only.
          // The CITIZEN *role* is what PGR checks for RATE/REOPEN permissions.
          citizenUser = await digitApi.userCreate({
            name: citizenName,
            mobileNumber: citizenMobile,
            userName: citizenMobile,
            password: 'eGov@123',
            type: 'EMPLOYEE',
            active: true,
            roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: rootTenant }],
            tenantId: rootTenant,
          }, rootTenant);
        }
        citizenCredentials = {
          username: citizenMobile,
          password: 'eGov@123',
          loginTenantId: rootTenant,
        };
      } catch (citizenErr) {
        // Non-fatal: PGR will auto-create the citizen (but without password auth)
        console.error(`[pgr_create] Citizen pre-creation failed: ${citizenErr instanceof Error ? citizenErr.message : String(citizenErr)}`);
      }

      const citizen = {
        mobileNumber: citizenMobile,
        name: citizenName,
        type: 'CITIZEN',
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: rootTenant }],
        tenantId: rootTenant,
        ...(citizenUser?.uuid ? { uuid: citizenUser.uuid } : {}),
      };

      try {
        const result = await digitApi.pgrCreate(
          tenantId,
          args.service_code as string,
          args.description as string,
          args.address as Record<string, unknown>,
          citizen
        );

        const svc = (result.service || {}) as Record<string, unknown>;

        return JSON.stringify(
          {
            success: true,
            message: `Complaint created: ${svc.serviceRequestId || 'unknown'}`,
            complaint: {
              serviceRequestId: svc.serviceRequestId,
              serviceCode: svc.serviceCode,
              status: svc.applicationStatus,
              tenantId: svc.tenantId,
            },
            citizenLogin: citizenCredentials
              ? {
                  ...citizenCredentials,
                  note: 'Use these credentials with configure to authenticate as the citizen for RATE or REOPEN actions.',
                }
              : undefined,
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isAuthError = msg.includes('role') || msg.includes('authorized') || msg.includes('permission') || msg.includes('CITIZEN') || msg.includes('CSR');
        const isWorkflowError = msg.includes('BusinessService') || msg.includes('business service') || msg.includes('workflow') || msg.includes('INVALID_BUSINESSSERVICE');

        const targetRoot = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
        const authInfo = digitApi.getAuthInfo();
        const userTenantRoot = authInfo.user?.tenantId || '';

        let hint: string;
        const alternatives: { tool: string; purpose: string }[] = [];
        if (isWorkflowError) {
          hint = `PGR workflow is not registered for tenant "${tenantId}". ` +
            `FIX: Call workflow_create with tenant_id="${tenantId}" and copy_from_tenant="pg.citya" to register the PGR state machine. Then retry pgr_create.`;
          alternatives.push({ tool: 'workflow_create', purpose: `Register PGR workflow for ${tenantId}` });
        } else if (isAuthError) {
          const isCrossTenant = userTenantRoot !== targetRoot;
          if (isCrossTenant) {
            hint = `CROSS-TENANT ROLE MISMATCH: Your user "${authInfo.user?.userName}" is authenticated on "${userTenantRoot}" ` +
              `but the complaint targets "${tenantId}" (root: "${targetRoot}"). ` +
              `DIGIT's OAuth token only includes roles for the user's home tenant hierarchy. ` +
              `FIX: Create an employee on the target tenant using employee_create (with PGR roles like GRO, PGR_LME, DGRO), ` +
              `then call configure with the employee's code (returned in loginCredentials) as username, ` +
              `password "eGov@123", and tenant_id="${targetRoot}". Then retry pgr_create.`;
            alternatives.push(
              { tool: 'employee_create', purpose: `Create employee on ${tenantId} with PGR roles (GRO, PGR_LME, DGRO)` },
              { tool: 'configure', purpose: `Re-authenticate as the new employee with tenant_id="${targetRoot}"` },
            );
          } else {
            hint = 'The logged-in user may lack the required role. PGR complaint creation requires CITIZEN, CSR, or EMPLOYEE role for the APPLY action. ' +
              'Call user_role_add to add missing roles for this tenant, then re-authenticate with configure.';
            alternatives.push(
              { tool: 'user_role_add', purpose: 'Add missing PGR roles for this tenant' },
              { tool: 'configure', purpose: 'Re-authenticate to pick up new roles' },
            );
          }
        } else {
          hint = `Complaint creation failed. Check these in order: ` +
            `(1) Call workflow_business_services with tenant_id="${tenantId}" — if 0 results, call workflow_create with copy_from_tenant="pg.citya" first. ` +
            `(2) Verify service_code is valid (use validate_complaint_types). ` +
            `(3) Verify locality code exists (use validate_boundary). ` +
            `(4) Ensure tenant_id is city-level (e.g. "pg.citya", not "pg").`;
          alternatives.push(
            { tool: 'workflow_create', purpose: 'Register PGR workflow for this tenant' },
            { tool: 'workflow_business_services', purpose: 'Check if PGR workflow exists' },
            { tool: 'validate_complaint_types', purpose: 'List valid service codes' },
            { tool: 'validate_boundary', purpose: 'Find valid locality boundary codes' },
          );
        }

        return JSON.stringify({
          success: false,
          error: msg,
          hint,
          alternatives,
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'pgr_update',
    group: 'pgr',
    category: 'pgr',
    risk: 'write',
    description:
      'Update a PGR complaint via workflow action. Automatically fetches the complaint, then applies the action. ' +
      'Actions: ASSIGN (GRO assigns to LME employee), REASSIGN, RESOLVE (LME marks resolved), REJECT (GRO rejects), ' +
      'REOPEN (citizen reopens), RATE (citizen rates and closes). ' +
      'For ASSIGN/REASSIGN: use validate_employees to find employee UUIDs for the assignee.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID',
        },
        service_request_id: {
          type: 'string',
          description: 'Service request ID to update',
        },
        action: {
          type: 'string',
          enum: ['ASSIGN', 'REASSIGN', 'RESOLVE', 'REJECT', 'REOPEN', 'RATE'],
          description: 'Workflow action to perform. ASSIGN: GRO assigns to LME. RESOLVE: LME resolves. REJECT: GRO rejects. REOPEN: citizen reopens. RATE: citizen rates and closes.',
        },
        assignees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Employee UUIDs to assign the complaint to (optional for ASSIGN/REASSIGN). If omitted, PGR auto-routes based on department/locality configuration.',
        },
        comment: {
          type: 'string',
          description: 'Comment for the action (recommended for all actions)',
        },
        rating: {
          type: 'number',
          description: 'Citizen satisfaction rating (1-5). Used with RATE action.',
        },
      },
      required: ['tenant_id', 'service_request_id', 'action'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateResourceId(args.service_request_id, 'service_request_id');
      if (args.comment) rejectControlChars(args.comment, 'comment');

      await ensureAuthenticated();

      const action = args.action as string;

      // Warn (but allow) ASSIGN/REASSIGN without assignees — PGR auto-routes
      const assigneeWarning = (action === 'ASSIGN' || action === 'REASSIGN') && !(args.assignees as string[] | undefined)?.length
        ? 'No assignees specified — PGR will auto-route. Pass employee UUIDs in assignees for explicit assignment.'
        : undefined;

      // Fetch the current complaint
      const complaints = await digitApi.pgrSearch(args.tenant_id as string, {
        serviceRequestId: args.service_request_id as string,
      });

      if (complaints.length === 0) {
        return JSON.stringify(
          { success: false, error: `Complaint "${args.service_request_id}" not found in tenant "${args.tenant_id}"` },
          null,
          2
        );
      }

      // Extract the service object from the ServiceWrapper
      const serviceWrapper = complaints[0];
      const service = serviceWrapper.service as Record<string, unknown>;

      if (!service) {
        return JSON.stringify(
          { success: false, error: 'Fetched complaint has no service object. The complaint data may be corrupted.' },
          null,
          2
        );
      }

      try {
        const result = await digitApi.pgrUpdate(
          service,
          action,
          {
            comment: args.comment as string | undefined,
            assignees: args.assignees as string[] | undefined,
            rating: args.rating as number | undefined,
          }
        );

        const svc = (result.service || {}) as Record<string, unknown>;
        const wf = (result.workflow || {}) as Record<string, unknown>;

        return JSON.stringify(
          {
            success: true,
            message: `Complaint ${args.service_request_id} updated: ${action}`,
            warning: assigneeWarning,
            complaint: {
              serviceRequestId: svc.serviceRequestId,
              previousStatus: service.applicationStatus,
              newStatus: svc.applicationStatus,
              workflowState: wf.state,
              rating: svc.rating,
            },
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isRoleError = msg.includes('role') || msg.includes('authorized') || msg.includes('permission');
        const isStateError = msg.includes('state') || msg.includes('transition') || msg.includes('action');
        const isWorkflowMissing = msg.includes('BusinessService') || msg.includes('business service') || msg.includes('INVALID_BUSINESSSERVICE');

        const targetRoot = (args.tenant_id as string).includes('.') ? (args.tenant_id as string).split('.')[0] : args.tenant_id as string;
        const authInfo = digitApi.getAuthInfo();
        const userTenantRoot = authInfo.user?.tenantId || '';
        const isCrossTenant = userTenantRoot !== targetRoot;
        const isCitizenAction = action === 'RATE' || action === 'REOPEN';

        let hint: string;
        if (isWorkflowMissing) {
          hint = `PGR workflow is not registered for tenant "${args.tenant_id}". ` +
            `FIX: Call workflow_create with tenant_id="${args.tenant_id}" and copy_from_tenant="pg.citya" to register the PGR state machine. Then retry.`;
        } else if (isRoleError && isCitizenAction) {
          hint = `${action} requires CITIZEN role tagged to "${targetRoot}". ` +
            (isCrossTenant
              ? `Your user "${authInfo.user?.userName}" is on "${userTenantRoot}" — CITIZEN role doesn't cover "${targetRoot}". `
              : '') +
            `FIX: The citizen who filed the complaint has login credentials (returned by pgr_create in the citizenLogin field). ` +
            `Call configure with the citizen's username (their mobile number) and password "eGov@123" and tenant_id="${targetRoot}". ` +
            `Then retry pgr_update with action="${action}".`;
        } else if (isRoleError && isCrossTenant) {
          hint = `CROSS-TENANT ROLE MISMATCH: User "${authInfo.user?.userName}" is on "${userTenantRoot}" but complaint is on "${targetRoot}". ` +
            `FIX: Call configure with an employee who has roles on "${targetRoot}" (use employee_create if needed). Then retry.`;
        } else if (isRoleError) {
          hint = `The authenticated user may lack the required role for action "${action}". ` +
            'PGR workflow roles: GRO can ASSIGN/REASSIGN/REJECT, PGR_LME can RESOLVE, CITIZEN can REOPEN/RATE. ' +
            'Use workflow_business_services to check role requirements.';
        } else if (isStateError) {
          hint = `Action "${action}" may not be valid for the complaint's current status "${service.applicationStatus}". ` +
            'Use workflow_business_services to see the valid transitions from the current state.';
        } else {
          hint = 'PGR update failed. Use pgr_search to verify the complaint exists, and workflow_business_services to check valid actions.';
        }

        return JSON.stringify({
          success: false,
          error: msg,
          currentStatus: service.applicationStatus,
          attemptedAction: action,
          hint,
          alternatives: [
            { tool: 'workflow_create', purpose: 'Register PGR workflow if missing' },
            { tool: 'pgr_search', purpose: 'Verify complaint current status' },
            { tool: 'workflow_business_services', purpose: 'Check valid workflow transitions and role requirements' },
            { tool: 'validate_employees', purpose: 'Find employees with correct PGR roles' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // Workflow tools
  // ──────────────────────────────────────────

  registry.register({
    name: 'workflow_business_services',
    group: 'pgr',
    category: 'workflow',
    risk: 'read',
    description:
      'Search workflow business service configurations for a tenant. Shows the state machine definition for services like PGR, including states, actions, and SLA. Useful for understanding what workflow actions are available.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID',
        },
        business_services: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by business service codes (e.g. ["PGR"]). Omit to list all.',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const services = await digitApi.workflowBusinessServiceSearch(
        args.tenant_id as string,
        args.business_services as string[] | undefined
      );

      const tenantId = args.tenant_id as string;
      const requestedCodes = args.business_services as string[] | undefined;

      if (services.length === 0) {
        // The workflow API returns empty when no filter is specified — suggest filtering by PGR
        const noFilterUsed = !requestedCodes?.length;
        let hint: string;
        if (noFilterUsed) {
          hint = `The workflow API requires explicit business service codes — it returns empty without a filter. ` +
            `Retry with business_services=["PGR"] to check if PGR is registered. ` +
            `If PGR is not found, call workflow_create with tenant_id="${tenantId}" and copy_from_tenant set to a tenant that has PGR (e.g. the state root like "pg").`;
        } else {
          hint = `No workflow business services found for "${tenantId}" matching ${JSON.stringify(requestedCodes)}. ` +
            `FIX: Call workflow_create with tenant_id="${tenantId}" and copy_from_tenant set to a tenant that has the PGR workflow (e.g. "pg"). ` +
            `This registers the PGR state machine (states, actions, SLA, roles) so complaints can be created and processed.`;
        }

        return JSON.stringify(
          {
            success: true,
            tenantId,
            count: 0,
            businessServices: [],
            hint,
          },
          null,
          2
        );
      }

      return JSON.stringify(
        {
          success: true,
          tenantId,
          count: services.length,
          businessServices: services.map((bs) => ({
            businessService: bs.businessService,
            business: bs.business,
            businessServiceSla: bs.businessServiceSla,
            states: ((bs.states || []) as Record<string, unknown>[]).map((s) => ({
              state: s.state,
              applicationStatus: s.applicationStatus,
              isStartState: s.isStartState,
              isTerminateState: s.isTerminateState,
              actions: ((s.actions || []) as Record<string, unknown>[]).map((a) => ({
                action: a.action,
                nextState: a.nextState,
                roles: a.roles,
              })),
            })),
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'workflow_process_search',
    group: 'pgr',
    category: 'workflow',
    risk: 'read',
    description:
      'Search workflow process instances for specific business IDs (e.g. PGR complaint numbers). Shows the audit trail of workflow transitions for a complaint or other entity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID',
        },
        business_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Business IDs to look up (e.g. PGR service request IDs)',
        },
        limit: { type: 'number', description: 'Max results (default: 50)' },
        offset: { type: 'number', description: 'Offset (default: 0)' },
        ...PAGINATION_SCHEMA_PROPERTIES,
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const businessIds = args.business_ids as string[] | undefined;
      const pageOpts = args as PaginationOptions;

      let processes: Record<string, unknown>[];
      let paginationMeta: Record<string, unknown> | undefined;

      if (pageOpts.page_all) {
        const result = await autoPaginate(
          (limit, offset) => digitApi.workflowProcessSearch(tenantId, businessIds, { limit, offset }),
          pageOpts,
          50,
        );
        processes = result.items;
        paginationMeta = { totalFetched: result.totalFetched, pages: result.pages, truncated: result.truncated };
      } else {
        processes = await digitApi.workflowProcessSearch(tenantId, businessIds, {
          limit: (args.limit as number) || 50,
          offset: (args.offset as number) || 0,
        });
      }

      return JSON.stringify(
        {
          success: true,
          tenantId: args.tenant_id,
          count: processes.length,
          ...(paginationMeta ? { pagination: paginationMeta } : {}),
          processInstances: processes.map((p) => ({
            id: p.id,
            businessId: p.businessId,
            businessService: p.businessService,
            state: (p.state as Record<string, unknown>)?.state,
            action: p.action,
            assignee: p.assignee,
            comment: p.comment,
            createdTime: (p.auditDetails as Record<string, unknown>)?.createdTime,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // Workflow create tool
  // ──────────────────────────────────────────

  registry.register({
    name: 'workflow_create',
    group: 'pgr',
    category: 'workflow',
    risk: 'write',
    description:
      'Create a workflow business service definition for a tenant. This registers the state machine (states, actions, transitions, roles, SLA) ' +
      'that drives services like PGR. REQUIRED before pgr_create will work on a new tenant. ' +
      'Use copy_from_tenant to clone an existing workflow definition (e.g. from "pg") rather than building from scratch. ' +
      'The workflow service stores definitions at the STATE ROOT level (e.g. "pg", "tenant") — city-level tenants inherit automatically. ' +
      'If you pass a city-level tenant (e.g. "tenant.stage3"), it is auto-resolved to the root ("tenant").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID (e.g. "tenant.stage3" or "tenant"). Auto-resolved to state root for storage.',
        },
        copy_from_tenant: {
          type: 'string',
          description: 'Copy workflow definitions from this tenant (e.g. "pg"). Copies ALL known business services found. ' +
            'This is the recommended approach — avoids manually specifying states/actions/roles.',
        },
        business_service: {
          type: 'string',
          description: 'Business service code (e.g. "PGR"). Only needed if not using copy_from_tenant.',
        },
        business: {
          type: 'string',
          description: 'Business module name (e.g. "pgr-services"). Only needed if not using copy_from_tenant.',
        },
        business_service_sla: {
          type: 'number',
          description: 'SLA in milliseconds (e.g. 259200000 for 3 days). Only needed if not using copy_from_tenant.',
        },
        states: {
          type: 'array',
          description: 'State machine definition — array of state objects. Each state has: state, applicationStatus, isStartState, isTerminateState, actions[]. ' +
            'Only needed if not using copy_from_tenant.',
          items: {
            type: 'object',
            properties: {
              state: { type: 'string' },
              applicationStatus: { type: 'string' },
              isStartState: { type: 'boolean' },
              isTerminateState: { type: 'boolean' },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    action: { type: 'string' },
                    nextState: { type: 'string' },
                    roles: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      if (args.copy_from_tenant) validateTenantId(args.copy_from_tenant, 'copy_from_tenant');

      await ensureAuthenticated();

      const inputTenantId = args.tenant_id as string;
      const copyFrom = args.copy_from_tenant as string | undefined;

      // Workflow business services must be stored at the state ROOT level.
      // City-level tenants inherit from the root via tenant hierarchy fallback.
      const stateRoot = inputTenantId.includes('.') ? inputTenantId.split('.')[0] : inputTenantId;
      const sourceRoot = copyFrom ? (copyFrom.includes('.') ? copyFrom.split('.')[0] : copyFrom) : undefined;

      const results: { created: string[]; skipped: string[]; failed: string[] } = {
        created: [],
        skipped: [],
        failed: [],
      };

      if (copyFrom) {
        // The workflow API requires explicit business service codes — it returns empty without a filter.
        const knownServices = ['PGR', 'PT.CREATE', 'PT.UPDATE', 'NewTL', 'NewWS1', 'NewSW1', 'FSM', 'BPAREG', 'BPA'];
        // Search at the source root level (workflow resolves hierarchy)
        const sourceServices = await digitApi.workflowBusinessServiceSearch(sourceRoot!, knownServices);
        if (sourceServices.length === 0) {
          return JSON.stringify({
            success: false,
            error: `No workflow business services found in source "${sourceRoot}" for known codes (${knownServices.join(', ')}). ` +
              `Try a different source tenant.`,
          }, null, 2);
        }

        // Build UUID→stateName map for resolving nextState references
        const buildStateMap = (states: Record<string, unknown>[]): Map<string, string> => {
          const map = new Map<string, string>();
          for (const s of states) {
            if (s.uuid && s.state) map.set(s.uuid as string, s.state as string);
          }
          return map;
        };

        for (const bs of sourceServices) {
          const bsCode = bs.businessService as string;
          try {
            // Check if already exists at target root
            const existing = await digitApi.workflowBusinessServiceSearch(stateRoot, [bsCode]);
            if (existing.length > 0) {
              results.skipped.push(bsCode);
              continue;
            }

            const sourceStates = (bs.states || []) as Record<string, unknown>[];
            const stateMap = buildStateMap(sourceStates);

            // Strip IDs/audit, resolve UUID nextState references to state names
            const cleanStates = sourceStates.map((s) => ({
              state: s.state,
              applicationStatus: s.applicationStatus,
              docUploadRequired: s.docUploadRequired,
              isStartState: s.isStartState,
              isTerminateState: s.isTerminateState,
              isStateUpdatable: s.isStateUpdatable,
              actions: ((s.actions || []) as Record<string, unknown>[]).map((a) => {
                const nextState = a.nextState as string;
                // nextState might be a UUID reference — resolve to state name
                const resolvedNext = stateMap.get(nextState) || nextState;
                return {
                  action: a.action,
                  nextState: resolvedNext,
                  roles: a.roles,
                  active: a.active,
                };
              }),
            }));

            const result = await digitApi.workflowBusinessServiceCreate(stateRoot, {
              businessService: bsCode,
              business: bs.business,
              businessServiceSla: bs.businessServiceSla,
              states: cleanStates,
            });

            // Validate the response actually has data
            if (result.uuid || result.businessService) {
              results.created.push(bsCode);
            } else {
              results.failed.push(`${bsCode}: API returned 200 but no data — possible tenant/auth issue`);
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('DUPLICATE') || msg.includes('already exists') || msg.includes('unique')) {
              results.skipped.push(bsCode);
            } else {
              results.failed.push(`${bsCode}: ${msg}`);
            }
          }
        }

        return JSON.stringify({
          success: results.failed.length === 0 && (results.created.length > 0 || results.skipped.length > 0),
          tenantId: stateRoot,
          resolvedFrom: inputTenantId !== stateRoot ? inputTenantId : undefined,
          source: sourceRoot,
          summary: {
            created: results.created.length,
            skipped: results.skipped.length,
            failed: results.failed.length,
          },
          results,
          hint: results.created.length > 0
            ? `Workflow registered at root "${stateRoot}". All city-level tenants (e.g. "${inputTenantId}") inherit automatically.`
            : undefined,
        }, null, 2);
      }

      // Manual creation
      const bsCode = args.business_service as string;
      if (!bsCode || !args.states) {
        return JSON.stringify({
          success: false,
          error: 'Either provide copy_from_tenant to clone an existing workflow, or provide business_service + states for manual creation.',
        }, null, 2);
      }

      try {
        const result = await digitApi.workflowBusinessServiceCreate(stateRoot, {
          businessService: bsCode,
          business: args.business as string || bsCode.toLowerCase(),
          businessServiceSla: args.business_service_sla as number || 259200000,
          states: args.states,
        });

        if (!result.uuid && !result.businessService) {
          return JSON.stringify({
            success: false,
            error: `API returned 200 but no data for "${bsCode}" on "${stateRoot}". The workflow service may require the tenant to be pre-configured.`,
          }, null, 2);
        }

        return JSON.stringify({
          success: true,
          message: `Workflow "${bsCode}" created for tenant "${stateRoot}"`,
          resolvedFrom: inputTenantId !== stateRoot ? inputTenantId : undefined,
          businessService: {
            businessService: result.businessService,
            business: result.business,
            tenantId: result.tenantId,
            stateCount: ((result.states || []) as unknown[]).length,
          },
        }, null, 2);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ success: false, error: msg }, null, 2);
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
