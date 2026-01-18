// HRMS Service - Employee Management
import { apiClient } from '../client';
import { ENDPOINTS, DEFAULT_PASSWORD } from '../config';
import type { Employee, EmployeeUser, Role } from '../types';

export const hrmsService = {
  // ============================================
  // Employee Search
  // ============================================

  async searchEmployees(
    tenantId: string,
    options?: {
      codes?: string[];
      departments?: string[];
      designations?: string[];
      roles?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<Employee[]> {
    const response = await apiClient.post(ENDPOINTS.HRMS_EMPLOYEES_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo({ action: '_search' }),
      criteria: {
        tenantId,
        codes: options?.codes,
        departments: options?.departments,
        designations: options?.designations,
        roles: options?.roles,
        limit: options?.limit || 100,
        offset: options?.offset || 0,
      },
    });

    return (response.Employees || []) as Employee[];
  },

  // Check if employee code exists
  async employeeExists(tenantId: string, code: string): Promise<boolean> {
    const employees = await this.searchEmployees(tenantId, { codes: [code] });
    return employees.length > 0;
  },

  // ============================================
  // Employee Creation
  // ============================================

  // Create a single employee
  async createEmployee(employee: Employee): Promise<Employee> {
    const response = await apiClient.post(ENDPOINTS.HRMS_EMPLOYEES_CREATE, {
      RequestInfo: apiClient.buildRequestInfo({ action: '_create' }),
      Employees: [employee],
    });

    const created = (response.Employees || []) as Employee[];
    if (created.length === 0) {
      throw new Error('Employee creation failed - no employee returned');
    }

    return created[0];
  },

  // Create multiple employees with progress callback
  async createEmployees(
    employees: Employee[],
    onProgress?: (created: number, total: number, current: Employee) => void
  ): Promise<{
    success: Employee[];
    failed: { employee: Employee; error: string }[];
  }> {
    const success: Employee[] = [];
    const failed: { employee: Employee; error: string }[] = [];

    for (let i = 0; i < employees.length; i++) {
      const employee = employees[i];
      try {
        const result = await this.createEmployee(employee);
        success.push(result);
        onProgress?.(i + 1, employees.length, employee);

        // Small delay to avoid rate limiting
        await this.delay(200);
      } catch (error) {
        failed.push({
          employee,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        onProgress?.(i + 1, employees.length, employee);
      }
    }

    return { success, failed };
  },

  // Helper to build employee object from form data
  buildEmployee(data: {
    tenantId: string;
    code: string;
    name: string;
    userName: string;
    mobileNumber: string;
    emailId?: string;
    gender?: string;
    department: string;
    designation: string;
    roles: Role[];
    jurisdictions: { boundary: string; boundaryType: string; hierarchyType: string }[];
    dateOfAppointment?: number;
    password?: string;
  }): Employee {
    const now = Date.now();

    const user: EmployeeUser = {
      userName: data.userName.toLowerCase(),
      password: data.password || DEFAULT_PASSWORD,
      name: data.name,
      mobileNumber: data.mobileNumber,
      emailId: data.emailId,
      gender: data.gender,
      type: 'EMPLOYEE',
      active: true,
      tenantId: data.tenantId,
      roles: data.roles.map((r) => ({
        code: r.code,
        name: r.name,
        tenantId: data.tenantId,
      })),
    };

    return {
      code: data.code,
      tenantId: data.tenantId,
      user,
      dateOfAppointment: data.dateOfAppointment || now,
      employeeStatus: 'EMPLOYED',
      employeeType: 'PERMANENT',
      jurisdictions: data.jurisdictions.map((j) => ({
        boundary: j.boundary,
        boundaryType: j.boundaryType,
        hierarchyType: j.hierarchyType,
        isActive: true,
      })),
      assignments: [
        {
          designation: data.designation,
          department: data.department,
          fromDate: data.dateOfAppointment || now,
          isCurrentAssignment: true,
        },
      ],
    };
  },

  // ============================================
  // Employee Update
  // ============================================

  async updateEmployee(employee: Employee): Promise<Employee> {
    const response = await apiClient.post(ENDPOINTS.HRMS_EMPLOYEES_UPDATE, {
      RequestInfo: apiClient.buildRequestInfo({ action: '_update' }),
      Employees: [employee],
    });

    const updated = (response.Employees || []) as Employee[];
    if (updated.length === 0) {
      throw new Error('Employee update failed - no employee returned');
    }

    return updated[0];
  },

  // Deactivate employee
  async deactivateEmployee(employee: Employee): Promise<Employee> {
    const updatedEmployee: Employee = {
      ...employee,
      employeeStatus: 'INACTIVE',
    };

    return this.updateEmployee(updatedEmployee);
  },

  // ============================================
  // Validation Helpers
  // ============================================

  // Validate employee data before creation
  validateEmployee(
    employee: Partial<Employee>,
    existingDepartments: string[],
    existingDesignations: string[],
    existingBoundaries: string[],
    validRoles: string[]
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!employee.code) {
      errors.push('Employee code is required');
    }

    if (!employee.user?.name) {
      errors.push('Employee name is required');
    }

    if (!employee.user?.userName) {
      errors.push('Username is required');
    }

    if (!employee.user?.mobileNumber) {
      errors.push('Mobile number is required');
    } else if (!/^\d{10}$/.test(employee.user.mobileNumber)) {
      errors.push('Mobile number must be 10 digits');
    }

    if (employee.assignments?.length) {
      const assignment = employee.assignments[0];

      if (assignment.department && !existingDepartments.includes(assignment.department)) {
        errors.push(`Department "${assignment.department}" not found`);
      }

      if (assignment.designation && !existingDesignations.includes(assignment.designation)) {
        errors.push(`Designation "${assignment.designation}" not found`);
      }
    }

    if (employee.jurisdictions?.length) {
      for (const j of employee.jurisdictions) {
        if (!existingBoundaries.includes(j.boundary)) {
          errors.push(`Boundary "${j.boundary}" not found`);
        }
      }
    }

    if (employee.user?.roles?.length) {
      for (const r of employee.user.roles) {
        if (!validRoles.includes(r.code)) {
          errors.push(`Role "${r.code}" not valid`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  // ============================================
  // Utility Methods
  // ============================================

  // Generate employee code
  generateEmployeeCode(prefix: string, index: number): string {
    return `${prefix}_${String(index).padStart(4, '0')}`;
  },

  // Generate username from name
  generateUsername(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '.')
      .replace(/\.+/g, '.')
      .replace(/^\.|\.$/, '');
  },

  // Delay helper for rate limiting
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
