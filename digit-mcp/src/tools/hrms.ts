import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import { validateTenantId, validateMobileNumber, rejectControlChars, validateStringLength, validateResourceId } from '../utils/validation.js';

export function registerHrmsTools(registry: ToolRegistry): void {
  registry.register({
    name: 'employee_create',
    group: 'employees',
    category: 'hrms',
    risk: 'write',
    description:
      'Create a new employee in DIGIT HRMS. Requires employee name, mobile number, roles, department/designation assignment, and jurisdiction. ' +
      'Use validate_departments and validate_designations first to get valid codes. ' +
      'Use access_roles_search to find valid role codes. ' +
      'Use validate_boundary to find valid boundary codes for jurisdiction.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID for the employee (city-level, e.g. "pg.citya")',
        },
        name: {
          type: 'string',
          description: 'Full name of the employee',
        },
        mobile_number: {
          type: 'string',
          description: 'Mobile number (10 digits)',
        },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Role code (e.g. "GRO", "PGR_LME", "EMPLOYEE")' },
              name: { type: 'string', description: 'Role display name' },
            },
            required: ['code', 'name'],
          },
          description: 'Roles to assign. Must include EMPLOYEE role. For PGR: GRO (Grievance Routing Officer), PGR_LME (Last Mile Employee), DGRO (Department GRO).',
        },
        department: {
          type: 'string',
          description: 'Department code for assignment (e.g. "DEPT_1"). Use validate_departments to list valid codes.',
        },
        designation: {
          type: 'string',
          description: 'Designation code for assignment (e.g. "DESIG_1"). Use validate_designations to list valid codes.',
        },
        jurisdiction_hierarchy: {
          type: 'string',
          description: 'Jurisdiction hierarchy type (default: "ADMIN")',
        },
        jurisdiction_boundary_type: {
          type: 'string',
          description: 'Boundary type for jurisdiction (e.g. "City", "Ward", "Locality")',
        },
        jurisdiction_boundary: {
          type: 'string',
          description: 'Boundary code for jurisdiction (e.g. "pg.citya"). Use validate_boundary to find codes.',
        },
        employee_type: {
          type: 'string',
          description: 'Employee type (default: "PERMANENT"). Use mdms_search with schema "egov-hrms.EmployeeType" to list valid types.',
        },
        date_of_appointment: {
          type: 'number',
          description: 'Date of appointment as epoch timestamp in milliseconds (default: current time)',
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
        dry_run: {
          type: 'boolean',
          description: 'If true, validate inputs and check prerequisites without executing. Returns a preview of what would happen.',
        },
        existing_user_uuid: {
          type: 'string',
          description: 'Optional. UUID of an already-provisioned eg_user record to link this employee to (avoids HRMS DuplicateUserName when the user was created out-of-band, e.g. via tenant_bootstrap or city_setup). Requires the matching HRMS build with the uuid-link short-circuit.',
        },
      },
      required: ['tenant_id', 'name', 'mobile_number', 'roles', 'department', 'designation', 'jurisdiction_boundary_type', 'jurisdiction_boundary'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateMobileNumber(args.mobile_number, 'mobile_number');
      rejectControlChars(args.name as string, 'name');
      validateStringLength(args.name as string, 200, 'name');
      validateResourceId(args.department as string, 'department');
      validateResourceId(args.designation as string, 'designation');

      const tenantId = args.tenant_id as string;
      const name = args.name as string;
      const mobileNumber = args.mobile_number as string;
      const department = args.department as string;
      const designation = args.designation as string;
      const roles = args.roles as Array<{ code: string; name: string }>;
      const jurisdictionBoundary = args.jurisdiction_boundary as string;
      const dryRun = args.dry_run === true;

      if (dryRun) {
        const issues: string[] = [];

        if (!digitApi.isAuthenticated()) {
          issues.push('Not authenticated. Call "configure" first.');
        }

        // Check department exists
        if (digitApi.isAuthenticated()) {
          try {
            const stateRoot = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
            const depts = await digitApi.mdmsV2Search(stateRoot, 'common-masters.Department');
            const deptCodes = depts.map((d) => (d.data as Record<string, unknown>)?.code);
            if (!deptCodes.includes(department)) {
              issues.push(`Department "${department}" not found. Available: ${deptCodes.slice(0, 10).join(', ')}`);
            }
          } catch { /* skip */ }
        }

        return JSON.stringify({
          success: true,
          dry_run: true,
          valid: issues.length === 0,
          issues,
          preview: {
            tenantId,
            name,
            mobileNumber,
            department,
            designation,
            roles: roles.map((r) => r.code),
            jurisdictionBoundary,
          },
        }, null, 2);
      }

      await ensureAuthenticated();

      const now = Date.now();

      // Derive role tenant from the target tenant's root (not env.stateTenantId)
      // e.g. "tenant.city1" → "tenant", "pg.citya" → "pg"
      const roleTenant = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

      const mappedRoles = roles.map((r) => ({
        code: r.code,
        name: r.name,
        tenantId: roleTenant,
      }));

      // Ensure EMPLOYEE role is present
      if (!mappedRoles.some((r) => r.code === 'EMPLOYEE')) {
        mappedRoles.push({ code: 'EMPLOYEE', name: 'Employee', tenantId: roleTenant });
      }

      const existingUserUuid = args.existing_user_uuid as string | undefined;
      const userPayload: Record<string, unknown> = {
        name: args.name as string,
        userName: args.mobile_number as string,
        mobileNumber: args.mobile_number as string,
        emailId: (args.email as string) || null,
        gender: (args.gender as string) || null,
        type: 'EMPLOYEE',
        active: true,
        // Roles must be tagged with the state root — that's where
        // ACCESSCONTROL-ROLES MDMS lives; HRMS rejects "Invalid role"
        // if role.tenantId is a leaf city.
        roles: mappedRoles,
        // User itself must live on the REQUESTED tenant. egov-user
        // scopes lookups by (id, tenantid). The SPA login form sends
        // tenantId=<city>, so a user created with tenantId=<root> is
        // invisible to login. Previous code set this to roleTenant
        // (root), breaking employee logins on every city tenant.
        tenantId,
      };
      if (existingUserUuid) {
        // Trigger HRMS's uuid-link short-circuit (digit-common-boundary-uuidlink+).
        // Don't send a password — HRMS preserves the existing user's auth state.
        userPayload.uuid = existingUserUuid;
      } else {
        userPayload.password = 'eGov@123';
      }

      const employee: Record<string, unknown> = {
        tenantId,
        employeeType: (args.employee_type as string) || 'PERMANENT',
        employeeStatus: 'EMPLOYED',
        dateOfAppointment: (args.date_of_appointment as number) || now,
        IsActive: true,
        user: userPayload,
        assignments: [
          {
            department: args.department as string,
            designation: args.designation as string,
            fromDate: (args.date_of_appointment as number) || now,
            isCurrentAssignment: true,
            isHOD: false,
          },
        ],
        jurisdictions: [
          {
            hierarchy: (args.jurisdiction_hierarchy as string) || 'ADMIN',
            boundaryType: args.jurisdiction_boundary_type as string,
            boundary: args.jurisdiction_boundary as string,
            tenantId,
            isActive: true,
          },
        ],
      };

      try {
        const result = await digitApi.employeeCreate(tenantId, [employee]);

        if (result.length === 0) {
          return JSON.stringify({ success: false, error: 'No employee returned in response' }, null, 2);
        }

        const created = result[0];
        const user = created.user as Record<string, unknown> | undefined;

        // HRMS doesn't reliably set the user password. Reset it via
        // user update so the employee can actually login. Search must
        // use the *user's actual tenantId* (the city tenant the user
        // was created on), not the role tenant. Using the role tenant
        // would return an empty result on city tenants and leave the
        // password unset.
        if (user?.uuid) {
          try {
            const userTenant = (user.tenantId as string) || tenantId;
            const users = await digitApi.userSearch(userTenant, { uuid: [user.uuid as string], limit: 1 });
            if (users.length > 0) {
              await digitApi.userUpdate({ ...users[0], password: 'eGov@123' });
            }
          } catch (pwErr) {
            // Non-fatal: employee was created, password reset just failed
            console.error(`[employee_create] Password reset failed for ${user.uuid}: ${pwErr instanceof Error ? pwErr.message : String(pwErr)}`);
          }
        }

        return JSON.stringify(
          {
            success: true,
            message: `Employee created: ${created.code || 'unknown'}`,
            employee: {
              code: created.code,
              uuid: created.uuid,
              name: user?.name,
              mobileNumber: user?.mobileNumber,
              employeeStatus: created.employeeStatus,
              employeeType: created.employeeType,
              tenantId: created.tenantId,
              roles: ((user?.roles || []) as Array<{ code: string }>).map((r) => r.code),
            },
            loginCredentials: {
              username: created.code,
              password: 'eGov@123',
              // Login must use the city tenant where the user was
              // actually provisioned. Auth is scoped by tenantId in
              // egov-user — a user on `<state>.<city>` is invisible to
              // a login attempt with tenantId=`<state>`.
              loginTenantId: tenantId,
              note: 'To authenticate as this employee, use the employee CODE as the username (not mobile number).',
            },
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isDuplicate = msg.includes('already exists') || msg.includes('duplicate') || msg.includes('ALREADY_ACTIVE');
        const isIdgenError = msg.includes('Unable to create ids') || msg.includes('citycode') || msg.includes('idgen') || msg.includes('UnrecognizedPropertyException') || msg.includes('ResponseInfo');
        const isUserError = msg.includes('InvalidUserCreate') || msg.includes('user') || msg.includes('mobile');
        const isRoleError = msg.includes('Invalid role') || msg.includes('role assigned');

        let hint: string;
        if (isRoleError) {
          hint = 'HRMS only accepts employee-type roles (EMPLOYEE, GRO, PGR_LME, DGRO, etc). ' +
            'CITIZEN and CSR are NOT valid HRMS roles — they are user-service roles used for PGR complaint filing. ' +
            'You do NOT need CITIZEN/CSR roles on employees to create complaints. The ADMIN user with EMPLOYEE role can create PGR complaints via pgr_create. ' +
            'Use access_roles_search to list valid HRMS role codes.';
        } else if (isDuplicate) {
          hint = 'An employee with this mobile number may already exist for this tenant. Use validate_employees to search existing employees.';
        } else if (isIdgenError) {
          const stateRoot = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
          hint = `Employee ID generation failed. The idgen service resolves city codes via MDMS v1, which requires tenant.tenants records under the "${stateRoot}" root. ` +
            `FIX: Call tenant_bootstrap with target_tenant="${stateRoot}" (source_tenant="pg"). ` +
            `This copies all schemas, ID formats, and creates the root self-record needed for idgen to resolve city codes. Then retry employee_create.`;
        } else if (isUserError) {
          hint = 'The underlying user creation failed. The mobile number may already be registered, or the user service rejected the request. ' +
            'Use user_search to check if a user with this mobile number already exists.';
        } else {
          hint = 'Employee creation failed. Verify: (1) department code is valid (use validate_departments), ' +
            '(2) designation code is valid (use validate_designations), ' +
            '(3) role codes are valid (use access_roles_search), ' +
            '(4) boundary code exists (use validate_boundary).';
        }

        return JSON.stringify({
          success: false,
          error: msg,
          hint,
          alternatives: [
            { tool: 'validate_employees', purpose: 'Search existing employees for the tenant' },
            { tool: 'mdms_get_tenants', purpose: 'List all tenants and verify tenant hierarchy' },
            { tool: 'user_search', purpose: 'Check if a user with this mobile number exists' },
            { tool: 'validate_departments', purpose: 'List valid department codes' },
            { tool: 'validate_designations', purpose: 'List valid designation codes' },
            { tool: 'access_roles_search', purpose: 'List valid role codes' },
            { tool: 'validate_boundary', purpose: 'Find valid boundary codes' },
          ],
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'employee_update',
    group: 'employees',
    category: 'hrms',
    risk: 'write',
    description:
      'Update an existing HRMS employee. First use validate_employees to get current employee data, then pass the modified employee object. ' +
      'Common updates: adding/removing roles, changing department/designation assignment, deactivating an employee. ' +
      'The full employee object must be sent (fetch first, modify, then update).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID of the employee',
        },
        employee_code: {
          type: 'string',
          description: 'Employee code to update (use validate_employees to find codes)',
        },
        add_roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Role code to add' },
              name: { type: 'string', description: 'Role display name' },
            },
            required: ['code', 'name'],
          },
          description: 'Roles to add to the employee',
        },
        remove_roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Role codes to remove from the employee',
        },
        new_assignment: {
          type: 'object',
          properties: {
            department: { type: 'string', description: 'Department code' },
            designation: { type: 'string', description: 'Designation code' },
          },
          description: 'New current assignment (ends previous current assignment)',
        },
        deactivate: {
          type: 'boolean',
          description: 'Set to true to deactivate the employee',
        },
        reactivate: {
          type: 'boolean',
          description: 'Set to true to reactivate a deactivated employee',
        },
      },
      required: ['tenant_id', 'employee_code'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateResourceId(args.employee_code, 'employee_code');

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const employeeCode = args.employee_code as string;

      // Derive role tenant from the target tenant's root
      const roleTenant = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

      // Fetch current employee
      const employees = await digitApi.employeeSearch(tenantId, { codes: [employeeCode] });
      if (employees.length === 0) {
        return JSON.stringify({
          success: false,
          error: `Employee "${employeeCode}" not found in tenant "${tenantId}"`,
          hint: 'Use validate_employees to list existing employees and their codes.',
        }, null, 2);
      }

      const employee = { ...employees[0] };

      // HRMS search may return employees without user data populated;
      // if user is null, fetch it separately via user search by UUID.
      // User search requires the root tenant (e.g. "pg"), not city-level (e.g. "pg.citya").
      let user = employee.user as Record<string, unknown> | null;
      if (!user || !user.mobileNumber) {
        const uuid = employee.uuid as string | undefined;
        if (uuid) {
          const users = await digitApi.userSearch(roleTenant, { uuid: [uuid] });
          if (users.length > 0) {
            user = users[0];
          }
        }
        if (!user || !user.mobileNumber) {
          return JSON.stringify({
            success: false,
            error: `Employee "${employeeCode}" has no associated user record. The HRMS service returned an employee without user data.`,
            hint: 'This may indicate a data integrity issue. Try searching the user directly with user_search.',
          }, null, 2);
        }
      }
      user = { ...user };
      let currentRoles = [...((user.roles || []) as Array<{ code: string; name: string; tenantId?: string }>)];

      // Add roles
      const addRoles = args.add_roles as Array<{ code: string; name: string }> | undefined;
      if (addRoles?.length) {
        for (const role of addRoles) {
          if (!currentRoles.some((r) => r.code === role.code)) {
            currentRoles.push({ code: role.code, name: role.name, tenantId: roleTenant });
          }
        }
      }

      // Remove roles
      const removeRoles = args.remove_roles as string[] | undefined;
      if (removeRoles?.length) {
        currentRoles = currentRoles.filter((r) => !removeRoles.includes(r.code));
      }

      user.roles = currentRoles;
      employee.user = user;

      // New assignment
      const newAssignment = args.new_assignment as { department: string; designation: string } | undefined;
      if (newAssignment) {
        const assignments = [...((employee.assignments || []) as Array<Record<string, unknown>>)];
        // End current assignments
        for (const a of assignments) {
          if (a.isCurrentAssignment) {
            a.isCurrentAssignment = false;
            a.toDate = Date.now();
          }
        }
        assignments.push({
          department: newAssignment.department,
          designation: newAssignment.designation,
          fromDate: Date.now(),
          isCurrentAssignment: true,
          isHOD: false,
        });
        employee.assignments = assignments;
      }

      // Deactivate
      if (args.deactivate) {
        employee.employeeStatus = 'INACTIVE';
        employee.IsActive = false;
        employee.deactivationDetails = [
          ...((employee.deactivationDetails || []) as Array<Record<string, unknown>>),
          { effectiveFrom: Date.now(), reasonForDeactivation: 'Deactivated via MCP' },
        ];
      }

      // Reactivate
      if (args.reactivate) {
        employee.employeeStatus = 'EMPLOYED';
        employee.IsActive = true;
        employee.reActivateEmployee = true;
        employee.reactivationDetails = [
          ...((employee.reactivationDetails || []) as Array<Record<string, unknown>>),
          { effectiveFrom: Date.now(), reasonForReactivation: 'Reactivated via MCP' },
        ];
      }

      try {
        const result = await digitApi.employeeUpdate(tenantId, [employee]);

        if (result.length === 0) {
          return JSON.stringify({ success: false, error: 'No employee returned in response' }, null, 2);
        }

        const updated = result[0];
        const updatedUser = updated.user as Record<string, unknown> | undefined;

        return JSON.stringify(
          {
            success: true,
            message: `Employee ${employeeCode} updated`,
            employee: {
              code: updated.code,
              name: updatedUser?.name,
              employeeStatus: updated.employeeStatus,
              roles: ((updatedUser?.roles || []) as Array<{ code: string }>).map((r) => r.code),
              assignments: ((updated.assignments || []) as Array<Record<string, unknown>>)
                .filter((a) => a.isCurrentAssignment)
                .map((a) => ({ department: a.department, designation: a.designation })),
            },
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: msg,
          hint: 'Employee update failed. The full employee object is sent to the API — if fields are missing from the fetched data, the update may fail.',
          alternatives: [
            { tool: 'validate_employees', purpose: 'Fetch current employee data' },
            { tool: 'access_roles_search', purpose: 'List valid role codes' },
          ],
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
