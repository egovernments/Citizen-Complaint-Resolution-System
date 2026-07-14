/** Left pane v2: section cards with drag-and-drop, status + health chips,
 * enable toggle, contextual menu (duplicate / delete / settings), add-section
 * catalog, hover sync with the preview, and a Page Settings node (P4).
 */
import { useMemo, useRef, useState } from 'react';
import { GripVertical, MoreVertical, Plus, Settings, AlertTriangle, Copy, Trash2, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBuilder, validateAll } from './builderStore';
import { getEditorEntry, SECTION_EDITOR_REGISTRY, sectionHealth } from './sectionEditorRegistry';
import { resolveText } from './localization';

export function SectionListPane() {
  const { state, dispatch } = useBuilder();
  const [addOpen, setAddOpen] = useState(false);
  const dragFrom = useRef<number | null>(null);

  const ordered = useMemo(
    () => [...state.sections].filter((s) => s.state !== 'deleted').sort((a, b) => (a.draft.order ?? 0) - (b.draft.order ?? 0)),
    [state.sections],
  );
  const liveIssues = useMemo(() => validateAll(state), [state]);
  const publishedCount = ordered.filter((s) => s.draft.status === 'PUBLISHED').length;
  const resolver = (key?: string) => resolveText(key, state.displayLocale, state.locEdits);

  const addSection = (type: string) => {
    const codes = new Set(ordered.map((s) => s.draft.code));
    let code = type;
    let n = 1;
    while (codes.has(code)) code = `${type}-${++n}`;
    dispatch({ type: 'addSection', sectionType: type, code });
    setAddOpen(false);
  };

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 text-sm font-semibold">Sections</span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-3 w-3" /> Add Section
        </Button>
      </div>
      <p className="m-0 px-3 py-1.5 text-[10px] text-muted-foreground">Drag to reorder sections</p>

      <ul className="m-0 flex-1 list-none overflow-y-auto p-3 pt-0">
        {ordered.map((s, i) => {
          const entry = getEditorEntry(s.draft.type);
          const Icon = entry?.icon ?? Settings;
          const code = s.draft.code ?? `#${i}`;
          const selected = state.selected === code;
          const hovered = state.hovered === code;
          const off = s.draft.enabled === false;
          const health = sectionHealth(s.draft, resolver);
          const errors = liveIssues.filter((x) => x.section === code && x.level === 'error');
          return (
            <li key={code} className="m-0 p-0">
              <div
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom.current !== null && dragFrom.current !== i) {
                    const code2 = ordered[dragFrom.current]?.draft.code;
                    if (code2) dispatch({ type: 'move', code: code2, toIndex: i });
                  }
                  dragFrom.current = null;
                }}
                onMouseEnter={() => dispatch({ type: 'hover', code })}
                onMouseLeave={() => dispatch({ type: 'hover', code: null })}
                onClick={() => dispatch({ type: 'select', id: code })}
                onKeyDown={(e) => e.key === 'Enter' && dispatch({ type: 'select', id: code })}
                className={`group mb-2 cursor-pointer rounded-lg border px-3 py-2.5 text-sm shadow-sm transition-all ${
                  selected
                    ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500/30'
                    : hovered
                      ? 'border-emerald-400/60 bg-accent/60'
                      : 'border-border bg-background hover:border-emerald-300/60 hover:shadow'
                } ${off ? 'opacity-55' : ''}`}
              >
                <div className="flex items-center gap-1.5">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60" />
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{entry?.label ?? code}</span>
                  {(errors.length > 0 || !health.ok) && (
                    <span title={errors[0]?.message ?? health.warnings[0]}>
                      <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${errors.length ? 'text-destructive' : 'text-amber-500'}`} />
                    </span>
                  )}
                  {/* enable toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!off}
                    aria-label={`${entry?.label ?? code} visible`}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: 'patchSection', code, patch: { enabled: off } });
                    }}
                    className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${off ? 'bg-muted-foreground/30' : 'bg-emerald-500'}`}
                  >
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${off ? 'left-0.5' : 'left-3.5'}`} />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={(e) => e.stopPropagation()} aria-label="Section actions">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => dispatch({ type: 'select', id: code, tab: 'visibility' })}>
                        <SlidersHorizontal className="mr-2 h-3.5 w-3.5" /> Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => dispatch({ type: 'duplicate', code })}>
                        <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => dispatch({ type: 'remove', code })}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-1 flex items-center gap-1.5 pl-9">
                  <Badge
                    variant="outline"
                    className={`h-4 px-1 text-[9px] ${
                      s.draft.status === 'PUBLISHED' ? 'border-emerald-600 text-emerald-700' : 'border-amber-500 text-amber-600'
                    }`}
                  >
                    {s.draft.status ?? 'DRAFT'}
                  </Badge>
                  {s.state !== 'clean' && <span className="text-[9px] font-medium text-amber-600">● modified</span>}
                </div>
              </div>
            </li>
          );
        })}

        <li className="m-0 p-0">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-1 w-full rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground hover:border-primary hover:text-foreground"
          >
            <Plus className="mr-1 inline h-3 w-3" /> Add Section
            <span className="block text-[10px]">Choose from section catalog</span>
          </button>
        </li>
      </ul>

      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        {ordered.length} sections · {publishedCount} Published · {ordered.length - publishedCount} Draft
      </div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'select', id: 'page' })}
        className={`flex items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium hover:bg-accent ${
          state.selected === 'page' ? 'bg-accent' : ''
        }`}
      >
        <Settings className="h-4 w-4 text-muted-foreground" /> Page Settings
      </button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Section catalog</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {Object.values(SECTION_EDITOR_REGISTRY).map((e) => {
              const Icon = e.icon;
              return (
                <button
                  key={e.type}
                  type="button"
                  onClick={() => addSection(e.type)}
                  className="rounded-md border border-border p-3 text-left hover:border-primary hover:bg-accent"
                >
                  <Icon className="mb-1 h-4 w-4 text-muted-foreground" />
                  <div className="text-sm font-medium">{e.label}</div>
                  <div className="line-clamp-2 text-[10px] text-muted-foreground">{e.description}</div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
