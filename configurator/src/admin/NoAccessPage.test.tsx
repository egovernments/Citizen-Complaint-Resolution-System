import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NoAccessPage, NO_ACCESS_SETTLE_MS } from './NoAccessPage';

// a screen the role may not use rendered an empty page (react-admin's default catch-all)
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('says the page is not available to the role, after the policy has had time to load', () => {
  render(<MemoryRouter><NoAccessPage /></MemoryRouter>);
  expect(screen.queryByRole('alert')).toBeNull();
  act(() => { vi.advanceTimersByTime(NO_ACCESS_SETTLE_MS); });
  expect(screen.getByRole('alert').textContent).toMatch(/permission/i);
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeTruthy();
});

it('is the management app\'s catch-all', () => {
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
  expect(app).toMatch(/<CoreAdminUI[^>]*catchAll=\{NoAccessPage\}/);
});
