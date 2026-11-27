// Google Maps JavaScript API, for tenants whose MapConfig sets
// mapProvider: 'google' (#1994). Loaded on demand — a tenant on the default
// OpenStreetMap tiles never downloads it.
//
// Two constraints shape this file:
//  - Google allows one API key per page load. Asking for a second key can't
//    work, so it is reported ("reload the page") rather than silently ignored.
//    A key the check sees Google refuse is unloaded instead, so the operator
//    can check a corrected key without a reload.
//  - A bad key doesn't fail the script load. Google calls window.gm_authFailure
//    later, once a map tries to authenticate — so validateGoogleMapsKey() draws
//    a probe map and waits for a verdict, and every drawn map keeps listening
//    for one.
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

/** What to tell an operator whose key Google refused. Onboarding shows it translated, as geography.google.rejected. */
export const GOOGLE_KEY_REJECTED_MESSAGE =
  'Google rejected this API key. Check it is copied in full, enable the Maps JavaScript API for it in Google Cloud Console, and allow this site (%{site}) in its HTTP-referrer restrictions.';

/** Google refused the key. `site` is the host the key's HTTP-referrer restrictions must allow. */
export class GoogleKeyRejectedError extends Error {
  readonly site: string;
  constructor(site: string = window.location?.host ?? '') {
    super(
      site
        ? GOOGLE_KEY_REJECTED_MESSAGE.replace('%{site}', site)
        : GOOGLE_KEY_REJECTED_MESSAGE.replace(' (%{site})', ''),
    );
    this.name = 'GoogleKeyRejectedError';
    this.site = site;
  }
}

/**
 * Forgets the loaded key and the API it loaded, so the next load fetches the API afresh and Google
 * gives a new verdict. The API's own modules come from maps.googleapis.com too, so they go with its
 * loader script. Its custom elements stay registered (a browser can't unregister one): the next load
 * registers its own under new names and logs "already defined" warnings, which are harmless.
 */
function unloadGoogleMaps(): void {
  loaded = null;
  authFailed = false;
  document.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
  const w = window as any;
  delete w.google;
  delete w.gm_authFailure;
  delete w[CALLBACK];
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

// Google authenticates a key — and draws tiles — only for a map inside the
// viewport with a real size. A map offscreen or under display:none gets neither
// gm_authFailure nor tilesloaded, so it could never reject a key. The probe
// sits in the viewport's corner instead: see-through, behind the page, and out
// of reach of pointer, keyboard and screen reader for the seconds the check takes.
// The map goes in a holder that carries this style: Google rewrites the map
// div's own position to relative, which would drop it below the page and
// briefly add a scrollbar.
const KEY_PROBE_STYLE =
  'position:fixed;top:0;left:0;width:200px;height:200px;opacity:0;pointer-events:none;z-index:-1';

// graceMs: Google refused a bad key about 1 s after the check began, script download included, while
// a good key's tiles took about 3 s. 2.5 s lets a refusal trail the tiles by more than twice that
// whole round trip, and still leaves the tiles 5.5 s of the 8 s timeout.
export async function validateGoogleMapsKey(
  apiKey: string,
  { timeoutMs = 8000, graceMs = 2500 }: { timeoutMs?: number; graceMs?: number } = {},
): Promise<GoogleKeyCheck> {
  // A check asks Google again: a key it refused before, here or under a drawn map, may have been
  // corrected, or allowed in Cloud Console since.
  if (authFailed) unloadGoogleMaps();
  const g = await loadGoogleMaps(apiKey);
  const holder = document.createElement('div');
  holder.style.cssText = KEY_PROBE_STYLE;
  holder.setAttribute('aria-hidden', 'true');
  holder.setAttribute('inert', '');
  const probe = document.createElement('div');
  probe.style.cssText = 'width:100%;height:100%';
  holder.appendChild(probe);
  document.body.appendChild(holder);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let onFail = () => {};
  let map: any;
  let settled = false;
  try {
    return await new Promise<GoogleKeyCheck>((resolve, reject) => {
      onFail = () => reject(new GoogleKeyRejectedError());
      authListeners.add(onFail);
      timers.push(setTimeout(() => resolve('unverified'), timeoutMs));
      map = new g.maps.Map(probe, { center: { lat: 0, lng: 0 }, zoom: 1 });
      g.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        // Tiles that arrive once the check is over start no timer.
        if (!settled) timers.push(setTimeout(() => resolve('ok'), graceMs));
      });
    });
  } catch (e) {
    // Don't keep a refused key loaded: the next check, of a corrected key or of this one once
    // Cloud Console allows it, loads Google Maps afresh, with no page reload.
    if (e instanceof GoogleKeyRejectedError) unloadGoogleMaps();
    throw e;
  } finally {
    settled = true;
    timers.forEach(clearTimeout);
    authListeners.delete(onFail);
    if (map) g.maps.event.clearInstanceListeners(map);
    holder.remove();
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
  if (authFailed) throw new GoogleKeyRejectedError();
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
  const onFail = () => onAuthFailure?.(new GoogleKeyRejectedError());
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
  unloadGoogleMaps();
  authListeners.clear();
}
