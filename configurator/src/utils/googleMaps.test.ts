import { afterEach, describe, expect, it } from 'vitest';
import { loadGoogleMaps, resetGoogleMapsForTests } from './googleMaps';

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
