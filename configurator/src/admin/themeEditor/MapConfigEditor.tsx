import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, RefreshCw, Save, Info } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { ActionBar } from '@/components/digit/ActionBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { useApp } from '../../App';
import { digitClient } from '@/providers/bridge';
import { getDescriptor } from '../schemaDescriptors';
import type { FieldSpec } from '../schemaDescriptors/types';

/**
 * Editor for `RAINMAKER-PGR.MapConfig`.
 *
 * Self-managed (own state + a direct mdmsUpdate) rather than the descriptor +
 * ra-core form path: that path silently swallows the submit for this master, so
 * new fields never persist (the same reason StateInfoEditor bypasses it). The
 * layout still reads its labels and help from the descriptor so there's one
 * source of truth, but it renders controlled inputs and a live map preview and
 * saves reliably.
 */

const SCHEMA = 'RAINMAKER-PGR.MapConfig';
const MAP_CONFIG_KEY = 'DEFAULT';

// Base-tile presets, mirroring digit-ui-esbuild products/pgr useMapConfig.js so
// the preview shows the basemap the citizen map will actually render.
const BASE_MAP_THEMES: Record<string, { tileUrl: string; label: string }> = {
  voyager: { label: 'Voyager (light, labelled)', tileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' },
  light: { label: 'Light', tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' },
  dark: { label: 'Dark', tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' },
  osm: { label: 'OpenStreetMap', tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
};
const DEFAULT_THEME = 'voyager';
const DEFAULT_WARD_COLOR = '#FFA74F';
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Plain-language intro per section — the raw field names ("Search box — west")
// don't tell an operator what they're for.
const SECTION_HELP: Record<string, string> = {
  Basemap: 'How the map looks: the tile style and the colour wards are highlighted in.',
  'Starting position': 'Where the citizen map opens before they share a location. Filled in automatically from your boundaries at onboarding — change only to override.',
  'Ward boundaries': 'Which tenant’s wards are drawn over the map and used to turn a dropped pin into a ward.',
  'Address search': 'The address text-search in the complaint form (powered by OpenStreetMap). The country codes restrict which country’s addresses appear; the four search-box edges bound the area results can come from. Both are derived from your boundaries — widen them only deliberately, since a box that is too small hides valid addresses.',
};

type Obj = Record<string, unknown>;
interface MapRecord {
  id: string; tenantId: string; schemaCode: string; uniqueIdentifier: string;
  data: Obj; isActive: boolean; auditDetails?: Obj;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const getPath = (obj: Obj, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o != null && typeof o === 'object' ? (o as Obj)[k] : undefined), obj);

/** Immutably set a dot-path, pruning keys back out when cleared so we never
 *  persist `{ center: { lat: null } }` half-values. */
const setPath = (obj: Obj, path: string, value: unknown): Obj => {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) {
    const next = { ...obj };
    if (value === undefined || value === '') delete next[head];
    else next[head] = value;
    return next;
  }
  const child = (obj[head] && typeof obj[head] === 'object' ? obj[head] : {}) as Obj;
  const nextChild = setPath(child, rest.join('.'), value);
  const next = { ...obj };
  if (Object.keys(nextChild).length === 0) delete next[head];
  else next[head] = nextChild;
  return next;
};

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button type="button" tabIndex={-1} aria-label="More information"
          className="text-muted-foreground/70 hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-snug font-normal">{text}</TooltipContent>
    </Tooltip>
  );
}

function FieldShell({ spec, children }: { spec: FieldSpec; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      {/* Reserve two lines so a one-line label and a wrapping one leave their
          inputs at the same height across a grid row. */}
      <div className="flex items-start gap-1.5 mb-1.5 min-h-[2.5rem]">
        <Label className="text-sm font-medium text-foreground leading-snug">{spec.label ?? spec.path}</Label>
        {spec.help && <span className="shrink-0 mt-0.5"><InfoTip text={spec.help} /></span>}
      </div>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function FieldInput({
  spec, data, setField,
}: { spec: FieldSpec; data: Obj; setField: (path: string, value: unknown) => void }) {
  const raw = getPath(data, spec.path);

  if (spec.path === 'baseMapTheme') {
    return (
      <FieldShell spec={spec}>
        <Select value={(raw as string) ?? ''} onValueChange={(v) => setField(spec.path, v)}>
          <SelectTrigger><SelectValue placeholder="Voyager (default)" /></SelectTrigger>
          <SelectContent>
            {Object.entries(BASE_MAP_THEMES).map(([value, t]) => (
              <SelectItem key={value} value={value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>
    );
  }

  if (spec.widget === 'color') {
    const val = typeof raw === 'string' ? raw : '';
    const valid = HEX.test(val);
    return (
      <FieldShell spec={spec}>
        <div className="flex items-center gap-2">
          <input type="color" aria-label={`${spec.label} picker`}
            value={valid && val.length === 7 ? val : '#000000'}
            onChange={(e) => setField(spec.path, e.target.value)}
            className="h-9 w-9 rounded border border-input cursor-pointer bg-transparent p-0.5" />
          <Input value={val} placeholder="#RRGGBB" onChange={(e) => setField(spec.path, e.target.value)} />
        </div>
      </FieldShell>
    );
  }

  const isNumber = spec.widget === 'number' || spec.widget === 'integer';
  return (
    <FieldShell spec={spec}>
      <Input
        type={isNumber ? 'number' : 'text'}
        value={raw == null ? '' : String(raw)}
        onChange={(e) => {
          const v = e.target.value;
          setField(spec.path, isNumber ? (v === '' ? undefined : Number(v)) : v);
        }}
      />
    </FieldShell>
  );
}

function MapPreview({ data, setField }: { data: Obj; setField: (path: string, value: unknown) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  const theme = data.baseMapTheme as string | undefined;
  const tileUrl = data.tileUrl as string | undefined;
  const wardColor = data.wardHighlightColor as string | undefined;
  const center = data.center as Obj | undefined;
  const zoom = data.defaultZoom;
  const viewbox = data.searchViewbox as Obj | undefined;

  const round = (n: number) => Math.round(n * 1e5) / 1e5;

  // Capture what's framed on the map, so an operator sets the search area and the
  // start point by looking at the map instead of guessing latitude/longitude.
  const captureSearchArea = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setField('searchViewbox.minLon', round(b.getWest()));
    setField('searchViewbox.minLat', round(b.getSouth()));
    setField('searchViewbox.maxLon', round(b.getEast()));
    setField('searchViewbox.maxLat', round(b.getNorth()));
  };
  const clearSearchArea = () => {
    (['minLon', 'minLat', 'maxLon', 'maxLat'] as const).forEach((k) => setField(`searchViewbox.${k}`, undefined));
  };
  const captureStartPoint = () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    setField('center.lat', round(c.lat));
    setField('center.lng', round(c.lng));
    setField('defaultZoom', map.getZoom());
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true, attributionControl: false });
    map.setView([0, 20], 2);
    mapRef.current = map;
    overlayRef.current = L.layerGroup().addTo(map);
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; tileRef.current = null; overlayRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const url = (typeof tileUrl === 'string' && tileUrl.trim())
      ? tileUrl.trim()
      : BASE_MAP_THEMES[theme && BASE_MAP_THEMES[theme] ? theme : DEFAULT_THEME].tileUrl;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(url, { maxZoom: 19 }).addTo(map);
    tileRef.current.bringToBack();
  }, [theme, tileUrl]);

  // Overlays only — redrawn on colour/position changes, never re-framing the map
  // (so editing the ward colour doesn't yank the view around).
  useEffect(() => {
    const map = mapRef.current, overlay = overlayRef.current;
    if (!map || !overlay) return;
    overlay.clearLayers();
    const color = (typeof wardColor === 'string' && HEX.test(wardColor.trim())) ? wardColor.trim() : DEFAULT_WARD_COLOR;
    const lat = num(center?.lat), lng = num(center?.lng);
    const b = viewbox && { minLon: num(viewbox.minLon), minLat: num(viewbox.minLat), maxLon: num(viewbox.maxLon), maxLat: num(viewbox.maxLat) };
    const hasBox = !!b && b.minLon != null && b.minLat != null && b.maxLon != null && b.maxLat != null && b.minLon < b.maxLon && b.minLat < b.maxLat;

    if (hasBox) {
      L.rectangle([[b!.minLat as number, b!.minLon as number], [b!.maxLat as number, b!.maxLon as number]],
        { color: '#2563eb', weight: 1.5, dashArray: '5,4', fill: false }).bindTooltip('Address-search area').addTo(overlay);
    }
    if (lat != null && lng != null) {
      L.circleMarker([lat, lng], { radius: 6, color, fillColor: color, fillOpacity: 0.9, weight: 2 }).bindTooltip('Map opens here').addTo(overlay);
      const d = 0.01;
      L.rectangle([[lat - d, lng - d], [lat + d, lng + d]], { color, weight: 2, fillColor: color, fillOpacity: 0.35 }).addTo(overlay);
    }
  }, [center, wardColor, viewbox]);

  // Framing: follow the start point (or the search box) when they change, but
  // NOT on colour edits.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lat = num(center?.lat), lng = num(center?.lng), z = num(zoom);
    const b = viewbox && { minLon: num(viewbox.minLon), minLat: num(viewbox.minLat), maxLon: num(viewbox.maxLon), maxLat: num(viewbox.maxLat) };
    const hasBox = !!b && b.minLon != null && b.minLat != null && b.maxLon != null && b.maxLat != null && b.minLon < b.maxLon && b.minLat < b.maxLat;
    if (lat != null && lng != null) map.setView([lat, lng], z ?? map.getZoom());
    else if (hasBox) map.fitBounds([[b!.minLat as number, b!.minLon as number], [b!.maxLat as number, b!.maxLon as number]], { padding: [12, 12] });
  }, [center, zoom, viewbox]);

  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-2">Live preview</div>
      <div ref={containerRef} className="rounded-lg border border-border overflow-hidden" style={{ height: 340 }} />
      <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
        Pan and zoom to frame your area, then capture it — no need to type coordinates.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={captureStartPoint}>Set start point to map centre</Button>
        <Button type="button" variant="outline" size="sm" onClick={captureSearchArea}>Set search area to this view</Button>
        <Button type="button" variant="ghost" size="sm" onClick={clearSearchArea}>Clear search area</Button>
      </div>
    </div>
  );
}

