import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoundariesCreated } from './BoundariesCreated';

const base = {
  levels: ['Country', 'County', 'District'],
  hierarchyType: 'ADMIN',
  workspace: 'Monrovia City Corporation',
  sourceText: 'the official boundaries for Liberia (OCHA COD-AB)',
  onDone: vi.fn(),
};

describe('BoundariesCreated', () => {
  it('reports a full import level by level', () => {
    const { container } = render(
      <BoundariesCreated {...base} counts={{ Country: 1, County: 15, District: 136 }} total={152} attribution="Boundary data: OCHA COD-AB" />,
    );
    expect(container.querySelector('[data-outcome]')?.getAttribute('data-outcome')).toBe('created');
    expect(screen.getByText('Boundaries created')).toBeTruthy();
    const rows = screen.getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['LevelAreas', '1Country1', '2County15', '3District136', 'Total152']);
    expect(screen.getByText('Boundary data: OCHA COD-AB')).toBeTruthy();
    // The workspace by name, not its tenant code in capitals.
    expect(screen.getByTestId('boundaries-created').textContent).toContain('hierarchy on Monrovia City Corporation, from');
  });

  it('does not call a total failure a success', () => {
    // What a polygon with a hole used to cause: the country refused, then every area under it.
    const { container } = render(<BoundariesCreated {...base} counts={{}} total={0} failed={152} />);
    expect(container.querySelector('[data-outcome]')?.getAttribute('data-outcome')).toBe('failed');
    expect(screen.queryByText('Boundaries created')).toBeNull();
    expect(screen.getByText('No boundaries were created')).toBeTruthy();
    expect(screen.getByText(/All 152 areas from the official boundaries for Liberia/)).toBeTruthy();
  });

  it('says how many failed when only some did', () => {
    render(<BoundariesCreated {...base} counts={{ Country: 1, County: 15, District: 133 }} total={149} failed={3} skipped={2} />);
    expect(screen.getByText('Some boundaries were not created')).toBeTruthy();
    expect(screen.getByText(/3 areas could not be created/)).toBeTruthy();
    expect(screen.getByText(/2 areas were left out/)).toBeTruthy();
  });
});
