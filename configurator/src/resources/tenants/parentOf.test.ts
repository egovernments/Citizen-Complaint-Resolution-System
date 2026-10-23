import { describe, expect, it } from 'vitest';
import { parentOf } from './parentOf';

// cfgreview F07 (#1554): the Tenants list shows where each tenant sits.
describe('parentOf', () => {
  it('drops the last segment', () => {
    expect(parentOf('ke.bomet.health')).toBe('ke.bomet');
    expect(parentOf('ke.bomet')).toBe('ke');
    expect(parentOf('ke')).toBe('');
  });
});
