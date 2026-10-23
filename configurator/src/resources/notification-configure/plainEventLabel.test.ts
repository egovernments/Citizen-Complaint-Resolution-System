import { describe, expect, it } from 'vitest';
import { plainEventLabel } from './eventCatalogue';

// cfgreview F26 (#1572): events read in words; the codes are on hover.
describe('plainEventLabel', () => {
  it('drops a trailing status code', () => {
    expect(plainEventLabel('Complaint assigned (PENDINGATLME)')).toBe('Complaint assigned');
    expect(plainEventLabel('Complaint filed (PENDINGFORASSIGNMENT)')).toBe('Complaint filed');
  });
  it('keeps labels without a code, and a label that is only a code', () => {
    expect(plainEventLabel('Complaint resolved')).toBe('Complaint resolved');
    expect(plainEventLabel('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME')).toBe('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME');
    expect(plainEventLabel('(PENDINGATLME)')).toBe('(PENDINGATLME)');
  });
});
