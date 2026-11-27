import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drawGeoJsonOnGoogleMap,
  GoogleKeyRejectedError,
  loadGoogleMaps,
  resetGoogleMapsForTests,
  validateGoogleMapsKey,
} from './googleMaps';

afterEach(() => resetGoogleMapsForTests());

describe('loadGoogleMaps', () => {
  it('needs a key', async () => {
    await expect(loadGoogleMaps('  ')).rejects.toThrow(/Enter a Google Maps API key/);
  });

  it('loads the script once per key, with the key URL-encoded', () => {
    const p1 = loadGoogleMaps('abc 123');
    const p2 = loadGoogleMaps('abc 123');
    expect(p2).toBe(p1);
    const scripts = document.querySelectorAll('script[src*="maps.googleapis.com"]');
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toContain('key=abc%20123');
  });

  it('refuses a second, different key — Google allows one per page load', async () => {
    void loadGoogleMaps('first');
    await expect(loadGoogleMaps('second')).rejects.toThrow(/reload the page/);
  });
});

// A stand-in for the Maps JavaScript API: enough for the draw and the key check.
/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeGoogle() {
  const maps: any[] = [];
  const cleared: any[] = [];
  class FakeMap {
    listeners: Record<string, () => void> = {};
    data = {
      addGeoJson() {},
      setStyle() {},
      forEach() {},
      addListener: () => ({ remove() {} }),
    };
    div: HTMLElement;
    constructor(div: HTMLElement) {
      this.div = div;
      div.appendChild(document.createElement('canvas'));
      maps.push(this);
    }
    setCenter() {}
    setZoom() {}
    fitBounds() {}
  }
  const google = {
    maps: {
      Map: FakeMap,
      LatLngBounds: class {
        extend() {}
        isEmpty() {
          return true;
        }
      },
      InfoWindow: class {
        close() {}
      },
      event: {
        addListenerOnce: (map: FakeMap, name: string, fn: () => void) => {
          map.listeners[name] = fn;
        },
        clearInstanceListeners: (map: FakeMap) => {
          map.listeners = {};
          cleared.push(map);
        },
      },
    },
  };
  return { google, maps, cleared };
}

const mapsScripts = () =>
  [...document.querySelectorAll<HTMLScriptElement>('script[src*="maps.googleapis.com"]')];

/** Starts a load, then answers it the way Google's script does. */
function loadWithFake(key = 'key') {
  const fake = fakeGoogle();
  const pending = loadGoogleMaps(key);
  (window as any).google = fake.google;
  (window as any).__ccrsGoogleMapsReady();
  return { fake, pending };
}

