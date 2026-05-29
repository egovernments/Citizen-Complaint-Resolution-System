import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableCell, commonValidations } from '../editing/EditableCell';

describe('EditableCell', () => {
  describe('Text type', () => {
    it('renders input in edit mode', () => {
      render(
        <EditableCell
          value="test"
          onSave={vi.fn()}
          initialEditing
          type="text"
        />
      );

      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('test');
    });

    it('saves on Enter key', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell
          value="initial"
          onSave={onSave}
          initialEditing
          type="text"
        />
      );

      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'updated{Enter}');

      expect(onSave).toHaveBeenCalledWith('updated');
    });

    it('cancels on Escape key', async () => {
      const onSave = vi.fn();
      const onCancel = vi.fn();
      render(
        <EditableCell
          value="initial"
          onSave={onSave}
          onCancel={onCancel}
          initialEditing
          type="text"
        />
      );

      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'updated{Escape}');

      expect(onSave).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });

    it('enters edit mode on click', async () => {
      render(
        <EditableCell
          value="test"
          onSave={vi.fn()}
          type="text"
        />
      );

      // Initially should show display mode
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

      // Click to enter edit mode
      const displayButton = screen.getByRole('button');
      await userEvent.click(displayButton);

      // Should now show input
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  describe('Number type', () => {
    it('renders input with type="number"', () => {
      render(
        <EditableCell
          value="42"
          onSave={vi.fn()}
          initialEditing
          type="number"
        />
      );

      const input = screen.getByRole('spinbutton');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'number');
      expect(input).toHaveValue(42);
    });
  });

  describe('Boolean type', () => {
    it('renders switch', () => {
      render(
        <EditableCell
          value="true"
          onSave={vi.fn()}
          type="boolean"
        />
      );

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toBeInTheDocument();
      expect(switchElement).toBeChecked();
    });

    it('saves immediately on toggle', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell
          value="false"
          onSave={onSave}
          type="boolean"
        />
      );

      const switchElement = screen.getByRole('switch');
      await userEvent.click(switchElement);

      expect(onSave).toHaveBeenCalledWith('true');
    });

    it('toggles from true to false', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell
          value="true"
          onSave={onSave}
          type="boolean"
        />
      );

      const switchElement = screen.getByRole('switch');
      await userEvent.click(switchElement);

      expect(onSave).toHaveBeenCalledWith('false');
    });
  });

  describe('Date type', () => {
    it('renders date input', () => {
      render(
        <EditableCell
          value="2026-03-08"
          onSave={vi.fn()}
          initialEditing
          type="date"
        />
      );

      const input = screen.getByDisplayValue('2026-03-08');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'date');
    });
  });

  describe('Select type', () => {
    const options = [
      { value: 'opt1', label: 'Option 1' },
      { value: 'opt2', label: 'Option 2' },
      { value: 'opt3', label: 'Option 3' },
    ];

    it('renders combobox (Radix Select trigger)', () => {
      render(
        <EditableCell
          value="opt1"
          onSave={vi.fn()}
          type="select"
          options={options}
        />
      );

      const combobox = screen.getByRole('combobox');
      expect(combobox).toBeInTheDocument();
    });

    it('shows placeholder when no options', () => {
      render(
        <EditableCell
          value=""
          onSave={vi.fn()}
          type="select"
          options={[]}
        />
      );

      expect(screen.getByText('No options')).toBeInTheDocument();
    });
  });

  describe('Validation', () => {
    it('shows error for required empty field', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell
          value="initial"
          onSave={onSave}
          initialEditing
          type="text"
          validation={commonValidations.required}
        />
      );

      const input = screen.getByRole('textbox');
      await userEvent.clear(input);

      // Try to save empty value - Click first button (check button)
      const buttons = screen.getAllByRole('button');
      await userEvent.click(buttons[0]);

      // Should show error and not call onSave
      expect(screen.getByText('This field is required')).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('validates email pattern', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell
          value=""
          onSave={onSave}
          initialEditing
          type="text"
          validation={commonValidations.email}
        />
      );

      const input = screen.getByRole('textbox');
      await userEvent.type(input, 'invalid-email');

      // Try to save invalid email
      const buttons = screen.getAllByRole('button');
      await userEvent.click(buttons[0]);

      expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('validates minLength', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell
          value=""
          onSave={onSave}
          initialEditing
          type="text"
          validation={{ minLength: 5 }}
        />
      );

      const input = screen.getByRole('textbox');
      await userEvent.type(input, 'abc');

      // Try to save short value
      const buttons = screen.getAllByRole('button');
      await userEvent.click(buttons[0]);

      expect(screen.getByText('Minimum length is 5')).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Disabled state', () => {
    it('renders static value when disabled', () => {
      render(
        <EditableCell
          value="test"
          onSave={vi.fn()}
          disabled
          type="text"
        />
      );

      expect(screen.getByText('test')).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows placeholder when disabled and empty', () => {
      render(
        <EditableCell
          value=""
          onSave={vi.fn()}
          disabled
          placeholder="Empty field"
          type="text"
        />
      );

      expect(screen.getByText('Empty field')).toBeInTheDocument();
    });
  });

  describe('Button interactions', () => {
    it('saves on check button click', async () => {
      const onSave = vi.fn();
      render(
        <EditableCell
          value="initial"
          onSave={onSave}
          initialEditing
          type="text"
        />
      );

      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'updated');

      // Click check button (first button in the group)
      const buttons = screen.getAllByRole('button');
      const checkButton = buttons[0];
      await userEvent.click(checkButton);

      expect(onSave).toHaveBeenCalledWith('updated');
    });

    it('cancels on X button click', async () => {
      const onSave = vi.fn();
      const onCancel = vi.fn();
      render(
        <EditableCell
          value="initial"
          onSave={onSave}
          onCancel={onCancel}
          initialEditing
          type="text"
        />
      );

      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'updated');

      // Click cancel button (second button in the group)
      const buttons = screen.getAllByRole('button');
      const cancelButton = buttons[1];
      await userEvent.click(cancelButton);

      expect(onSave).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
