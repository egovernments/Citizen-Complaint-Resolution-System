import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from './HomePage';
import { LearnTheBasics } from './LearnTheBasics';
import { cardsPerPage } from './videoRow';
import { VideoDialog } from './VideoDialog';
import type { LearnVideo } from './homeContent';

const app = { state: { tenant: 'acme', targetTenant: 'acme', completedPhases: [] as number[] } };
vi.mock('@/App', () => ({ useApp: () => app }));

const page = () =>
  render(
    <MemoryRouter initialEntries={['/onboarding/home']}>
      <Routes>
        <Route path="/onboarding/home" element={<HomePage />} />
        <Route path="/onboarding/:step" element={<p>step page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  app.state.completedPhases = [];
  // src/test/setup.ts installs ResizeObserver as `vi.fn().mockImplementation(…)`,
  // which vitest 4 refuses to `new`. This one never reports a size, so the
  // video row keeps its default of four to a page.
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = TestResizeObserver;
});

describe('the Start here card', () => {
  it('starts a new account on Branding and says what comes after', () => {
    window.localStorage.setItem('ccrs-onboarding-welcome-seen:acme', '1');
    page();
    const card = screen.getByRole('region', { name: 'Branding' });
    expect(within(card).getByText(/start here/i)).toBeInTheDocument();
    expect(within(card).getByText(/0 of 5 completed/)).toBeInTheDocument();
    expect(within(card).getByText('After this: Geography — define the areas you cover.')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /set up branding/i }));
    expect(screen.getByText('step page')).toBeInTheDocument();
  });

  it('moves on to the first step not done, skipping done ones in "after this"', () => {
    window.localStorage.setItem('ccrs-onboarding-welcome-seen:acme', '1');
    app.state.completedPhases = [1, 2, 4];
    page();
    const card = screen.getByRole('region', { name: 'Departments' });
    expect(within(card).getByText(/up next/i)).toBeInTheDocument();
    expect(within(card).getByText(/3 of 5 completed/)).toBeInTheDocument();
    expect(within(card).getByText('After this: Complaints Template — set up what people can report.')).toBeInTheDocument();
  });
});

describe('the welcome', () => {
  it('opens by itself the first time, and not again once closed', () => {
    const { unmount } = page();
    expect(screen.getByRole('dialog')).toHaveTextContent('Welcome to the Complaint Management System');
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    page();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("opens from What's onboarding? and steps through every section", () => {
    window.localStorage.setItem('ccrs-onboarding-welcome-seen:acme', '1');
    page();
    fireEvent.click(screen.getByRole('button', { name: /what.s onboarding/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /previous/i })).toBeDisabled();
    for (let i = 0; i < 5; i++) fireEvent.click(within(dialog).getByRole('button', { name: /^next$/i }));
    expect(dialog).toHaveTextContent('What people can report');
    fireEvent.click(within(dialog).getByRole('button', { name: /get started/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Learn the basics', () => {
  it('fits one to four cards by width', () => {
    expect([0, 459, 460, 699, 700, 940, 2000].map(cardsPerPage)).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });

  it('pages through the videos and opens the one picked', () => {
    const videos: LearnVideo[] = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, title: `Video ${i + 1}`, summary: 's', tint: '' }));
    const onOpen = vi.fn();
    render(<LearnTheBasics videos={videos} onOpen={onOpen} />);
    expect(screen.getByText('1–4 of 6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous videos/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /more videos/i }));
    expect(screen.getByText('3–6 of 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play Video 6' }));
    expect(onOpen).toHaveBeenCalledWith(5);
  });

  it('plays a published video and says when one is not out yet', () => {
    const videos: LearnVideo[] = [
      { id: 'a', title: 'Published', summary: 's', youtubeId: 'abc123', tint: '' },
      { id: 'b', title: 'Not yet', summary: 's', tint: '' },
    ];
    const onIndexChange = vi.fn();
    const { rerender } = render(<VideoDialog videos={videos} index={0} onIndexChange={onIndexChange} onClose={vi.fn()} />);
    expect(screen.getByTitle('Published').getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc123?rel=0');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next video/i }));
    expect(onIndexChange).toHaveBeenCalledWith(1);
    rerender(<VideoDialog videos={videos} index={1} onIndexChange={onIndexChange} onClose={vi.fn()} />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next video/i })).toBeDisabled();
  });
});
