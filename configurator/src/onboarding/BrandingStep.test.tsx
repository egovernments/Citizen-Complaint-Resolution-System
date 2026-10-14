import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdmsRecord } from '@/api/types';
import BrandingStep from './BrandingStep';
import { loadBranding, saveBranding, type Branding } from './brandingApi';

const flags = vi.hoisted(() => ({ banner: false }));
vi.mock('@/config/featureFlags', () => ({
  get CITIZEN_BANNER_ENABLED() {
    return flags.banner;
  },
}));

const app = { state: { tenant: 'acme', completedPhases: [] as number[] }, completePhase: vi.fn(async () => true) };
vi.mock('@/App', () => ({ useApp: () => app }));

vi.mock('./brandingApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./brandingApi')>()),
  loadBranding: vi.fn(),
  saveBranding: vi.fn(),
}));
const load = vi.mocked(loadBranding);
const save = vi.mocked(saveBranding);

const record = (schemaCode: string, data: Record<string, unknown>): MdmsRecord => ({
  id: schemaCode,
  tenantId: 'acme',
  schemaCode,
  uniqueIdentifier: 'acme',
  data,
  isActive: true,
});

const branding = (over: Partial<Branding> = {}): Branding => ({
  tenantId: 'acme',
  tenantRecord: record('tenant.tenants', { code: 'acme', name: 'Acme Council' }),
  themeRecord: null,
  stateInfoRecord: record('common-masters.StateInfo', { code: 'acme', bannerUrl: '' }),
  name: 'Acme Council',
  logoUrl: null,
  bannerUrl: null,
  themeId: 'cms-blue',
  ...over,
});

// jsdom neither decodes images nor makes object URLs: the next image "loads"
// at whatever size the test sets.
const nextImage = { width: 2400, height: 800 };
class TestImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) {
    this.naturalWidth = nextImage.width;
    this.naturalHeight = nextImage.height;
    queueMicrotask(() => this.onload?.());
  }
}
const realImage = globalThis.Image;

const page = () =>
  render(
    <MemoryRouter>
      <BrandingStep />
    </MemoryRouter>,
  );

const pick = (name = 'banner.jpg', type = 'image/jpeg') =>
  fireEvent.change(screen.getByTestId('banner-input'), { target: { files: [new File(['x'], name, { type })] } });

beforeEach(() => {
  vi.clearAllMocks();
  flags.banner = true;
  Object.assign(nextImage, { width: 2400, height: 800 });
  (globalThis as unknown as { Image: unknown }).Image = TestImage;
  URL.createObjectURL = vi.fn(() => 'blob:banner');
  URL.revokeObjectURL = vi.fn();
  load.mockResolvedValue(branding());
  save.mockImplementation(async (current) => current);
});

afterEach(() => {
  (globalThis as unknown as { Image: unknown }).Image = realImage;
});

describe('the citizen banner in Branding', () => {
  it('is not offered while the feature flag is off, and nothing is sent for it', async () => {
    flags.banner = false;
    page();
    await screen.findByText('Account logo');
    expect(screen.queryByText('Citizen home banner')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].banner).toBeNull();
  });

  it('says why when the workspace has no StateInfo to keep a banner in', async () => {
    load.mockResolvedValue(branding({ stateInfoRecord: null }));
    page();
    expect(await screen.findByText(/no State Info record/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload banner/i })).not.toBeInTheDocument();
  });

  it('turns away a narrow or square image and keeps a wide one', async () => {
    page();
    await screen.findByText('No banner yet.');

    Object.assign(nextImage, { width: 1000, height: 300 });
    pick();
    expect(await screen.findByText('That image is 1000px wide. Use one at least 1200px wide.')).toBeInTheDocument();

    Object.assign(nextImage, { width: 1600, height: 1200 });
    pick();
    expect(await screen.findByText('That image is 1600×1200px. Use a wide, landscape image.')).toBeInTheDocument();

    pick('banner.gif', 'image/gif');
    expect(await screen.findByText('Use a PNG or JPG image.')).toBeInTheDocument();

    Object.assign(nextImage, { width: 2400, height: 800 });
    pick();
    const preview = await screen.findByRole('img', { name: 'Citizen home banner' });
    expect(preview).toHaveAttribute('src', 'blob:banner');
    expect(screen.queryByText(/Use a/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const banner = save.mock.calls[0][1].banner;
    expect(banner?.kind).toBe('upload');
  });

  it('removes a saved banner on save', async () => {
    load.mockResolvedValue(branding({ bannerUrl: 'https://img/banner.jpg' }));
    page();
    expect(await screen.findByRole('img', { name: 'Citizen home banner' })).toHaveAttribute('src', 'https://img/banner.jpg');
    // The logo has no image, so the only Remove is the banner's.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('img', { name: 'Citizen home banner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].banner).toEqual({ kind: 'remove' });
  });
});
