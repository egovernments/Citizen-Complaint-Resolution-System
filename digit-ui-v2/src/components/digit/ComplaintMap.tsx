/**
 * ComplaintMap — Leaflet map for picking or viewing a complaint location.
 *
 * Two modes:
 *   "pick"  draggable marker + "Use my GPS" button + Nominatim reverse-
 *           geocode on dragend (debounced; the public Nominatim service
 *           rate-limits to 1 req/s).
 *   "view"  static marker, no controls — used on the detail page.
 *
 * Why Leaflet over Google Maps:
 *   - No API key required (avoids the operator-deploy chicken-and-egg).
 *   - OSM tiles are free + appropriate for civic UI.
 *   - ~50 KB gz vs Maps JS ~150 KB.
 *
 * Default center: Nairobi (-1.2864, 36.8172) — Nai Pepea is a Nairobi
 * deploy. Re-point via VITE_CITIZEN_MAP_DEFAULT_LAT / _LNG if you fork.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { LocateFixed } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Leaflet's default marker icons are <img> URLs that webpack/vite don't
// bundle; without this shim the map renders empty markers. We pull the
// hosted versions instead — the OSM CDN copies are stable.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: () => string })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEFAULT_LAT = Number(import.meta.env.VITE_CITIZEN_MAP_DEFAULT_LAT) || -1.2864;
const DEFAULT_LNG = Number(import.meta.env.VITE_CITIZEN_MAP_DEFAULT_LNG) || 36.8172;

interface ComplaintMapProps {
  mode: 'pick' | 'view';
  lat?: number | null;
  lng?: number | null;
  onChange?: (lat: number, lng: number, locality?: string) => void;
}

// Tiny helper component used inside <MapContainer> to fly the map to a
// new center when the GPS button is pressed. react-leaflet exposes the
// Leaflet map only via the useMap hook, which must run inside the
// MapContainer's children.
function RecenterOn({ lat, lng }: { lat: number | null | undefined; lng: number | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (typeof lat === 'number' && typeof lng === 'number') {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    }
  }, [lat, lng, map]);
  return null;
}

/** Debounce wrapper for Nominatim reverse-geocode — public service limits
 *  to ~1 req/s and citizens dragging the pin can fire several events. */
function useDebounced<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  return ((...args: Parameters<T>) => {
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(() => fn(...args), ms);
  }) as T;
}

export default function ComplaintMap({ mode, lat, lng, onChange }: ComplaintMapProps) {
  const initial = {
    lat: typeof lat === 'number' ? lat : DEFAULT_LAT,
    lng: typeof lng === 'number' ? lng : DEFAULT_LNG,
  };
  // markerPos is what the pin renders at — driven by the user's pick or
  // the parent's lat/lng prop (whichever changed last).
  const [markerPos, setMarkerPos] = useState<[number, number]>([initial.lat, initial.lng]);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null);
  const [busyGps, setBusyGps] = useState(false);

  // Keep the marker in sync with parent updates (e.g. GPS callback).
  useEffect(() => {
    if (typeof lat === 'number' && typeof lng === 'number') {
      setMarkerPos([lat, lng]);
    }
  }, [lat, lng]);

  const reverseGeocode = useDebounced(async (latNum: number, lngNum: number) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lngNum}&zoom=16`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) return;
      const data = (await res.json()) as { address?: { suburb?: string; neighbourhood?: string; city?: string } };
      const locality =
        data.address?.suburb ?? data.address?.neighbourhood ?? data.address?.city ?? '';
      onChange?.(latNum, lngNum, locality);
    } catch {
      // Nominatim hiccup — non-fatal. Lat/lng still updates.
      onChange?.(latNum, lngNum);
    }
  }, 800);

  const handleGps = () => {
    if (!navigator.geolocation) return;
    setBusyGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setMarkerPos([latitude, longitude]);
        setFlyTo({ lat: latitude, lng: longitude });
        setBusyGps(false);
        reverseGeocode(latitude, longitude);
      },
      () => setBusyGps(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div className="space-y-2">
      <div className="rounded-md border overflow-hidden">
        <MapContainer
          center={[initial.lat, initial.lng]}
          zoom={mode === 'view' ? 16 : 12}
          style={{ height: 320, width: '100%' }}
          dragging={true}
          scrollWheelZoom={mode === 'pick'}
          doubleClickZoom={mode === 'pick'}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={markerPos}
            draggable={mode === 'pick'}
            eventHandlers={{
              dragend: (e) => {
                if (mode !== 'pick') return;
                const m = e.target as L.Marker;
                const { lat: la, lng: lo } = m.getLatLng();
                setMarkerPos([la, lo]);
                reverseGeocode(la, lo);
              },
            }}
          />
          {flyTo && <RecenterOn lat={flyTo.lat} lng={flyTo.lng} />}
        </MapContainer>
      </div>

      {mode === 'pick' && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>
            Pin: <span className="font-mono">{markerPos[0].toFixed(5)}</span>,{' '}
            <span className="font-mono">{markerPos[1].toFixed(5)}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleGps} disabled={busyGps}>
            <LocateFixed className="h-4 w-4 mr-1" />
            {busyGps ? 'Locating…' : 'Use my GPS'}
          </Button>
        </div>
      )}
    </div>
  );
}
