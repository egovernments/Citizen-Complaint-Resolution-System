import { api } from '../utils/api';
import { db } from '../utils/db';
import { config } from '../utils/config';

describe('Health Checks', () => {
  const { ports } = config;

  test('MDMS service is healthy', async () => {
    const response = await api.get(ports.mdms, '/mdms-v2/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('User service is healthy', async () => {
    const response = await api.get(ports.user, '/user/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('IDGen service is healthy', async () => {
    const response = await api.get(ports.idgen, '/egov-idgen/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('Localization service is healthy', async () => {
    const response = await api.get(ports.localization, '/localization/actuator/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('Workflow service is healthy', async () => {
    const response = await api.get(ports.workflow, '/egov-workflow-v2/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('PGR service is healthy', async () => {
    const response = await api.get(ports.pgr, '/pgr-services/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('Access Control service is healthy', async () => {
    const response = await api.get(ports.accessControl, '/access/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('Encryption service is healthy', async () => {
    const response = await api.get(ports.encryption, '/egov-enc-service/actuator/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('Kong Gateway is routing correctly', async () => {
    const response = await api.get(ports.kong, '/user/health');
    expect(response.ok).toBe(true);
    expect(response.data).toHaveProperty('status', 'UP');
  });

  test('PostgreSQL is accessible', async () => {
    const result = await db.queryValue<number>('SELECT 1');
    expect(result).toBe(1);
  });
});
