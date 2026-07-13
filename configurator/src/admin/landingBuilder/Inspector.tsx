/** Inspector v2 (P4, CCSD-2009): grouped tabs (Content / Media / Actions /
 * Design / Visibility / Advanced), human-readable localized text instead of
 * keys (keys live under Advanced), inline "Edit Translations" drawer, media
 * picker, item editor ("Features", cards, channels…), CTA rows with editable
 * labels but FIXED destinations (locked Decision 1). Every change patches the
 * draft store only; the preview updates immediately.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Languages, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useBuilder } from './builderStore';
import {
  COMMON_FIELDS, INSPECTOR_TABS, getEditorEntry,
  type BuilderFieldDef, type ItemsEditorConfig,
} from './sectionEditorRegistry';
import { BUILDER_LOCALES, resolveText } from './localization';
import { LocalizationDrawer } from './LocalizationDrawer';
import { MediaLibraryDialog } from './MediaLibraryDialog';
import { ICON_CHOICES } from './iconChoices';
import type { InspectorTab, LandingItemData, LandingSectionData } from './types';

const getPath = (obj: Record<string, unknown> | undefined, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);

const setPath = (draft: LandingSectionData, path: string, value: unknown): Partial<LandingSectionData> => {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { [head]: value } as Partial<LandingSectionData>;
  const nested = { ...((draft as Record<string, unknown>)[head] as Record<string, unknown> | undefined) };
  nested[rest.join('.')] = value; // schema nests only one level (media.imageId, theme.accent)
  return { [head]: nested } as Partial<LandingSectionData>;
};

/** Human-readable localized text field: edits the MESSAGE for the display
 *  locale (staged in locEdits) — never the key. */
function LocTextField({ def, sectionCode, draft }: { def: BuilderFieldDef; sectionCode: string; draft: LandingSectionData }) {
  const { state, dispatch } = useBuilder();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const key = def.fixedKey ?? ((getPath(draft, def.path) as string | undefined) || undefined);
  const value = resolveText(key, state.displayLocale, state.locEdits) ?? '';
  const unresolved = !!key && resolveText(key, state.displayLocale, state.locEdits) === undefined;
  const short = BUILDER_LOCALES.find((l) => l.code === state.displayLocale)?.short ?? state.displayLocale;

  const onChange = (text: string) => {
    if (!key) return;
    dispatch({ type: 'patchLoc', locale: state.displayLocale, key, text, coalesce: `loc:${key}:${state.displayLocale}` });
  };

  return (
    <div className="space-y-1.5" data-field={def.path}>
      <div className="flex items-center gap-2">
        <Label className="text-xs font-medium">{def.label}</Label>
        {def.required && <Badge variant="outline" className="h-4 px-1 text-[9px]">Required</Badge>}
        {unresolved && <Badge variant="outline" className="h-4 border-amber-500 px-1 text-[9px] text-amber-600">No text yet</Badge>}
        <span className="ml-auto rounded border border-border px-1 text-[9px] text-muted-foreground">{short}</span>
      </div>
      {def.multiline ? (
        <textarea
          value={value}
          disabled={!key}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      ) : (
        <Input value={value} disabled={!key} onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" />
      )}
      {/* Technical keys stay hidden here (Advanced tab shows them); admins
          think in content. */}
      {key ? (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          title={key}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-[11px] font-medium text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50"
        >
          <Languages className="h-3.5 w-3.5" /> Edit Translations
        </button>
      ) : (
        <p className="m-0 text-[10px] text-muted-foreground">No localization key set (see Advanced tab).</p>
      )}
      {key && <LocalizationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} locKey={key} title={def.label} />}
      {def.help && <p className="m-0 text-[10px] text-muted-foreground">{def.help}</p>}
      {sectionCode ? null : null}
    </div>
  );
}

function ActionField({ def }: { def: BuilderFieldDef }) {
  // CTA: label text editable (localization), destination fixed by design.
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-field={def.path}>
      <LocTextField def={{ ...def, widget: 'loctext', label: `${def.label} — text` }} sectionCode="" draft={{}} />
      <div className="space-y-1">
        <Label className="text-xs font-medium">Link / Action</Label>
        <Input value={def.destination ?? ''} disabled className="h-8 bg-muted/50 text-sm" />
        <p className="m-0 text-[10px] text-muted-foreground">Destinations are application behavior and cannot be changed here.</p>
      </div>
    </div>
  );
}

