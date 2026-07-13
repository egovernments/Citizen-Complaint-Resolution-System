/** Right pane: properties for the selected node (P4a, CCSD-2009).
 *
 * Renders COMMON_FIELDS + the SECTION_EDITOR_REGISTRY entry's fields for the
 * selected section (or the page-settings form). Every change patches the draft
 * store only — the preview updates immediately, nothing persists until Save.
 * P4b upgrades isLocKey fields to LocalizationKeyInput and adds items/media.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useBuilder } from './builderStore';
import { COMMON_FIELDS, getEditorEntry, type BuilderFieldDef } from './sectionEditorRegistry';
import type { LandingPageData, LandingSectionData } from './types';

function Field({
  def, value, onChange,
}: {
  def: BuilderFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="space-y-1.5">
      {def.widget !== 'boolean' && (
        <Label className="text-xs font-medium">{def.label}</Label>
      )}
      {def.widget === 'text' && (
        <Input
          value={typeof value === 'string' ? value : ''}
          readOnly={def.readOnly}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm"
        />
      )}
      {def.widget === 'number' && (
        <Input
          type="number"
          value={typeof value === 'number' ? value : ''}
          readOnly={def.readOnly}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="h-8 text-sm"
        />
      )}
      {def.widget === 'boolean' && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value !== false}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
          {def.label}
        </label>
      )}
      {def.widget === 'select' && (
        <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {(def.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {def.help && <p className="text-[11px] leading-snug text-muted-foreground">{def.help}</p>}
    </div>
  );
}

const PAGE_FIELDS: BuilderFieldDef[] = [
  { path: 'enabled', label: 'Landing page enabled', widget: 'boolean',
    help: 'Off = the page falls back to its built-in default layout.' },
  { path: 'showUtilityBar', label: 'Show utility bar', widget: 'boolean' },
  { path: 'showWhatsAppFab', label: 'Show WhatsApp button', widget: 'boolean' },
  { path: 'defaultLocale', label: 'Default locale', widget: 'text', help: 'e.g. pt_PT' },
];

export function PropertiesPane() {
  const { state, dispatch } = useBuilder();

  if (state.selected === 'page') {
    const draft = state.page?.draft ?? {};
    return (
      <Pane title="Page settings">
        {PAGE_FIELDS.map((def) => (
          <Field
            key={def.path}
            def={def}
            value={(draft as LandingPageData)[def.path as keyof LandingPageData]}
            onChange={(v) => dispatch({ type: 'patchPage', patch: { [def.path]: v } })}
          />
        ))}
      </Pane>
    );
  }

  const section = state.sections.find((s) => s.draft.code === state.selected);
  if (!section) return <Pane title="Properties"><p className="text-sm text-muted-foreground">Select a section.</p></Pane>;
  const entry = getEditorEntry(section.draft.type);
  const code = section.draft.code as string;

  return (
    <Pane title={entry?.label ?? code} subtitle={entry?.description}>
      {[...COMMON_FIELDS, ...(entry?.fields ?? [])].map((def) => (
        <Field
          key={def.path}
          def={def}
          value={(section.draft as LandingSectionData)[def.path as keyof LandingSectionData]}
          onChange={(v) => dispatch({ type: 'patchSection', code, patch: { [def.path]: v } })}
        />
      ))}
    </Pane>
  );
}

function Pane({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mb-0 mt-1 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}
