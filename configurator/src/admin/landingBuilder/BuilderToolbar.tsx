/** Builder toolbar v2 (P4, CCSD-2009): breadcrumb + save-state, device
 * switcher, zoom, undo/redo, draft/published preview toggle, last-saved,
 * Validate / Save Draft / Publish (with Export config). Keyboard shortcuts
 * are registered by LandingBuilder (Ctrl+S / Ctrl+Z / Ctrl+Y).
 */
import { useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronDown, Download, Monitor, Redo2, Save, Smartphone,
  Tablet, Undo2, UploadCloud,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useBuilder, buildPreviewConfig, isDirty } from './builderStore';
import { getEditorEntry, INSPECTOR_TABS } from './sectionEditorRegistry';

function agoLabel(ts: number | null): string {
  if (!ts) return 'Not saved yet';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return 'Saved just now';
  if (s < 60) return `Saved ${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `Saved ${m} min ago`;
  return `Saved ${Math.round(m / 60)} h ago`;
}

const DEVICES = [
  { id: 'desktop' as const, label: 'Desktop', icon: Monitor },
  { id: 'tablet' as const, label: 'Tablet', icon: Tablet },
  { id: 'mobile' as const, label: 'Mobile', icon: Smartphone },
];

export function BuilderToolbar({
  onValidate, onSaveDraft, onPublish,
}: {
  onValidate: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
}) {
  const { state, dispatch } = useBuilder();
  const dirty = isDirty(state);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const selectedEntry = state.selected !== 'page'
    ? getEditorEntry(state.sections.find((s) => s.draft.code === state.selected)?.draft.type)
    : undefined;
  const tabLabel = INSPECTOR_TABS.find((t) => t.id === state.inspectorTab)?.label;

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(buildPreviewConfig(state), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'landing-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
      {/* Breadcrumb */}
      <div className="flex min-w-0 items-center gap-1 text-sm">
        <span className="font-semibold">Landing Page Builder</span>
        {selectedEntry && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="truncate">{selectedEntry.label}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">{tabLabel}</span>
          </>
        )}
        {state.selected === 'page' && <span className="text-muted-foreground">/ Page Settings</span>}
      </div>
      {dirty
        ? <Badge variant="outline" className="border-amber-500 text-amber-600">Unsaved changes</Badge>
        : <Badge variant="outline" className="border-emerald-600 text-emerald-700">All changes saved</Badge>}

      <div className="mx-2 flex-1" />

      {/* Device switcher */}
      <div className="flex overflow-hidden rounded-md border border-border">
        {DEVICES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => dispatch({ type: 'setViewport', viewport: id })}
            className={`flex items-center gap-1 px-2 py-1 text-xs ${state.viewport === id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Zoom */}
      <Select value={String(state.zoom)} onValueChange={(v) => dispatch({ type: 'setZoom', zoom: Number(v) })}>
        <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0.5">50%</SelectItem>
          <SelectItem value="0.75">75%</SelectItem>
          <SelectItem value="1">100%</SelectItem>
        </SelectContent>
      </Select>

      {/* Draft / Published preview */}
      <div className="flex overflow-hidden rounded-md border border-border text-xs">
        <button
          type="button"
          onClick={() => dispatch({ type: 'setPreviewMode', mode: 'draft' })}
          className={`px-2 py-1 ${state.previewMode === 'draft' ? 'bg-amber-500 text-white' : 'hover:bg-accent'}`}
        >Draft</button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'setPreviewMode', mode: 'published' })}
          className={`px-2 py-1 ${state.previewMode === 'published' ? 'bg-emerald-600 text-white' : 'hover:bg-accent'}`}
        >Published</button>
      </div>

      {/* Undo / redo */}
      <Button variant="ghost" size="icon" className="h-7 w-7" title="Undo (Ctrl+Z)" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="Redo (Ctrl+Y)" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })}>
        <Redo2 className="h-4 w-4" />
      </Button>

      <span className="whitespace-nowrap text-[10px] text-muted-foreground">✓ {agoLabel(state.lastSavedAt)}</span>

      <Button variant="outline" size="sm" className="h-7" onClick={onValidate}>
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Validate
      </Button>
      <Button variant="outline" size="sm" className="h-7" disabled={!dirty || state.saving} onClick={onSaveDraft} title="Ctrl+S">
        <Save className="mr-1 h-3.5 w-3.5" /> {state.saving ? 'Saving…' : 'Save Draft'}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="h-7" disabled={state.saving}>
            <UploadCloud className="mr-1 h-3.5 w-3.5" /> Publish <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onPublish}>
            <UploadCloud className="mr-2 h-3.5 w-3.5" /> Publish to site
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportConfig}>
            <Download className="mr-2 h-3.5 w-3.5" /> Export config (JSON)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
