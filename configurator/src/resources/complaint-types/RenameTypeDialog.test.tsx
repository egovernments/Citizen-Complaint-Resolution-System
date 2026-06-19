import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RenameTypeDialog } from './RenameTypeDialog';

function setup(onRename = vi.fn().mockResolvedValue(undefined)) {
  render(
    <RenameTypeDialog
      currentName="Sanitation"
      onRename={onRename}
      trigger={<button>edit</button>}
    />,
  );
  return { onRename };
}

describe('RenameTypeDialog', () => {
  it('opens with the current name prefilled', async () => {
    setup();
    fireEvent.click(screen.getByText('edit'));
    const input = await screen.findByLabelText('Complaint type display name');
    expect((input as HTMLInputElement).value).toBe('Sanitation');
  });

  it('calls onRename with the trimmed new name on Save', async () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByText('edit'));
    const input = await screen.findByLabelText('Complaint type display name');
    fireEvent.change(input, { target: { value: '  Sanitation & Waste  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Sanitation & Waste'));
  });

  it('does not call onRename when the name is empty', async () => {
    const { onRename } = setup();
    fireEvent.click(screen.getByText('edit'));
    const input = await screen.findByLabelText('Complaint type display name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
});
