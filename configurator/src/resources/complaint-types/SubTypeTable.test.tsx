import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { SubTypeTable } from './SubTypeTable';
import type { SubTypeRecord } from './groupComplaintTypes';

const subs: SubTypeRecord[] = [
  {
    id: 'GarbageNotCollected',
    serviceCode: 'GarbageNotCollected',
    name: 'Garbage not collected',
    department: 'Public Health',
    slaHours: 48,
    active: true,
  },
];

describe('SubTypeTable', () => {
  it('renders sub-type rows', () => {
    render(<SubTypeTable subTypes={subs} />);
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
    expect(screen.getByText('GarbageNotCollected')).toBeInTheDocument();
  });

  it('navigates to the sub-type Show page on row click', () => {
    render(<SubTypeTable subTypes={subs} />);
    fireEvent.click(screen.getByText('Garbage not collected'));
    expect(navigate).toHaveBeenCalledWith(
      '/manage/complaint-types/GarbageNotCollected/show',
    );
  });
});
