import { beforeEach, describe, expect, it, vi } from 'vitest';

const { trackEvent, captureError } = vi.hoisted(() => ({ trackEvent: vi.fn(), captureError: vi.fn() }));
vi.mock('@/lib/telemetry', () => ({ trackEvent, captureError }));

import { reportStepError, trackStepAction } from './telemetry';

describe('onboarding telemetry', () => {
  beforeEach(() => {
    trackEvent.mockClear();
    captureError.mockClear();
  });

  it('sends the step, the kind of record and the counts', () => {
    trackStepAction('employees', 'entity_import', 'employee', { tenant: 'ke', source: 'bulk', count: 12, failed: 1 });
    expect(trackEvent).toHaveBeenCalledWith('entity_import', {
      step: 'employees',
      entity: 'employee',
      tenant: 'ke',
      source: 'bulk',
      count: 12,
      failed: 1,
    });
  });

  it('reports a failed save with its step and action, wrapping a non-Error', () => {
    reportStepError('complaints', 'save', 'SCHEMA_DEFINITION_NOT_FOUND', 'ke');
    const [error, context] = captureError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('SCHEMA_DEFINITION_NOT_FOUND');
    expect(context).toEqual({ component: 'onboarding', step: 'complaints', action: 'save', tenant: 'ke' });
  });
});
