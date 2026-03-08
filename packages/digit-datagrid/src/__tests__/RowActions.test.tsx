import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowActions } from '@/actions/RowActions';
import type { RaRecord } from 'ra-core';

describe('RowActions', () => {
  const mockRecord: RaRecord = { id: '1', name: 'Test Record' };

  const renderInTable = (ui: React.ReactElement) => {
    return render(
      <table>
        <tbody>
          <tr>{ui}</tr>
        </tbody>
      </table>
    );
  };

  it('renders delete button when onDelete is provided', () => {
    const onDelete = vi.fn();
    renderInTable(
      <RowActions record={mockRecord} onDelete={onDelete} mutationMode="undoable" />
    );

    const deleteButton = screen.getByLabelText('Delete');
    expect(deleteButton).toBeInTheDocument();
  });

  it('hides delete button when noDelete is true', () => {
    const onDelete = vi.fn();
    renderInTable(
      <RowActions
        record={mockRecord}
        onDelete={onDelete}
        noDelete={true}
        mutationMode="undoable"
      />
    );

    const deleteButton = screen.queryByLabelText('Delete');
    expect(deleteButton).not.toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked (undoable mode)', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderInTable(
      <RowActions record={mockRecord} onDelete={onDelete} mutationMode="undoable" />
    );

    const deleteButton = screen.getByLabelText('Delete');
    await user.click(deleteButton);

    expect(onDelete).toHaveBeenCalledWith(mockRecord);
  });

  it('does not render delete button when onDelete is not provided', () => {
    renderInTable(<RowActions record={mockRecord} mutationMode="undoable" />);

    const deleteButton = screen.queryByLabelText('Delete');
    expect(deleteButton).not.toBeInTheDocument();
  });
});
