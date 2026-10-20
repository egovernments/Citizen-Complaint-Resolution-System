// @vitest-environment jsdom
//
// Dashboard "Workspace links" card: the employee and citizen app URLs, selectable and copyable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoreAdminContext } from 'ra-core';
import polyglotI18nProvider from 'ra-i18n-polyglot';

const { notifySpy, slug } = vi.hoisted(() => ({
  notifySpy: vi.fn(),
  slug: { value: 'acme' as string | null | undefined },
}));
vi.mock('@/resources/notification-providers/providerToast', () => ({ notify: notifySpy }));
vi.mock('../App', () => ({
  useApp: () => ({ state: { tenant: 'acme', environment: 'https://x.org' } }),
}));
vi.mock('@/identity/workspaceSlug', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/identity/workspaceSlug')>()),
  useWorkspaceSlug: () => slug.value,
}));

import { WorkspaceLinksCard } from './WorkspaceLinksCard';

const EMPLOYEE = 'https://x.org/acme/digit-ui/employee';
const CITIZEN = 'https://x.org/acme/digit-ui/citizen';
// No catalogue loaded: every string resolves to its inline English fallback.
const i18nProvider = polyglotI18nProvider(() => ({}), 'en', [], { allowMissing: true });
const renderCard = () => render(<CoreAdminContext i18nProvider={i18nProvider}><WorkspaceLinksCard /></CoreAdminContext>);
const writeText = vi.fn();

beforeEach(() => {
  slug.value = 'acme';
  notifySpy.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('WorkspaceLinksCard', () => {
  it('shows both urls with their labels', () => {
    renderCard();
    expect(screen.getByText('Employee app')).toBeTruthy();
    expect(screen.getByText('Citizen app')).toBeTruthy();
    expect(screen.getByText(EMPLOYEE)).toBeTruthy();
    expect(screen.getByText(CITIZEN)).toBeTruthy();
  });

  it('copies each url and toasts', async () => {
    renderCard();
    const [copyEmployee, copyCitizen] = screen.getAllByRole('button', { name: /copy/i });
    fireEvent.click(copyEmployee);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(EMPLOYEE));
    fireEvent.click(copyCitizen);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CITIZEN));
    expect(notifySpy).toHaveBeenCalledTimes(2);
  });

  it('opens each url in a new tab', () => {
    renderCard();
    const links = screen.getAllByRole('link', { name: /open/i });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([EMPLOYEE, CITIZEN]);
    links.forEach((l) => {
      expect(l.getAttribute('target')).toBe('_blank');
      expect(l.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  it('shows the copy-failed message when the clipboard rejects', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    renderCard();
    fireEvent.click(screen.getAllByRole('button', { name: /copy/i })[0]);
    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith('Could not copy to clipboard.', undefined, 'destructive'));
  });

  it.each([[null], [undefined]])('renders nothing when the slug is %s', (value) => {
    slug.value = value;
    const { container } = renderCard();
    expect(container.textContent).toBe('');
  });
});
