import { describe, expect, it } from 'vitest';
import { previewBody, previewError, previewSentence, type PreviewAnswer } from './rolePreviewModel';

// cfgreview F12 / PM 5 (#1558): preview what a role lets someone see at a tenant.
describe('role preview', () => {
  it('sends the role at the tenant with the areas, de-duplicated and capped at 50', () => {
    expect(previewBody({ tenantId: 'ke.bomet', role: 'GRO', areas: [' W1', 'W1', ''] }, { x: 1 })).toEqual({ RequestInfo: { x: 1 }, tenantId: 'ke.bomet', role: 'GRO', areas: ['W1'] });
    expect(previewBody({ tenantId: 'ke', role: 'GRO', areas: [] }, {})).toEqual({ RequestInfo: {}, tenantId: 'ke', role: 'GRO' });
    expect((previewBody({ tenantId: 'ke', role: 'R', areas: Array.from({ length: 60 }, (_, i) => `A${i}`) }, {}) as { areas: string[] }).areas).toHaveLength(50);
  });
  it('says what the holder would see', () => {
    const a: PreviewAnswer = { tenantId: 'ke.bomet', role: { code: 'GRO', tenantId: 'ke.bomet' }, count: 12, total: 274, samples: [], filter: { tenant_wide: false }, areas: ['W1'] };
    expect(previewSentence(a)).toBe('Someone with GRO here would see 12 of the 274 complaints at ke.bomet (areas W1).');
    expect(previewSentence({ ...a, count: 274, filter: { tenant_wide: true } })).toMatch(/every complaint/);
    expect(previewSentence({ ...a, count: 0, areas: [] })).toMatch(/add areas/);
  });
  it('turns refusals into words', () => {
    expect(previewError('429 ACCESS_PREVIEW_RATE_LIMITED')).toMatch(/Too many/);
    expect(previewError('503 ACCESS_PREVIEW_NEEDS_OPA')).toMatch(/OPA/);
    expect(previewError('HTTP 403')).toMatch(/administrator/);
    expect(previewError('AccessDeniedException')).toMatch(/refused the preview \(AccessDeniedException\)/);
    expect(previewError('ACCESS_PREVIEW_INVALID_AREAS')).toBe('The preview refused the areas.');
  });
});
