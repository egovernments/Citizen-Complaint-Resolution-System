import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MapPreview } from './MapConfigEditor';

// The preview draws real Leaflet in jsdom, so the credit line is the one the
// attribution control actually shows (#2804).
const credit = (container: HTMLElement) => container.querySelector('.leaflet-control-attribution')?.textContent ?? null;

describe('Map Configuration preview credit (#2804)', () => {
  it('shows the OpenStreetMap credit the citizen map shows', () => {
    const { container } = render(<MapPreview data={{ code: 'DEFAULT' }} setField={() => {}} />);
    expect(credit(container)).toMatch(/© OpenStreetMap contributors/);
  });

  it('follows a custom tile URL and its credit line', () => {
    const { container, rerender } = render(
      <MapPreview data={{ tileUrl: 'https://tiles.example.org/{z}/{x}/{y}.png' }} setField={() => {}} />,
    );
    expect(credit(container)).toMatch(/© tiles\.example\.org/);
    expect(credit(container)).not.toMatch(/OpenStreetMap contributors/);

    rerender(<MapPreview data={{ tileUrl: 'https://tiles.example.org/{z}/{x}/{y}.png', tileAttribution: 'Example tiles' }} setField={() => {}} />);
    expect(credit(container)).toMatch(/Example tiles/);
    expect(credit(container)).not.toMatch(/tiles\.example\.org/);
  });
});
