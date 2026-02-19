import { api, createRequestInfo } from '../utils/api';
import { db } from '../utils/db';
import { config } from '../utils/config';
import { GenerateIdResponseSchema, validateIdFormat, extractSequenceFromId } from '../schemas/idgen';

describe('IDGen Service', () => {
  const { ports, tenant } = config;

  describe('Generate ID', () => {
    test('should generate ID with custom format', async () => {
      // Get sequence value before
      const seqBefore = await db.getSequenceValue('seq_eg_pgr_id');

      const response = await api.post(ports.idgen, '/egov-idgen/id/_generate', {
        RequestInfo: createRequestInfo(),
        idRequests: [
          {
            idName: 'smoke.test.id',
            tenantId: tenant.city,
            format: 'SMOKE/[cy:yyyy-MM-dd]/[seq_eg_pgr_id]',
          },
        ],
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      // Validate response schema
      const parsed = GenerateIdResponseSchema.safeParse(response.data);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        const generatedId = parsed.data.idResponses[0].id;

        // Validate ID format starts with expected prefix
        expect(validateIdFormat(generatedId, 'SMOKE/')).toBe(true);

        // Validate ID contains date in expected format
        const today = new Date().toISOString().split('T')[0]; // yyyy-MM-dd
        expect(generatedId).toContain(today);

        // Validate sequence number is in the ID
        const seqNum = extractSequenceFromId(generatedId);
        expect(seqNum).not.toBeNull();
        expect(seqNum).toBeGreaterThan(0);

        // Validate response status
        expect(parsed.data.responseInfo.status).toBe('SUCCESSFUL');
      }

      // Verify sequence was incremented in DB
      const seqAfter = await db.getSequenceValue('seq_eg_pgr_id');
      expect(seqAfter).toBeGreaterThan(seqBefore);
    });

    test('should generate multiple IDs in single request', async () => {
      const response = await api.post(ports.idgen, '/egov-idgen/id/_generate', {
        RequestInfo: createRequestInfo(),
        idRequests: [
          { idName: 'test.id.1', tenantId: tenant.city, format: 'TEST1/[seq_eg_pgr_id]' },
          { idName: 'test.id.2', tenantId: tenant.city, format: 'TEST2/[seq_eg_pgr_id]' },
        ],
      });

      expect(response.ok).toBe(true);

      const parsed = GenerateIdResponseSchema.safeParse(response.data);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.idResponses).toHaveLength(2);
        expect(parsed.data.idResponses[0].id).toMatch(/^TEST1\//);
        expect(parsed.data.idResponses[1].id).toMatch(/^TEST2\//);
      }
    });

    test('should fail with missing idName', async () => {
      const response = await api.post(ports.idgen, '/egov-idgen/id/_generate', {
        RequestInfo: createRequestInfo(),
        idRequests: [
          { tenantId: tenant.city, format: 'TEST/[seq_eg_pgr_id]' },
        ],
      });

      // Should return error
      const data = response.data as { ResponseInfo?: { status: string }; Errors?: unknown[] };
      expect(data.ResponseInfo?.status === 'FAILED' || data.Errors).toBeTruthy();
    });
  });

  describe('Database Verification', () => {
    test('id_generator table exists and has correct schema', async () => {
      const exists = await db.tableExists('id_generator');
      expect(exists).toBe(true);

      // Verify table structure
      const columns = await db.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'id_generator'
         ORDER BY ordinal_position`
      );

      const columnNames = columns.rows.map((r) => (r as { column_name: string }).column_name);
      expect(columnNames).toContain('idname');
      expect(columnNames).toContain('tenantid');
      expect(columnNames).toContain('format');
      expect(columnNames).toContain('sequencenumber');
    });

    test('required sequences exist', async () => {
      const sequences = [
        'seq_eg_pgr_id',
        'seq_eg_user',
        'seq_eg_role',
      ];

      for (const seq of sequences) {
        const value = await db.getSequenceValue(seq);
        expect(typeof value).toBe('number');
      }
    });
  });
});
