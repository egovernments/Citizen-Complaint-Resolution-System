import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import sets from '@/utils/__fixtures__/officialSets.json';
import type { OfficialSet } from '@/utils/officialBoundaries';
import { OfficialSetSummary } from './OfficialConfidence';

const KE = (sets as unknown as Record<string, OfficialSet>).KE;

describe('OfficialSetSummary', () => {
  it('says the comparison failed when it did, rather than blaming old data', () => {
    render(<OfficialSetSummary set={{ ...KE, agreement_measured: false, agreement_failed: true }} />);
    const text = screen.getByTestId('official-set-summary').textContent ?? '';
    expect(text).toContain('The agreement check failed when this boundary data was built');
    expect(text).not.toContain('predates');
  });

  it('says the data predates the check on an old DB', () => {
    render(<OfficialSetSummary set={{ ...KE, agreement_measured: false }} />);
    expect(screen.getByTestId('official-set-summary').textContent).toContain('predates the agreement check');
  });
});