export function MapConfigEditor() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const idRef = useRef(id);

  const descriptor = getDescriptor(SCHEMA);
  const groups = descriptor?.groups ?? [];
  const fields = descriptor?.fields ?? [];
  const specByPath = new Map(fields.map((f) => [f.path, f]));

  const [record, setRecord] = useState<MapRecord | null>(null);
  const [data, setData] = useState<Obj>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setLoadError(null);
      try {
        const records = (await digitClient.mdmsSearch(tenantId, SCHEMA, { limit: 50 })) as unknown as MapRecord[];
        if (cancelled) return;
        const target = records.find((r) => r.uniqueIdentifier === idRef.current)
          ?? records.find((r) => r.isActive) ?? records[0] ?? null;
        setRecord(target);
        setData(target ? { ...target.data } : { code: MAP_CONFIG_KEY });
      } catch (e) {
        setLoadError((e as Error)?.message || 'Failed to load Map Configuration.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const setField = (path: string, value: unknown) => setData((prev) => setPath(prev, path, value));

  const handleSave = async () => {
    setSaving(true); setSaveError(null);
    try {
      const payload = { ...data, code: MAP_CONFIG_KEY };
      // mdms-v2 resolves up the tenant tree, so the loaded record may belong to a
      // PARENT tenant. Updating that would rewrite the parent for every city that
      // inherits it — so only update a record this tenant actually owns; otherwise
      // shadow it with a new record at this tenant.
      if (record && record.tenantId === tenantId) {
        await digitClient.mdmsUpdate({ ...record, data: payload } as unknown as Parameters<typeof digitClient.mdmsUpdate>[0], record.isActive);
      } else {
        await digitClient.mdmsCreate(tenantId, SCHEMA, MAP_CONFIG_KEY, payload);
      }
      toast({ title: 'Map Configuration saved', description: tenantId });
      navigate('/manage/map-config');
    } catch (e) {
      setSaveError((e as Error)?.message || 'Failed to save Map Configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5"><ArrowLeft className="w-4 h-4" /> Back</Button>
        <DigitCard className="p-8 text-center text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin inline-block mr-2" /> Loading Map Configuration…</DigitCard>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5"><ArrowLeft className="w-4 h-4" /> Back</Button>
        <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
      </div>
    );
  }

  const identity = groups.find((g) => g.title === 'Identity');
  const sections = groups.filter((g) => g.title !== 'Identity');
  const codeSpec = specByPath.get(identity?.fields[0] ?? 'code');

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5"><ArrowLeft className="w-4 h-4" /> Back</Button>
          <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">Edit Map Configuration</h1>
          {saving && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        <DigitCard className="max-w-none">
          {saveError && <Alert variant="destructive" className="mb-4"><AlertDescription>{saveError}</AlertDescription></Alert>}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
            <div className="space-y-4 min-w-0">
              {codeSpec && <div className="max-w-xs"><FieldInput spec={codeSpec} data={data} setField={setField} /></div>}
              {sections.map((g) => {
                const specs = g.fields.map((p) => specByPath.get(p)).filter(Boolean) as FieldSpec[];
                if (specs.length === 0) return null;
                return (
                  <Card key={g.title}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">{g.title}</CardTitle>
                      {SECTION_HELP[g.title] && (
                        <p className="text-xs text-muted-foreground font-normal leading-snug">{SECTION_HELP[g.title]}</p>
                      )}
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {specs.map((spec) => <FieldInput key={spec.path} spec={spec} data={data} setField={setField} />)}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <aside className="xl:sticky xl:top-4 self-start"><MapPreview data={data} setField={setField} /></aside>
          </div>

          <ActionBar>
            <Button variant="outline" onClick={() => navigate(-1)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </Button>
          </ActionBar>
        </DigitCard>
      </div>
    </TooltipProvider>
  );
}
