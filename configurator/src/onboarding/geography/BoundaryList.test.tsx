import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Boundary } from '@/api/types';
import type { BoundaryDraft, BoundarySelection } from './boundaryDraft';
import { BoundaryList } from './BoundaryList';

const area = (code: string, name: string, boundaryType: string, parent?: string): Boundary => ({
  tenantId: 'ke.nairobi',
  code,
  name,
  boundaryType,
  parent,
  hierarchyType: 'ADMIN',
});

const fetched: BoundarySelection = {
  id: 'selection-1',
  source: 'osm',
  method: 'preconfigured',
  hierarchyType: 'ADMIN',
  levels: ['County', 'Ward'],
  hierarchyExists: false,
  boundaries: [area('NBI_W2', 'Westlands', 'Ward', 'NBI'), area('NBI', 'Nairobi', 'County'), area('NBI_W1', 'Kibra', 'Ward', 'NBI')],
  unnamed: [],
  alreadyThere: 0,
  sourceText: 'the official boundaries for Kenya (geoBoundaries)',
  skipped: 0,
  attribution: 'Boundary data: geoBoundaries (CC BY 4.0)',
  preconfigured: null,
  resume: {
    kind: 'osm',
    searchTerm: 'Nairobi',
    pickedSuggestion: null,
    turbopassSource: 'official',
    fetchedPlace: { id: 'p1', name: 'Nairobi', label: 'Nairobi, Kenya', country: 'KE' },
    adminLevels: [],
    attribution: null,
    officialSet: null,
  },
};
const sheet: BoundarySelection = {
  ...fetched,
  id: 'selection-2',
  source: 'excel',
  method: 'excel',
  boundaries: [area('NBI_W9', 'Ziwani', 'Ward', 'NBI')],
  attribution: null,
  resume: {
    kind: 'excel',
    hierarchy: { tenantId: 'ke.nairobi', hierarchyType: 'ADMIN', boundaryHierarchy: [] },
    file: new File([''], 'wards.xlsx'),
    parsed: [],
    valid: [],
    invalid: [],
    polygonFile: null,
    polygonSidecar: null,
  },
};
const draft: BoundaryDraft = { selections: [fetched, sheet] };

const renderList = (onEdit = vi.fn(), onRemove = vi.fn()) =>
  render(
    <ul>
      <BoundaryList draft={draft} summarize={(s) => `${s.boundaries.length} areas`} onEdit={onEdit} onRemove={onRemove} />
    </ul>,
  );

describe('BoundaryList', () => {
  it('shows one item per thing added, named by its place or file', () => {
    renderList();
    const items = screen.getAllByTestId('boundary-list-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Nairobi, Kenya');
    expect(items[0].textContent).toContain('3 areas');
    expect(items[0].textContent).toContain('County → Ward');
    expect(items[1].textContent).toContain('wards.xlsx');
    expect(screen.getAllByText('Not saved yet')).toHaveLength(2);
    // The data credit lives in the map screen's validation report, not here.
    expect(screen.queryByTestId('boundary-attribution')).toBeNull();
    expect(items[0].textContent).not.toContain('geoBoundaries');
    // No per-area actions.
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says what a names-only sheet does, rather than "nothing in it"', () => {
    const names: BoundarySelection = { ...sheet, id: 'selection-3', boundaries: [], unnamed: [{ code: 'A', name: 'A' }, { code: 'B', name: 'B' }] };
    render(
      <ul>
        <BoundaryList draft={{ selections: [names] }} summarize={() => 'Nothing in it yet'} onEdit={vi.fn()} onRemove={vi.fn()} />
      </ul>,
    );
    expect(screen.getByText('Adds names to 2 areas already saved.')).toBeTruthy();
    expect(screen.queryByText('Nothing in it yet')).toBeNull();
  });

  it('Edit reopens the item', () => {
    const onEdit = vi.fn();
    renderList(onEdit);
    fireEvent.click(screen.getByRole('button', { name: 'Edit wards.xlsx' }));
    expect(onEdit).toHaveBeenCalledWith(sheet);
  });

  it('Remove takes the whole item off, after confirming', () => {
    const onRemove = vi.fn();
    renderList(undefined, onRemove);
    fireEvent.click(screen.getByRole('button', { name: 'Remove wards.xlsx' }));
    expect(screen.getByText('Remove wards.xlsx?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onRemove).toHaveBeenCalledWith(sheet);
  });

  it('Remove is unavailable while another item\'s areas sit inside it', () => {
    const onRemove = vi.fn();
    renderList(undefined, onRemove);
    const remove = screen.getByRole('button', { name: 'Remove Nairobi, Kenya' });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(remove);
    expect(screen.queryByText('Remove Nairobi, Kenya?')).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