function ThemeField({ def, code, draft }: { def: BuilderFieldDef; code: string; draft: LandingSectionData }) {
  const { dispatch } = useBuilder();
  const TOKENS = ['', '--pgrl-primary', '--pgrl-deep', '--pgrl-accent', '--pgrl-surface', '--pgrl-page'];
  const theme = draft.theme ?? {};
  const set = (k: 'accent' | 'bg', v: string) =>
    dispatch({ type: 'patchSection', code, patch: { theme: { ...theme, [k]: v || undefined } } });
  return (
    <div className="space-y-2" data-field={def.path}>
      <Label className="text-xs font-medium">{def.label}</Label>
      {(['accent', 'bg'] as const).map((k) => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-14 text-[11px] capitalize text-muted-foreground">{k}</span>
          <Select value={theme[k] ?? ''} onValueChange={(v) => set(k, v)}>
            <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Default" /></SelectTrigger>
            <SelectContent>
              {TOKENS.map((t) => <SelectItem key={t || 'default'} value={t || 'default'}>{t || 'Default'}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ))}
      {def.help && <p className="m-0 text-[10px] text-muted-foreground">{def.help}</p>}
    </div>
  );
}

function ItemsEditor({ cfg, code, draft }: { cfg: ItemsEditorConfig; code: string; draft: LandingSectionData }) {
  const { state, dispatch } = useBuilder();
  const [editing, setEditing] = useState<number | null>(null);
  // Copy-on-write inheritance: with no explicit items[], show the built-in
  // defaults as rows; the first mutation materialises them into the config.
  const explicit = (draft.items ?? []) as LandingItemData[];
  const items: LandingItemData[] = explicit.length ? explicit : (cfg.inherited?.() ?? []);
  const patch = (next: LandingItemData[]) =>
    dispatch({ type: 'patchSection', code, patch: { items: next.length ? next : undefined } });
  const setItem = (i: number, p: Partial<LandingItemData>) =>
    patch(items.map((it, n) => (n === i ? { ...it, ...p } : it)));

  return (
    <div className="space-y-2" data-field="items">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold">{cfg.label} ({items.length})</Label>
      </div>
      {cfg.help && <p className="m-0 text-[10px] text-muted-foreground">{cfg.help}</p>}
      {items.map((it, i) => (
        <div key={it.code ?? i} className="rounded-md border border-border bg-background px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <span className="min-w-0 flex-1 truncate text-xs">
              {resolveText(it.labelKey, state.displayLocale, state.locEdits) ?? it.labelKey ?? '(untitled)'}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Edit item"
              onClick={() => setEditing(editing === i ? null : i)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Remove item"
              onClick={() => { setEditing(null); patch(items.filter((_, n) => n !== i)); }}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {editing === i && (
            <div className="mt-1.5 space-y-1.5 border-t border-border pt-1.5">
              <Input
                value={resolveText(it.labelKey, state.displayLocale, state.locEdits) ?? ''}
                placeholder="Label"
                autoFocus
                onChange={(e) => {
                  if (!explicit.length) patch(items); // materialise inherited first
                  if (it.labelKey) dispatch({ type: 'patchLoc', locale: state.displayLocale, key: it.labelKey, text: e.target.value, coalesce: `loc:${it.labelKey}` });
                }}
                className="h-7 text-xs"
              />
              {cfg.withIcons && (
                <Select value={it.iconId ?? 'none'} onValueChange={(v) => setItem(i, { iconId: v === 'none' ? undefined : v })}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Icon" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No icon</SelectItem>
                    {ICON_CHOICES.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {cfg.withDesc && it.descKey && (
                <Input
                  value={resolveText(it.descKey, state.displayLocale, state.locEdits) ?? ''}
                  placeholder="Description"
                  onChange={(e) => dispatch({ type: 'patchLoc', locale: state.displayLocale, key: it.descKey!, text: e.target.value, coalesce: `loc:${it.descKey}` })}
                  className="h-7 text-xs"
                />
              )}
              {cfg.withUrl && (
                <Input
                  value={it.navigationUrl ?? ''}
                  placeholder="URL or route key (optional)"
                  onChange={(e) => setItem(i, { navigationUrl: e.target.value || undefined })}
                  className="h-7 text-xs"
                />
              )}
            </div>
          )}
        </div>
      ))}
      <Button
        variant="outline" size="sm" className="h-7 w-full text-xs"
        onClick={() => {
          const t = cfg.newItem();
          const next = [...items, { ...t, enabled: true, order: (items.length + 1) * 10, ...(cfg.withDesc ? { descKey: `${t.labelKey.replace(/_LABEL$/, '')}_DESC` } : {}) }];
          patch(next);
        }}
      >
        <Plus className="mr-1 h-3 w-3" /> Add {cfg.label.replace(/s$/, '')}
      </Button>
    </div>
  );
}

function GenericField({ def, code, draft }: { def: BuilderFieldDef; code: string; draft: LandingSectionData }) {
  const { dispatch } = useBuilder();
  const value = getPath(draft, def.path);
  const patch = (v: unknown) => dispatch({ type: 'patchSection', code, patch: setPath(draft, def.path, v), coalesce: `f:${code}:${def.path}` });

  if (def.widget === 'boolean') {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-sm" data-field={def.path}>
        <input type="checkbox" checked={value !== false} onChange={(e) => patch(e.target.checked)} className="h-4 w-4 accent-primary" />
        {def.label}
      </label>
    );
  }
  if (def.widget === 'select') {
    return (
      <div className="space-y-1" data-field={def.path}>
        <Label className="text-xs font-medium">{def.label}</Label>
        <Select value={(value as string) ?? ''} onValueChange={patch}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{(def.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        {def.help && <p className="m-0 text-[10px] text-muted-foreground">{def.help}</p>}
      </div>
    );
  }
  // roles: comma-separated convenience
  if (def.path === 'roles') {
    return (
      <div className="space-y-1" data-field={def.path}>
        <Label className="text-xs font-medium">{def.label}</Label>
        <Input
          value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
          onChange={(e) => {
            const roles = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
            dispatch({ type: 'patchSection', code, patch: { roles: roles.length ? roles : undefined }, coalesce: `f:${code}:roles` });
          }}
          className="h-9 text-sm"
        />
        {def.help && <p className="m-0 text-[10px] text-muted-foreground">{def.help}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1" data-field={def.path}>
      <Label className="text-xs font-medium">{def.label}</Label>
      <Input
        type={def.widget === 'number' ? 'number' : 'text'}
        value={value === undefined || value === null ? '' : String(value)}
        readOnly={def.readOnly}
        onChange={(e) => patch(def.widget === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : (e.target.value || undefined))}
        className={`h-8 text-sm ${def.readOnly ? 'bg-muted/50' : ''}`}
      />
      {def.help && <p className="m-0 text-[10px] text-muted-foreground">{def.help}</p>}
    </div>
  );
}

/** Boolean that lives on LandingPageConfig, surfaced inside a section tab
 *  (e.g. the Navigation section's "Show top bar"). */
function PageToggleField({ def }: { def: BuilderFieldDef }) {
  const { state, dispatch } = useBuilder();
  const value = (state.page?.draft as Record<string, unknown> | undefined)?.[def.path];
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-sm" data-field={def.path}>
      {def.label}
      <button
        type="button"
        role="switch"
        aria-checked={value !== false}
        onClick={(e) => { e.preventDefault(); dispatch({ type: 'patchPage', patch: { [def.path]: value === false } }); }}
        className={`relative h-5 w-9 rounded-full transition-colors ${value === false ? 'bg-muted-foreground/30' : 'bg-emerald-500'}`}
      >
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: value === false ? 2 : 18 }} />
      </button>
    </label>
  );
}

const PAGE_FIELDS: BuilderFieldDef[] = [
  { path: 'enabled', label: 'Landing page enabled', tab: 'content', widget: 'boolean' },
  { path: 'showUtilityBar', label: 'Show utility bar', tab: 'content', widget: 'boolean' },
  { path: 'showWhatsAppFab', label: 'Show WhatsApp button', tab: 'content', widget: 'boolean' },
  { path: 'defaultLocale', label: 'Default locale', tab: 'content', widget: 'text', help: 'e.g. pt_PT' },
];

export function Inspector() {
  const { state, dispatch } = useBuilder();
  const paneRef = useRef<HTMLDivElement>(null);

  const section = state.selected === 'page' ? null : state.sections.find((s) => s.draft.code === state.selected);
  const entry = getEditorEntry(section?.draft.type);
  const code = section?.draft.code ?? '';

  const fieldsByTab = useMemo(() => {
    const all = [...(entry?.fields ?? []), ...COMMON_FIELDS];
    const map = new Map<InspectorTab, BuilderFieldDef[]>();
    all.forEach((f) => map.set(f.tab, [...(map.get(f.tab) ?? []), f]));
    return map;
  }, [entry]);

  // Click-to-edit: scroll the focused field into view.
  useEffect(() => {
    if (!state.focusField) return;
    const t = window.setTimeout(() => {
      paneRef.current?.querySelector(`[data-field="${state.focusField}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [state.focusField, state.selected, state.inspectorTab]);

  if (state.selected === 'page') {
    const draft = state.page?.draft ?? {};
    return (
      <Pane title="Page Settings" subtitle="Page-level toggles and defaults.">
        <div className="flex flex-col gap-4 p-4">
          {PAGE_FIELDS.map((def) => (
            <div key={def.path}>
              {def.widget === 'boolean' ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(draft as Record<string, unknown>)[def.path] !== false}
                    onChange={(e) => dispatch({ type: 'patchPage', patch: { [def.path]: e.target.checked } })}
                    className="h-4 w-4 accent-primary"
                  />
                  {def.label}
                </label>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs font-medium">{def.label}</Label>
                  <Input
                    value={((draft as Record<string, unknown>)[def.path] as string) ?? ''}
                    onChange={(e) => dispatch({ type: 'patchPage', patch: { [def.path]: e.target.value }, coalesce: `p:${def.path}` })}
                    className="h-9 text-sm"
                  />
                  {def.help && <p className="m-0 text-[10px] text-muted-foreground">{def.help}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Pane>
    );
  }

  if (!section || !entry) {
    return (
      <Pane title="Inspector">
        <p className="p-4 text-sm text-muted-foreground">Select a section to edit it.</p>
      </Pane>
    );
  }

  const tab = state.inspectorTab;
  const tabFields = fieldsByTab.get(tab) ?? [];
  const itemsHere = entry.items && entry.items.tab === tab ? entry.items : undefined;

  return (
    <Pane
      title={entry.label}
      meta={`Section ID: ${code} · Version: ${section.draft.status === 'PUBLISHED' ? 'Published' : 'Draft'}`}
      subtitle={entry.description}
      header={
        <div className="flex items-center gap-2">
          {/* display-locale switcher */}
          <Select value={state.displayLocale} onValueChange={(v) => dispatch({ type: 'setDisplayLocale', locale: v })}>
            <SelectTrigger className="h-6 w-16 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BUILDER_LOCALES.map((l) => <SelectItem key={l.code} value={l.code}>{l.short}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* enabled toggle mirrors the card switch */}
          <button
            type="button"
            role="switch"
            aria-checked={section.draft.enabled !== false}
            aria-label="Section enabled"
            onClick={() => dispatch({ type: 'patchSection', code, patch: { enabled: section.draft.enabled === false } })}
            className={`relative h-5 w-9 rounded-full transition-colors ${section.draft.enabled === false ? 'bg-muted-foreground/30' : 'bg-emerald-500'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${section.draft.enabled === false ? 'left-0.5' : 'left-4.5'}`} style={{ left: section.draft.enabled === false ? 2 : 18 }} />
          </button>
        </div>
      }
    >
      <Tabs value={tab} onValueChange={(v) => dispatch({ type: 'setTab', tab: v as InspectorTab })} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="h-9 w-full justify-start gap-1 rounded-none border-b border-border bg-transparent px-2">
          {INSPECTOR_TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="rounded-none border-b-2 border-transparent px-2 pb-1.5 text-[11px] data-[state=active]:border-emerald-600 data-[state=active]:text-emerald-700 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div ref={paneRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {tabFields.length === 0 && !itemsHere && (
            <p className="m-0 text-xs text-muted-foreground">Nothing to configure in this tab for {entry.label}.</p>
          )}
          {tabFields.map((def, i) => {
            const groupHeader = def.group && def.group !== tabFields[i - 1]?.group ? (
              <h3 className="mb-0 mt-2 border-t border-border pt-3 text-xs font-semibold">{def.group}</h3>
            ) : null;
            let field: React.ReactNode;
            if (def.widget === 'loctext') field = <LocTextField def={def} sectionCode={code} draft={section.draft} />;
            else if (def.widget === 'action') field = <ActionField def={def} />;
            else if (def.widget === 'theme') field = <ThemeField def={def} code={code} draft={section.draft} />;
            else if (def.widget === 'media') field = <MediaLibraryDialog def={def} code={code} draft={section.draft} />;
            else if (def.widget === 'pagetoggle') field = <PageToggleField def={def} />;
            else field = <GenericField def={def} code={code} draft={section.draft} />;
            return (
              <div key={def.path} className="contents">
                {groupHeader}
                {field}
              </div>
            );
          })}
          {itemsHere && <ItemsEditor cfg={itemsHere} code={code} draft={section.draft} />}
        </div>
      </Tabs>
    </Pane>
  );
}

function Pane({ title, subtitle, meta, header, children }: { title: string; subtitle?: string; meta?: string; header?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-sm font-semibold">{title}</h2>
          {meta && <p className="mb-0 mt-0.5 text-[10px] text-muted-foreground">{meta}</p>}
          {subtitle && <p className="mb-0 mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{subtitle}</p>}
        </div>
        {header}
      </div>
      {children}
    </div>
  );
}
