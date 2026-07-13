/** Left pane: page node + ordered section list (P4a, CCSD-2009).
 *
 * P4a interactions: select, enable/disable, move up/down (renumbers `order`).
 * P4c replaces the arrows with native HTML5 drag-and-drop; P4b adds
 * add/duplicate/delete. Status chip mirrors DRAFT rows.
 */
import { ArrowDown, ArrowUp, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBuilder } from './builderStore';
import { getEditorEntry } from './sectionEditorRegistry';

export function SectionListPane() {
  const { state, dispatch } = useBuilder();
  const ordered = [...state.sections]
    .filter((s) => s.state !== 'deleted')
    .sort((a, b) => (a.draft.order ?? 0) - (b.draft.order ?? 0));

  return (
    <div className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card">
      <button
        type="button"
        onClick={() => dispatch({ type: 'select', id: 'page' })}
        className={`flex items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm font-medium hover:bg-accent ${
          state.selected === 'page' ? 'bg-accent' : ''
        }`}
      >
        <Settings className="h-4 w-4 text-muted-foreground" />
        Page settings
      </button>

      <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        Sections
      </div>

      <ul className="m-0 flex-1 list-none p-0">
        {ordered.map((s, i) => {
          const entry = getEditorEntry(s.draft.type);
          const Icon = entry?.icon ?? Settings;
          const code = s.draft.code ?? `#${i}`;
          const selected = state.selected === code;
          const disabled = s.draft.enabled === false;
          return (
            <li key={code} className="m-0 p-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => dispatch({ type: 'select', id: code })}
                onKeyDown={(e) => e.key === 'Enter' && dispatch({ type: 'select', id: code })}
                className={`group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent ${
                  selected ? 'bg-accent' : ''
                } ${disabled ? 'opacity-50' : ''}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{entry?.label ?? code}</span>
                {s.draft.status === 'DRAFT' && (
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">DRAFT</Badge>
                )}
                {s.state !== 'clean' && (
                  <span aria-label="unsaved" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                )}
                {/* enable toggle */}
                <input
                  type="checkbox"
                  aria-label={`${entry?.label ?? code} enabled`}
                  checked={s.draft.enabled !== false}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    dispatch({ type: 'patchSection', code, patch: { enabled: e.target.checked } })
                  }
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                />
                <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                  <Button
                    variant="ghost" size="icon" className="h-5 w-5"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: 'move', code, dir: -1 }); }}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-5 w-5"
                    aria-label="Move down"
                    disabled={i === ordered.length - 1}
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: 'move', code, dir: 1 }); }}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
