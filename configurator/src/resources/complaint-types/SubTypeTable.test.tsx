import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { SubTypeTable } from './SubTypeTable';
import type { SubTypeRecord } from './groupComplaintTypes';

const sub: SubTypeRecord = {
  id: 'GarbageNotCollected',
  serviceCode: 'GarbageNotCollected',
  name: 'Garbage not collected',
  department: 'Public Health',
  slaHours: 48,
  active: true,
};

const twoSubs: SubTypeRecord[] = [
  sub,
  { id: 'Overflow', serviceCode: 'Overflow', name: 'Bin overflow', active: true },
];

describe('SubTypeTable', () => {
  it('renders sub-type rows', () => {
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn()} />);
    expect(screen.getByText('Garbage not collected')).toBeInTheDocument();
    expect(screen.getByText('GarbageNotCollected')).toBeInTheDocument();
  });

  it('navigates to the Show page on row click', () => {
    navigate.mockClear();
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Garbage not collected'));
    expect(navigate).toHaveBeenCalledWith(
      '/manage/complaint-types/GarbageNotCollected/show',
    );
  });

  it('Edit action navigates to the edit route and not the Show route', () => {
    navigate.mockClear();
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Edit Garbage not collected'));
    expect(navigate).toHaveBeenCalledWith('/manage/complaint-types/GarbageNotCollected');
    expect(navigate).not.toHaveBeenCalledWith('/manage/complaint-types/GarbageNotCollected/show');
  });

  it('Delete action opens a confirm dialog and calls onDelete with the record', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<SubTypeTable subTypes={twoSubs} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText('Delete Garbage not collected'));
    const confirm = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(sub));
  });

  it('warns that deleting the last sub-type removes the whole complaint type', async () => {
    render(<SubTypeTable subTypes={[sub]} onDelete={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByLabelText('Delete Garbage not collected'));
    expect(await screen.findByText(/remove the entire complaint type/i)).toBeInTheDocument();
  });

  it('does not show the last-sub-type warning when other sub-types remain', async () => {
    render(<SubTypeTable subTypes={twoSubs} onDelete={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByLabelText('Delete Garbage not collected'));
    await screen.findByRole('button', { name: 'Delete' });
    expect(screen.queryByText(/remove the entire complaint type/i)).not.toBeInTheDocument();
  });
});
