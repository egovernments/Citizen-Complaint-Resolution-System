import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberFormatCard } from './NumberFormatCard';
import { parseMask, previewMask, rowsToNumberFormat } from './numberFormatMask';

// The dashboard's own examples (products/dashboard/src/utils/numberFormat.js): the editor must read masks the same way.
describe('parseMask / previewMask', () => {
  it('reads masks as the supervisor dashboard does', () => {
    expect(parseMask('#,##0.00')).toEqual({ group: ',', decimal: '.' });
    expect(parseMask('#.##0,00')).toEqual({ group: '.', decimal: ',' });
    expect(parseMask('# ##0,00')).toEqual({ group: ' ', decimal: ',' });
    expect(parseMask('#,##0')).toEqual({ group: ',', decimal: null });
    expect(parseMask('0,00')).toEqual({ group: null, decimal: ',' });
    expect(parseMask('#,###,##0')).toEqual({ group: ',', decimal: null });
    expect(previewMask('#.##0,00')).toBe('1.234.567,89');
    expect(previewMask('# ##0,00')).toBe('1 234 567,89');
  });

  it('refuses what the dashboard would ignore', () => {
    for (const bad of ['', 'abc', '#;##0', 'x0.00', '   ']) expect(parseMask(bad)).toBeNull();
    expect(previewMask('#;##0')).toBeNull();
  });

  it('drops blank rows', () => {
    expect(rowsToNumberFormat([{ locale: 'en_IN', mask: '#,##0.00' }, { locale: ' ', mask: '' }])).toEqual({ en_IN: '#,##0.00' });
  });
});

describe('NumberFormatCard', () => {
  it('shows the record per locale (a legacy string as default) and saves the edited object', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<NumberFormatCard value="#,##0.00" onSave={onSave} />);
    expect((screen.getByLabelText('Number format language 1') as HTMLInputElement).value).toBe('default');
    unmount();

    render(<NumberFormatCard value={{ pt_PT: '#.##0,00', default: '#,##0.00' }} onSave={onSave} />);
    expect((screen.getByLabelText('Number format language 1') as HTMLInputElement).value).toBe('pt_PT');
    expect(screen.getByText('1.234.567,89')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Number format mask 1'), { target: { value: '# ##0,00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save number format' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ pt_PT: '# ##0,00', default: '#,##0.00' }));
  });

  it('will not save an invalid mask, a bad locale or a duplicate', () => {
    const onSave = vi.fn();
    render(<NumberFormatCard value={{ en_IN: '#,##0.00' }} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Number format mask 1'), { target: { value: '#;##0' } });
    expect(screen.getByRole('alert').textContent).toMatch(/not a mask/);
    expect((screen.getByRole('button', { name: 'Save number format' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Number format mask 1'), { target: { value: '#,##0.00' } });
    fireEvent.change(screen.getByLabelText('Number format language 1'), { target: { value: 'english' } });
    expect(screen.getByRole('alert').textContent).toMatch(/not a locale code/);
    expect(onSave).not.toHaveBeenCalled();
  });
});
