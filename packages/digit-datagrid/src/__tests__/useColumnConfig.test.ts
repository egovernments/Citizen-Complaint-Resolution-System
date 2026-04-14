import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColumnConfig } from '../editing/useColumnConfig';
import type { DigitColumn } from '../columns/types';

describe('useColumnConfig', () => {
  const mockColumns: DigitColumn[] = [
    { source: 'id', label: 'ID' },
    { source: 'name', label: 'Name' },
    { source: 'email', label: 'Email' },
    { source: 'status', label: 'Status' },
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns all columns visible by default', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
      })
    );

    expect(result.current.visibleColumns).toHaveLength(4);
    expect(result.current.hiddenColumns).toHaveLength(0);
    expect(result.current.visibleColumns).toEqual(mockColumns);
  });

  it('toggles a column hidden', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
      })
    );

    act(() => {
      result.current.toggleColumn('email');
    });

    expect(result.current.visibleColumns).toHaveLength(3);
    expect(result.current.hiddenColumns).toHaveLength(1);
    expect(result.current.isColumnHidden('email')).toBe(true);
    expect(result.current.isColumnHidden('name')).toBe(false);

    // Toggle back to visible
    act(() => {
      result.current.toggleColumn('email');
    });

    expect(result.current.visibleColumns).toHaveLength(4);
    expect(result.current.hiddenColumns).toHaveLength(0);
    expect(result.current.isColumnHidden('email')).toBe(false);
  });

  it('cannot hide always-visible columns', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
        alwaysVisibleSources: ['id', 'name'],
      })
    );

    // Try to hide 'id' (always visible)
    act(() => {
      result.current.toggleColumn('id');
    });

    expect(result.current.visibleColumns).toHaveLength(4);
    expect(result.current.hiddenColumns).toHaveLength(0);
    expect(result.current.isColumnHidden('id')).toBe(false);

    // Can hide 'email' (not always visible)
    act(() => {
      result.current.toggleColumn('email');
    });

    expect(result.current.visibleColumns).toHaveLength(3);
    expect(result.current.hiddenColumns).toHaveLength(1);
    expect(result.current.isColumnHidden('email')).toBe(true);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
      })
    );

    act(() => {
      result.current.toggleColumn('email');
      result.current.toggleColumn('status');
    });

    const stored = localStorage.getItem('digit-datagrid:users:columns');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toContain('email');
    expect(parsed).toContain('status');
    expect(parsed).toHaveLength(2);
  });

  it('restores from localStorage', () => {
    // Pre-populate localStorage
    localStorage.setItem('digit-datagrid:users:columns', JSON.stringify(['email', 'status']));

    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
      })
    );

    expect(result.current.visibleColumns).toHaveLength(2);
    expect(result.current.hiddenColumns).toHaveLength(2);
    expect(result.current.isColumnHidden('email')).toBe(true);
    expect(result.current.isColumnHidden('status')).toBe(true);
    expect(result.current.isColumnHidden('id')).toBe(false);
    expect(result.current.isColumnHidden('name')).toBe(false);
  });

  it('resets to show all columns', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
      })
    );

    // Hide some columns
    act(() => {
      result.current.toggleColumn('email');
      result.current.toggleColumn('status');
    });

    expect(result.current.hiddenColumns).toHaveLength(2);

    // Reset
    act(() => {
      result.current.resetColumns();
    });

    expect(result.current.visibleColumns).toHaveLength(4);
    expect(result.current.hiddenColumns).toHaveLength(0);
    expect(result.current.isColumnHidden('email')).toBe(false);
    expect(result.current.isColumnHidden('status')).toBe(false);

    // Check localStorage is cleared
    const stored = localStorage.getItem('digit-datagrid:users:columns');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(0);
  });

  it('uses preferenceKey when provided', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
        preferenceKey: 'custom-key',
      })
    );

    act(() => {
      result.current.toggleColumn('email');
    });

    // Should use custom key, not resource name
    const stored = localStorage.getItem('digit-datagrid:custom-key:columns');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed).toContain('email');

    // Should NOT store under resource name
    const resourceStored = localStorage.getItem('digit-datagrid:users:columns');
    expect(resourceStored).toBeNull();
  });

  it('handles multiple columns being toggled', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
      })
    );

    act(() => {
      result.current.toggleColumn('id');
      result.current.toggleColumn('email');
      result.current.toggleColumn('status');
    });

    expect(result.current.visibleColumns).toHaveLength(1);
    expect(result.current.hiddenColumns).toHaveLength(3);
    expect(result.current.visibleColumns[0].source).toBe('name');
  });

  it('maintains column order when filtering', () => {
    const { result } = renderHook(() =>
      useColumnConfig({
        resource: 'users',
        columns: mockColumns,
      })
    );

    act(() => {
      result.current.toggleColumn('email'); // Hide second column
    });

    expect(result.current.visibleColumns.map((c) => c.source)).toEqual(['id', 'name', 'status']);
    expect(result.current.hiddenColumns.map((c) => c.source)).toEqual(['email']);
  });
});
