import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEscalationConfig } = vi.hoisted(() => ({ getEscalationConfig: vi.fn() }));

vi.mock('@/App', () => ({ useApp: () => ({ state: { tenant: 'ke' } }) }));
vi.mock('@/hooks/useMastersCapability', () => ({
  useMastersCapability: () => ({ canEditResource: () => true }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/api/services/mdms', () => ({
  mdmsService: {
    getEscalationConfig: (...args: unknown[]) => getEscalationConfig(...args),
    searchRecords: async () => [
      { tenantId: 'ke', data: { code: 'PWTESTESCALATION', name: 'Test', department: 'DEPT_1', slaHours: 1 } },
    ],
    getTenants: async () => [],
  },
}));

import { EscalationPolicyEditor } from './EscalationPolicyEditor';

const policyWith = (overrides: Record<string, unknown>) => ({
  id: 'policy-1',
  tenantId: 'ke',
  data: {
    code: 'DEFAULT',
    maxDepth: 3,
    eligibleStatuses: ['PENDINGATLME'],
    defaultSlaPercentageByLevel: [80, 120, 200],
    defaultSlaByLevel: [3600000, 14400000, 86400000],
    enabledByLevel: [true, true, true],
    overrides,
  },
});

const saveButton = () => screen.getByRole('button', { name: /Save policy/ });

beforeEach(() => {
  getEscalationConfig.mockReset();
});

describe('EscalationPolicyEditor invalid overrides', () => {
  it('blocks Save on a ladder pgr-services ignores until it is removed (#2142)', async () => {
    getEscalationConfig.mockResolvedValue(policyWith({ PWTESTESCALATION: [2, 2, 4] }));
    render(<EscalationPolicyEditor />);

    expect(await screen.findByText(/pgr-services ignores the ladder flagged below/)).toBeInTheDocument();
    expect(screen.getByText(/ms L2: Must be greater than L1 \(2 ms\)/)).toBeInTheDocument();

    // A real change elsewhere: Save stays blocked while the bad override is there.
    fireEvent.change(screen.getByPlaceholderText(/ADD STATE/), {
      target: { value: 'PENDINGFORREASSIGNMENT' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove override PWTESTESCALATION' }));

    expect(screen.queryByText(/pgr-services ignores the ladder flagged below/)).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('can remove a value that is not a ladder on a live complaint type', async () => {
    getEscalationConfig.mockResolvedValue(policyWith({ PWTESTESCALATION: 5 }));
    render(<EscalationPolicyEditor />);

    await screen.findByText(/pgr-services ignores the ladder flagged below/);
    fireEvent.change(screen.getByPlaceholderText(/ADD STATE/), {
      target: { value: 'PENDINGFORREASSIGNMENT' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove override PWTESTESCALATION' }));

    expect(saveButton()).toBeEnabled();
  });
});
