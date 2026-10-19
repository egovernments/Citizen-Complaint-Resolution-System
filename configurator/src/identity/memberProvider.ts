import type { DataProvider, RaRecord, Identifier, CreateParams, DeleteParams } from 'ra-core';
import { apiClient } from '@/api/client';
import { hrmsService } from '@/api/services/hrms';
import { createAndLink, deactivateAndRemove, type MemberEmployee } from './memberActions';

/** App-only orchestration; the shared DIGIT provider remains a business API client. */
export function withIdentityMembers(base: DataProvider, tenantId: string): DataProvider {
  return {
    ...base,
    async create<RecordType extends Omit<RaRecord, "id"> = RaRecord, ResultRecordType extends RaRecord = RecordType & { id: Identifier }>(resource: string, params: CreateParams<RecordType>) {
      if (resource !== 'employees') return base.create(resource, params);
      const input = { ...params.data, tenantId } as unknown as MemberEmployee;
      const row = await createAndLink(input,
        () => hrmsService.searchEmployees(tenantId, { codes: [input.code] }) as unknown as Promise<MemberEmployee[]>,
        async employee => (await base.create(resource, { ...params, data: employee })).data as unknown as MemberEmployee,
      );
      return { data: { ...row, id: row.uuid ?? row.user.uuid } } as unknown as { data: ResultRecordType };
    },
    async update(resource, params) {
      if (resource === 'tenants' && params.data.name !== undefined && params.data.name !== params.previousData?.name) {
        throw new Error('Change the workspace name in Workspace settings.');
      }
      if (resource === 'tenants') {
        const fresh = (await base.getOne(resource, { id: params.id })).data;
        return base.update(resource, { ...params, data: { ...params.data, name: fresh.name } });
      }
      if (resource !== 'employees') return base.update(resource, params);
      // Preserve fresh identifiers for all employees. Identity actions own changes,
      // and a stale form must not overwrite email after verification elsewhere.
      const current = (await base.getOne(resource, { id: params.id })).data;
      if (current.tenantId !== tenantId) throw new Error('Employee must belong to this workspace.');
      const user = { ...params.data.user };
      for (const key of ['emailId', 'userName', 'uuid', 'id', 'tenantId']) user[key] = current.user?.[key];
      delete user.password;
      if (params.data.isActive === false) {
        await deactivateAndRemove(
          async () => ({ ...current, tenantId }) as unknown as MemberEmployee,
          employee => base.update(resource, { ...params, data: { ...params.data, ...employee, user } }),
          apiClient.getAuth().user?.uuid,
        );
        return { data: { ...current, ...params.data, user } };
      }
      return base.update(resource, { ...params, data: { ...params.data, tenantId, user } });
    },
    async delete<RecordType extends RaRecord = RaRecord>(resource: string, params: DeleteParams<RecordType>) {
      if (resource !== 'employees') return base.delete(resource, params);
      const row = await deactivateAndRemove(
        async () => {
          const employee = (await base.getOne(resource, { id: params.id })).data as unknown as MemberEmployee;
          if (employee.tenantId !== tenantId) throw new Error('Employee must belong to this workspace.');
          return employee;
        },
        employee => base.update(resource, { id: params.id, data: employee, previousData: params.previousData }),
        apiClient.getAuth().user?.uuid,
      );
      return { data: { ...row, id: params.id } } as unknown as { data: RecordType };
    },
    async deleteMany(resource, params) {
      if (resource !== 'employees') return base.deleteMany(resource, params);
      for (const id of params.ids) await this.delete(resource, { id });
      return { data: params.ids };
    },
  };
}
