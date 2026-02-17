import { api, createRequestInfo } from '../utils/api';
import { db } from '../utils/db';
import { config } from '../utils/config';
import { MdmsSearchResponseSchema } from '../schemas/mdms';

describe('MDMS Service', () => {
  const { ports, tenant } = config;

  describe('Search Tenants', () => {
    test('should return tenant list from MDMS v2', async () => {
      const response = await api.post(ports.mdms, '/mdms-v2/v2/_search', {
        RequestInfo: createRequestInfo(),
        MdmsCriteria: {
          tenantId: tenant.state,
          schemaCode: 'tenant.tenants',
        },
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      // Validate response schema
      const parsed = MdmsSearchResponseSchema.safeParse(response.data);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.mdms).toBeDefined();
        expect(Array.isArray(parsed.data.mdms)).toBe(true);
        expect(parsed.data.mdms.length).toBeGreaterThan(0);

        // Validate each tenant has required fields
        for (const item of parsed.data.mdms) {
          expect(item.tenantId).toBeDefined();
          expect(item.schemaCode).toBe('tenant.tenants');
          expect(item.data).toBeDefined();
        }
      }
    });

    test('should return city tenants', async () => {
      const response = await api.post(ports.mdms, '/mdms-v2/v2/_search', {
        RequestInfo: createRequestInfo(),
        MdmsCriteria: {
          tenantId: tenant.state,
          schemaCode: 'tenant.tenants',
        },
      });

      expect(response.ok).toBe(true);

      const data = response.data as { mdms: Array<{ data: { code: string } }> };
      const tenantCodes = data.mdms.map((t) => t.data.code);

      // Should include our test tenant
      expect(tenantCodes).toContain(tenant.city);
    });
  });

  describe('MDMS v1 Compatibility', () => {
    test('should search via v1 endpoint', async () => {
      const response = await api.post(ports.mdms, '/mdms-v2/v1/_search', {
        RequestInfo: createRequestInfo(),
        MdmsCriteria: {
          tenantId: tenant.state,
          moduleDetails: [
            {
              moduleName: 'tenant',
              masterDetails: [{ name: 'tenants' }],
            },
          ],
        },
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });
  });

  describe('Database Verification', () => {
    test('MDMS tables exist', async () => {
      const tables = ['eg_mdms_data', 'eg_mdms_schema_definition'];

      for (const table of tables) {
        const exists = await db.tableExists(table);
        expect(exists).toBe(true);
      }
    });

    test('MDMS has seeded data', async () => {
      const count = await db.getRowCount('eg_mdms_data');
      expect(count).toBeGreaterThan(0);
    });
  });
});
