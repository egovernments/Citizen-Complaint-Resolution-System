import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingLayout from './OnboardingLayout';
import { ONBOARDING_STEPS } from './steps';
import { DIGIT_DOCS, DOCS_HOME, ONBOARDING_GUIDE, docsFor } from './docs/docsLinks';
import { englishT } from './i18n';

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

const realMatchMedia = window.matchMedia;
/** Every media query matches (a wide window) or none does. */
function windowIsWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const rail = () => screen.getByRole('complementary', { name: 'Documentation' });

beforeEach(() => {
  trackEvent.mockClear();
  window.localStorage.clear();
  app.state.completedPhases = [];
  windowIsWide(false);
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe('the docs content', () => {
  it('lists guides for Home and every step, each to the docs and in English', () => {
    for (const section of ['home', ...ONBOARDING_STEPS.map((step) => step.id)] as const) {
      const groups = docsFor(section, englishT);
      expect(groups.length).toBeGreaterThan(0);
      for (const link of groups.flatMap((group) => group.links)) {
        expect(link.url.startsWith(DOCS_HOME)).toBe(true);
        expect(link.title).not.toBe('');
        expect(link.description).not.toBe('');
      }
    }
  });

  it('carries the onboarding guide on every page, and each step its own page of it', () => {
    const page = { branding: 'branding', geography: 'geography', departments: 'departments', employees: 'employees', complaints: 'complaint-template' };
    for (const section of ['home', ...ONBOARDING_STEPS.map((step) => step.id)] as const) {
      const urls = docsFor(section, englishT).flatMap((group) => group.links.map((link) => link.url));
      expect(urls).toContain(ONBOARDING_GUIDE);
      if (section !== 'home') expect(docsFor(section, englishT)[0].links[0].url).toBe(`${ONBOARDING_GUIDE}/${page[section]}`);
    }
    expect(docsFor('home', englishT)[0].links.map((link) => link.url)).toEqual([
      `${ONBOARDING_GUIDE}/get-started`,
      `${ONBOARDING_GUIDE}/onboarding`,
      `${ONBOARDING_GUIDE}/create-account`,
      `${ONBOARDING_GUIDE}/glossary`,
    ]);
  });
});

describe('the Documentation rail', () => {
  it('sits beside the page on a wide window, with the section on screen', () => {
    windowIsWide(true);
    app.state.completedPhases = [1, 2, 3];
    layoutAt('/onboarding/employees');
    const link = within(rail()).getByRole('link', { name: 'Employees guide (opens in a new tab)' });
    expect(link).toHaveAttribute('href', `${ONBOARDING_GUIDE}/employees`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(rail()).getByRole('link', { name: 'Open DIGIT Docs' })).toHaveAttribute('href', DIGIT_DOCS);
    fireEvent.click(link);
    expect(trackEvent).toHaveBeenCalledWith('docs_click', { from: 'onboarding_docs', section: 'employees', link: 'employees' });
  });

  it('remembers being closed', () => {
    windowIsWide(true);
    const { unmount } = layoutAt('/onboarding/home');
    fireEvent.click(within(rail()).getByRole('button', { name: 'Hide documentation' }));
    expect(within(rail()).queryByRole('link', { name: /Setting up your account/ })).not.toBeInTheDocument();
    unmount();

    layoutAt('/onboarding/home');
    expect(within(rail()).getByRole('button', { name: 'Show documentation' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(rail()).queryByRole('link', { name: /Setting up your account/ })).not.toBeInTheDocument();
  });

  it('waits as a strip on a narrower window and opens over the page', () => {
    layoutAt('/onboarding/branding');
    expect(within(rail()).queryByRole('link', { name: /Branding guide/ })).not.toBeInTheDocument();
    fireEvent.click(within(rail()).getByRole('button', { name: 'Show documentation' }));
    expect(within(rail()).getByRole('link', { name: 'Branding guide (opens in a new tab)' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(rail()).queryByRole('link', { name: /Branding guide/ })).not.toBeInTheDocument();
  });

  it('follows the account back on a locked step, not the step typed', () => {
    windowIsWide(true);
    layoutAt('/onboarding/complaints');
    expect(within(rail()).getByRole('link', { name: /^Branding guide/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Complaints template guide/ })).not.toBeInTheDocument();
  });

  it('opens as a sheet from the top bar on a phone', () => {
    layoutAt('/onboarding/branding');
    fireEvent.click(screen.getAllByRole('button', { name: 'Documentation' })[0]);
    const sheet = screen.getByRole('dialog', { name: 'Documentation' });
    expect(within(sheet).getByRole('link', { name: 'Branding guide (opens in a new tab)' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Open DIGIT Docs' })).toBeInTheDocument();
  });
});

describe('the setup card', () => {
  const card = () => screen.getByRole('region', { name: /^Next step:/ });

  it('starts at Branding with nothing done', () => {
    layoutAt('/onboarding/home');
    expect(card()).toHaveTextContent('Next step: Branding');
    expect(card()).toHaveTextContent('Set up your account logo, name and appearance');
    expect(within(card()).queryByText(/ done$/)).not.toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Set Up Branding' })).toBeInTheDocument();
  });

  it.each([
    [[1], 'Branding done', 'Next step: Geography', 'Define Geography'],
    [[1, 2], 'Geography done', 'Next step: Departments', 'Add Departments'],
    [[1, 2, 3], 'Departments done', 'Next step: Employees', 'Add Employees'],
    [[1, 2, 3, 4], 'Employees done', 'Next step: Complaints Template', 'Choose Template'],
  ])('after %j says %s, %s, with %s', (done, previous, next, action) => {
    app.state.completedPhases = done;
    layoutAt('/onboarding/home');
    expect(within(card()).getByText(previous)).toBeInTheDocument();
    expect(card()).toHaveTextContent(next);
    expect(within(card()).getByRole('button', { name: action })).toBeInTheDocument();
  });

  it('opens the next step', () => {
    app.state.completedPhases = [1];
    layoutAt('/onboarding/home');
    fireEvent.click(within(card()).getByRole('button', { name: 'Define Geography' }));
    expect(card()).toHaveTextContent('Next step: Geography');
    expect(screen.getByText('page')).toBeInTheDocument();
  });
});
