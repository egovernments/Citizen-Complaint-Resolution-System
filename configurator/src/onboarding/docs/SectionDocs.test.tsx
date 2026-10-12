import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingLayout from '../OnboardingLayout';
import { ONBOARDING_STEPS } from '../steps';
import { DOCS_HOME, SECTION_DOCS } from './docsLinks';
import { SectionDocs } from './SectionDocs';

const trackEvent = vi.fn();
vi.mock('@/lib/telemetry', () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

const app = { state: { tenant: 'acme', user: { name: 'Admin' }, completedPhases: [] as number[] }, logout: vi.fn(), toggleHelp: vi.fn() };
vi.mock('@/App', () => ({ useApp: () => app }));
vi.mock('@/hooks/useMastersCapability', () => ({ useMastersCapability: () => ({ canEditResource: () => true }) }));
vi.mock('@/components/layout/HeaderControls', () => ({
  HelpButton: () => null,
  LocaleSwitcher: () => null,
  ThemeSwitcher: () => null,
  AccountMenu: () => null,
}));

const layoutAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<OnboardingLayout />}>
          <Route path="/onboarding/:section" element={<p>page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
const docs = () => screen.queryByRole('complementary', { name: 'Documentation' });

beforeEach(() => {
  trackEvent.mockClear();
  app.state.completedPhases = [];
});

describe('the docs links', () => {
  it('has a guide for Home and every step', () => {
    expect(Object.keys(SECTION_DOCS).sort()).toEqual(['home', ...ONBOARDING_STEPS.map((step) => step.id)].sort());
  });

  it("links the section's guide and all the docs, each in a new tab", () => {
    render(<SectionDocs section="employees" />);
    const guide = screen.getByRole('link', { name: 'Employees guide (opens in a new tab)' });
    const all = screen.getByRole('link', { name: 'All documentation (opens in a new tab)' });
    expect(guide).toHaveAttribute('href', SECTION_DOCS.employees);
    expect(all).toHaveAttribute('href', DOCS_HOME);
    for (const link of [guide, all]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    fireEvent.click(guide);
    expect(trackEvent).toHaveBeenCalledWith('docs_click', { from: 'onboarding_docs', section: 'employees', link: 'guide' });
  });

  it('calls the Home guide the getting started guide', () => {
    render(<SectionDocs section="home" />);
    expect(screen.getByRole('link', { name: /^Getting started guide/ })).toHaveAttribute('href', SECTION_DOCS.home);
  });
});

describe('the docs in the onboarding layout', () => {
  it('follow the section on screen', () => {
    app.state.completedPhases = [1, 2, 3];
    const { unmount } = layoutAt('/onboarding/home');
    expect(within(docs()!).getByRole('link', { name: /^Getting started guide/ })).toBeInTheDocument();
    unmount();
    layoutAt('/onboarding/employees');
    expect(within(docs()!).getByRole('link', { name: /^Employees guide/ })).toBeInTheDocument();
  });

  it("on a locked step, follow the account back to where it was, not the step's guide", () => {
    layoutAt('/onboarding/complaints');
    expect(within(docs()!).getByRole('link', { name: /^Branding guide/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Complaints Template guide/ })).not.toBeInTheDocument();
  });
});