describe('validateGoogleMapsKey', () => {
  afterEach(() => vi.useRealTimers());

  it('is ok only once tiles load and no auth failure follows', async () => {
    vi.useFakeTimers();
    const { fake } = loadWithFake();
    const check = validateGoogleMapsKey('key', { timeoutMs: 8000, graceMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    fake.maps[0].listeners.tilesloaded();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(check).resolves.toBe('ok');
  });

  it('reports a timeout as unverified, not as accepted', async () => {
    vi.useFakeTimers();
    loadWithFake();
    const check = validateGoogleMapsKey('key', { timeoutMs: 8000, graceMs: 1000 });
    await vi.advanceTimersByTimeAsync(8000);
    await expect(check).resolves.toBe('unverified');
  });

  // Google authenticates (and renders) only a map inside the viewport with a
  // real size: an offscreen probe got no verdict, so every key, even junk, came
  // back 'unverified' and was saved.
  it('draws the probe map inside the viewport with a real size, invisible and inert', async () => {
    vi.useFakeTimers();
    const { fake } = loadWithFake();
    const check = validateGoogleMapsKey('key', { timeoutMs: 8000, graceMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const probe = fake.maps[0].div as HTMLElement;
    expect(probe.isConnected).toBe(true);
    // The map fills a holder that carries the placement, so Google rewriting the
    // map div's own position (it sets relative) can't push it below the page.
    expect(probe.style.width).toBe('100%');
    expect(probe.style.height).toBe('100%');
    const holder = probe.parentElement as HTMLElement;
    expect(holder.parentElement).toBe(document.body);
    probe.style.position = 'relative';
    const style = holder.style;
    expect(style.position).toBe('fixed');
    expect(style.display).not.toBe('none');
    for (const edge of [style.top, style.left]) {
      expect(parseFloat(edge)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(edge)).toBeLessThan(50);
    }
    expect(parseFloat(style.width)).toBeGreaterThan(0);
    expect(parseFloat(style.height)).toBeGreaterThan(0);
    expect(style.opacity).toBe('0');
    expect(style.pointerEvents).toBe('none');
    expect(holder.hasAttribute('inert')).toBe(true);
    expect(holder.getAttribute('aria-hidden')).toBe('true');
    await vi.advanceTimersByTimeAsync(8000);
    await expect(check).resolves.toBe('unverified');
    expect(holder.isConnected).toBe(false);
  });

  it('rejects as soon as Google refuses the key, saying what to fix', async () => {
    vi.useFakeTimers();
    const { fake } = loadWithFake();
    const check = validateGoogleMapsKey('key', { timeoutMs: 8000, graceMs: 1000 });
    let error: Error | undefined;
    check.catch((e: Error) => { error = e; });
    await vi.advanceTimersByTimeAsync(0);
    const holder = (fake.maps[0].div as HTMLElement).parentElement as HTMLElement;
    expect(holder.isConnected).toBe(true);
    (window as any).gm_authFailure();
    await vi.advanceTimersByTimeAsync(0);
    expect(error?.message).toMatch(/Google rejected this API key/);
    expect(error?.message).toMatch(/enable the Maps JavaScript API/);
    expect(error?.message).toContain(`allow this site (${window.location.host}) in its HTTP-referrer restrictions`);
    // Typed, so onboarding can show it in the operator's language.
    expect(error).toBeInstanceOf(GoogleKeyRejectedError);
    expect((error as GoogleKeyRejectedError).site).toBe(window.location.host);
    // A refused key leaves no probe behind.
    expect(holder.isConnected).toBe(false);
  });

  it('disposes the probe map, and tiles that arrive after the verdict start no timer', async () => {
    vi.useFakeTimers();
    const { fake } = loadWithFake();
    const check = validateGoogleMapsKey('key', { timeoutMs: 8000, graceMs: 1000 });
    const settled = expect(check).rejects.toThrow(GoogleKeyRejectedError);
    await vi.advanceTimersByTimeAsync(0);
    const probeMap = fake.maps[0];
    const lateTiles = probeMap.listeners.tilesloaded;
    (window as any).gm_authFailure();
    await settled;
    expect(fake.cleared).toEqual([probeMap]);
    lateTiles();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits 2.5 s after the tiles for a refusal before calling a key ok', async () => {
    vi.useFakeTimers();
    const { fake } = loadWithFake();
    const check = validateGoogleMapsKey('key');
    const settled = expect(check).rejects.toThrow(GoogleKeyRejectedError);
    await vi.advanceTimersByTimeAsync(0);
    fake.maps[0].listeners.tilesloaded();
    await vi.advanceTimersByTimeAsync(2400);
    (window as any).gm_authFailure();
    await settled;
  });

  it('rejects when Google refuses the key, even after the tiles loaded', async () => {
    vi.useFakeTimers();
    const { fake } = loadWithFake();
    const check = validateGoogleMapsKey('key', { timeoutMs: 8000, graceMs: 1000 });
    const settled = expect(check).rejects.toThrow(/Google rejected this API key/);
    await vi.advanceTimersByTimeAsync(0);
    fake.maps[0].listeners.tilesloaded();
    (window as any).gm_authFailure();
    await settled;
  });
});

// Before the probe could see a refusal, a refused key stayed loaded: a corrected key got "reload the
// page", and the same key, once fixed in Cloud Console, was refused again without asking Google.
describe('validateGoogleMapsKey after Google refused a key', () => {
  afterEach(() => vi.useRealTimers());

  /** Checks `key` against a Google that refuses it; resolves to the script that loaded it. */
  async function refuse(key: string) {
    loadWithFake(key);
    const [script] = mapsScripts();
    const check = validateGoogleMapsKey(key, { timeoutMs: 8000, graceMs: 1000 });
    const settled = expect(check).rejects.toThrow(GoogleKeyRejectedError);
    await vi.advanceTimersByTimeAsync(0);
    (window as any).gm_authFailure();
    await settled;
    return script;
  }

  /** Checks `key` against a fresh Google that accepts it. */
  async function accept(key: string) {
    const check = validateGoogleMapsKey(key, { timeoutMs: 8000, graceMs: 1000 });
    const { fake } = loadWithFake(key);
    await vi.advanceTimersByTimeAsync(0);
    fake.maps[0].listeners.tilesloaded();
    await vi.advanceTimersByTimeAsync(1000);
    return check;
  }

  it('unloads the refused key, so the next check starts from a clean page', async () => {
    vi.useFakeTimers();
    await refuse('AIzaCutOff');
    expect(mapsScripts()).toEqual([]);
    expect((window as any).google).toBeUndefined();
  });

  it('checks a corrected key with Google, with no page reload', async () => {
    vi.useFakeTimers();
    await refuse('AIzaCutOff');
    await expect(accept('AIzaCutOffKeyInFull')).resolves.toBe('ok');
    expect(mapsScripts().map((s) => new URL(s.src).searchParams.get('key'))).toEqual(['AIzaCutOffKeyInFull']);
  });

  it('asks Google again about the same key, once it is allowed in Cloud Console', async () => {
    vi.useFakeTimers();
    const refused = await refuse('AIzaKey');
    expect(refused).toBeDefined();
    await expect(accept('AIzaKey')).resolves.toBe('ok');
    expect(mapsScripts()).toHaveLength(1);
    expect(mapsScripts()[0]).not.toBe(refused);
  });

  it('lets a map draw with another key after a refused check, with no page reload', async () => {
    vi.useFakeTimers();
    await refuse('AIzaTypo');
    const container = document.createElement('div');
    const draw = drawGeoJsonOnGoogleMap(container, { type: 'FeatureCollection', features: [] }, '#000', 'AIzaSavedKey');
    loadWithFake('AIzaSavedKey');
    const dispose = await draw;
    expect(container.childElementCount).toBe(1);
    dispose();
  });

  it('asks Google again about a key it refused under a drawn map', async () => {
    vi.useFakeTimers();
    const { pending } = loadWithFake('AIzaKey');
    await pending;
    const onAuthFailure = vi.fn();
    await drawGeoJsonOnGoogleMap(document.createElement('div'), { type: 'FeatureCollection', features: [] }, '#000', 'AIzaKey', { onAuthFailure });
    (window as any).gm_authFailure();
    expect(onAuthFailure).toHaveBeenCalled();
    await expect(accept('AIzaKey')).resolves.toBe('ok');
  });
});

describe('drawGeoJsonOnGoogleMap', () => {
  const fc = { type: 'FeatureCollection', features: [] };

  it('creates nothing for a draw cancelled while the API loaded', async () => {
    const { fake, pending } = loadWithFake();
    await pending;
    const container = document.createElement('div');
    const dispose = await drawGeoJsonOnGoogleMap(container, fc, '#000', 'key', { isCancelled: () => true });
    expect(fake.maps).toHaveLength(0);
    expect(container.childElementCount).toBe(0);
    dispose();
  });

  it("disposing one draw leaves another draw's map in the container", async () => {
    const { pending } = loadWithFake();
    await pending;
    const container = document.createElement('div');
    const first = await drawGeoJsonOnGoogleMap(container, fc, '#000', 'key');
    await drawGeoJsonOnGoogleMap(container, fc, '#000', 'key');
    expect(container.childElementCount).toBe(2);
    first();
    expect(container.childElementCount).toBe(1);
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('reports a key Google rejects after the map is drawn', async () => {
    const { pending } = loadWithFake();
    await pending;
    const onAuthFailure = vi.fn();
    const dispose = await drawGeoJsonOnGoogleMap(document.createElement('div'), fc, '#000', 'key', { onAuthFailure });
    (window as any).gm_authFailure();
    expect(onAuthFailure).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/rejected/) }));
    dispose();
  });
});
