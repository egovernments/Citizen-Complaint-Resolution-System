// Google Maps JavaScript API, for tenants whose MapConfig sets
// mapProvider: 'google' (#1994). Loaded on demand — a tenant on the default
// OpenStreetMap tiles never downloads it.
//
// Two constraints shape this file:
//  - Google allows one API key per page load. Asking for a second key can't
//    work, so it is reported ("reload the page") rather than silently ignored.
//  - A bad key doesn't fail the script load. Google calls window.gm_authFailure
//    later, once a map tries to authenticate — so validateGoogleMapsKey() draws
//    an offscreen map and waits for a verdict, and every drawn map keeps
//    listening for one.
//
// Boundaries still come from turbopass: Google does not expose administrative
// boundary polygons through its APIs. This only changes the map they are
// drawn on.

/* eslint-disable @typescript-eslint/no-explicit-any -- the Maps API is loaded at runtime, untyped */
type GoogleNs = any;

const CALLBACK = '__ccrsGoogleMapsReady';

let loaded: { key: string; promise: Promise<GoogleNs> } | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

function authError(): Error {
  return new Error(
    'Google rejected this API key. Enable the Maps JavaScript API for it and allow this site in its HTTP-referrer restrictions.',
  );
}

export function loadGoogleMaps(apiKey: string): Promise<GoogleNs> {
  const key = apiKey.trim();
  if (!key) return Promise.reject(new Error('Enter a Google Maps API key.'));
  if (loaded) {
    if (loaded.key === key) return loaded.promise;
    return Promise.reject(
      new Error('This page already loaded Google Maps with a different key — reload the page to use the new one.'),
    );
  }
  const w = window as any;
  w.gm_authFailure = () => {
    authFailed = true;
    authListeners.forEach((fn) => fn());
  };
  const promise = new Promise<GoogleNs>((resolve, reject) => {
    w[CALLBACK] = () => resolve(w.google);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${CALLBACK}`;
    script.async = true;
    script.onerror = () => {
      loaded = null;
      script.remove();
      reject(new Error("Couldn't download the Google Maps JavaScript API — check the network."));
    };
    document.head.appendChild(script);
  });
  loaded = { key, promise };
  return promise;
}

/**
 * What Google said about a key. `ok` needs a positive signal — the probe map's
 * tiles loaded and no auth failure followed within `graceMs`. `unverified`
 * means Google gave no verdict within `timeoutMs` (a slow network can report a
 * restricted or disabled key later), so the caller must not present it as
 * accepted. Rejects with the reason when Google refuses the key.
 */
export type GoogleKeyCheck = 'ok' | 'unverified';

export async function validateGoogleMapsKey(
  apiKey: string,
  { timeoutMs = 8000, graceMs = 1000 }: { timeoutMs?: number; graceMs?: number } = {},
): Promise<GoogleKeyCheck> {
  const g = await loadGoogleMaps(apiKey);
  if (authFailed) throw authError();
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;width:10px;height:10px';
  document.body.appendChild(probe);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let onFail = () => {};
  try {
    return await new Promise<GoogleKeyCheck>((resolve, reject) => {
      onFail = () => reject(authError());
      authListeners.add(onFail);
      timers.push(setTimeout(() => resolve('unverified'), timeoutMs));
      const map = new g.maps.Map(probe, { center: { lat: 0, lng: 0 }, zoom: 1 });
      g.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        timers.push(setTimeout(() => resolve('ok'), graceMs));
      });
    });
  } finally {
    timers.forEach(clearTimeout);
    authListeners.delete(onFail);
    probe.remove();
  }
}

export interface GoogleDrawOptions {
  /** Checked once the API has loaded: a draw cancelled meanwhile creates nothing. */
  isCancelled?: () => boolean;
  /** Google rejected the key after the map was drawn — fall back to another map. */
  onAuthFailure?: (error: Error) => void;
}

/**
 * Draws a GeoJSON FeatureCollection on a Google map inside `container`;
 * resolves to a cleanup. Each draw owns a child element of the container, so
 * cleaning up one draw never touches a map another draw put there.
 */
export async function drawGeoJsonOnGoogleMap(
  container: HTMLElement,
  featureCollection: object,
  color: string,
  apiKey: string,
  { isCancelled, onAuthFailure }: GoogleDrawOptions = {},
): Promise<() => void> {
  const g = await loadGoogleMaps(apiKey);
  if (isCancelled?.()) return () => {};
  if (authFailed) throw authError();
  const host = document.createElement('div');
  host.style.cssText = 'width:100%;height:100%';
  container.appendChild(host);
  const map = new g.maps.Map(host, {
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: 'cooperative',
  });
  map.data.addGeoJson(featureCollection);
  map.data.setStyle({ fillColor: color, fillOpacity: 0.25, strokeColor: color, strokeWeight: 2 });
  const bounds = new g.maps.LatLngBounds();
  map.data.forEach((f: any) => f.getGeometry()?.forEachLatLng((ll: any) => bounds.extend(ll)));
  if (bounds.isEmpty()) {
    map.setCenter({ lat: 0, lng: 20 });
    map.setZoom(2);
  } else {
    map.fitBounds(bounds, 16);
  }
  const info = new g.maps.InfoWindow();
  const listener = map.data.addListener('click', (e: any) => {
    const label = e.feature.getProperty('name') ?? e.feature.getProperty('code');
    if (label == null) return;
    info.setContent(String(label));
    info.setPosition(e.latLng);
    info.open({ map });
  });
  // Google can reject the key after the map exists (gm_authFailure fires
  // late); the caller swaps to another map instead of Google's error overlay.
  const onFail = () => onAuthFailure?.(authError());
  authListeners.add(onFail);
  return () => {
    authListeners.delete(onFail);
    listener.remove();
    info.close();
    g.maps.event.clearInstanceListeners(map);
    host.remove();
  };
}

/** Test hook: forget any loaded key. */
export function resetGoogleMapsForTests(): void {
  loaded = null;
  authFailed = false;
  authListeners.clear();
  document.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
}
