import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track, captureError } = vi.hoisted(() => ({ track: vi.fn(), captureError: vi.fn() }));
vi.mock('@/lib/telemetry', () => ({ captureError }));
vi.mock('@/lib/analytics', async (importOriginal) => ({ ...(await importOriginal<object>()), track }));

import { reportStepError, trackImport, trackMethod, trackRecordSave, trackUploadRefused } from './telemetry';

describe('onboarding telemetry', () => {
  beforeEach(() => {
    track.mockClear();
    captureError.mockClear();
  });

  it('sends an import with its step, kind of record, method and counts', () => {
    trackImport('employees', 'employee', { method: 'bulk', count: 12, failed: 1 });
    expect(track).toHaveBeenCalledWith('onboarding:import_complete', {
      step: 'employees',
      entity: 'employee',
      method: 'bulk',
      count: 12,
      failed: 1,
    });
  });

  it('sends a save from a form, with its step, record and operation', () => {
    trackRecordSave('departments', 'designation', 'create', { roles: 2, step: 'employees' });
    expect(track).toHaveBeenCalledWith('onboarding:record_save', {
      method: 'form',
      roles: 2,
      step: 'departments',
      entity: 'designation',
      operation: 'create',
    });
  });

  it('sends a method picked and a method backed out of as two events', () => {
    trackMethod('geography', 'preconfigured');
    trackMethod('geography', 'excel', true);
    expect(track.mock.calls).toEqual([
      ['onboarding:method_select', { step: 'geography', method: 'preconfigured' }],
      ['onboarding:method_cancel', { step: 'geography', method: 'excel' }],
    ]);
  });

  it('sends a refused upload with its code and the number of problems', () => {
    trackUploadRefused('geography', 'boundary', 'DUPLICATE_CODE', 3);
    expect(track).toHaveBeenCalledWith('onboarding:upload_refuse', {
      step: 'geography',
      entity: 'boundary',
      error_code: 'DUPLICATE_CODE',
      count: 3,
    });
  });

  it('reports a failed save to Sentry, and only its code to analytics', () => {
    reportStepError('complaints', 'save', 'SCHEMA_DEFINITION_NOT_FOUND', 'ke');
    const [error, context] = captureError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('SCHEMA_DEFINITION_NOT_FOUND');
    expect(context).toEqual({ component: 'onboarding', step: 'complaints', action: 'save', tenant: 'ke' });
    expect(track).toHaveBeenCalledWith('onboarding:step_fail', {
      step: 'complaints',
      action: 'save',
      error_code: 'SCHEMA_DEFINITION_NOT_FOUND',
    });
  });

  it('never puts an error message in analytics', () => {
    reportStepError('employees', 'create_employee', new Error('User with mobile 0712345678 already exists'), 'ke');
    expect(track).toHaveBeenCalledWith('onboarding:step_fail', { step: 'employees', action: 'create_employee', error_code: 'Error' });
  });
});
