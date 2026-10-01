import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawGeoJsonOnGoogleMap, loadGoogleMaps, resetGoogleMapsForTests, validateGoogleMapsKey } from './googleMaps';

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
        clearInstanceListeners() {},
      },
    },
  };
  return { google, maps };
}

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
