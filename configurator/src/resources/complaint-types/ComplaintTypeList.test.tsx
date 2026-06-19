import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('ra-core', () => ({
  useTranslate: () => (key: string, opts?: { _?: string }) => opts?._ ?? key,
  useGetList: () => ({
    data: [
      {
        id: 'GarbageNotCollected',
        serviceCode: 'GarbageNotCollected',
        name: 'Garbage not collected',
        menuPath: 'Sanitation',
        department: 'Public Health',
        slaHours: 48,
        active: true,
        order: 1,
      },
      {
        id: 'PotHole',
        serviceCode: 'PotHole',
        name: 'Pot hole',
        menuPath: 'Roads',
        slaHours: 72,
        active: true,
        order: 2,
      },
    ],
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { ComplaintTypeList } from './ComplaintTypeList';

describe('ComplaintTypeList (accordion)', () => {
  it('renders complaint type rows collapsed by default', () => {
    render(<ComplaintTypeList />);
    expect(screen.getByText('Sanitation')).toBeInTheDocument();
    expect(screen.getByText('Roads')).toBeInTheDocument();
    // sub-type rows hidden while collapsed
    expect(screen.queryByText('Garbage not collected')).not.toBeInTheDocument();
  });

  it('expands a type to reveal its sub-types on click', () => {
    render(<ComplaintTypeList />);
    fireEvent.click(screen.getByText('Sanitation'));
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
  });
});
