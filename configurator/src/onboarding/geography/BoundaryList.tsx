import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { areasInside, type BoundaryDraft, type BoundarySelection } from './boundaryDraft';
import { useOnboardingT } from '../i18n';

/** What a selection is called in the list: the place it was fetched for, or the uploaded file. */
function selectionTitle(selection: BoundarySelection): string {
  return selection.resume.kind === 'osm' ? selection.resume.fetchedPlace.label : (selection.resume.file?.name ?? selection.sourceText);
}

/**
 * Boundaries added in Geography but not saved yet, one list item per thing
 * added, below the sources. Edit reopens that item's import; Remove takes the
 * whole item off, once no other item's areas sit inside it.
 */
export function BoundaryList({
  draft,
  summarize,
  disabled = false,
  removeBody,
  onEdit,
  onRemove,
}: {
  draft: BoundaryDraft;
  /** "1 county · 17 sub-counties · 86 wards", as the saved hierarchies show it. */
  summarize: (selection: BoundarySelection) => string;
  /** While the list is being saved. */
  disabled?: boolean;
  /** What Remove's confirmation says, when more than that nothing is saved. */
  removeBody?: string;
  onEdit: (selection: BoundarySelection) => void;
  onRemove: (selection: BoundarySelection) => void;
}) {
  const t = useOnboardingT();
  return (
    <TooltipProvider delayDuration={150}>
      {draft.selections.map((selection) => {
        const name = selectionTitle(selection);
        const inside = areasInside(draft, selection.id);
        const removeLabel = t('common.remove_named', 'Remove %{name}', { name });
        return (
          <li key={selection.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4" data-testid="boundary-list-item">
            <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">
                {name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{t('geography.list.not_saved', 'Not saved yet')}</span>
              </p>
              {selection.boundaries.length > 0 && <p className="text-sm text-muted-foreground">{summarize(selection)}</p>}
              {selection.unnamed.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {selection.unnamed.length === 1
                    ? t('geography.list.names_one', 'Adds a name to 1 area already saved.')
                    : t('geography.list.names_other', 'Adds names to %{count} areas already saved.', {
                        count: selection.unnamed.length.toLocaleString('en-US'),
                      })}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{selection.levels.join(' → ')}</p>
            </div>
            <div className="flex flex-shrink-0 items-center whitespace-nowrap">
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onEdit(selection)}
                aria-label={t('common.edit_named', 'Edit %{name}', { name })}
              >
                {t('common.edit', 'Edit')}
              </Button>
              {inside > 0 ? (
                // Kept focusable, so the reason it's unavailable can be read.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-disabled="true"
                      aria-label={removeLabel}
                      className="cursor-not-allowed text-destructive opacity-50 hover:bg-transparent hover:text-destructive"
                    >
                      {t('common.remove', 'Remove')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {inside === 1
                      ? t('geography.list.inside_one', '1 area from another item in your list sits inside these. Remove that first.')
                      : t('geography.list.inside_other', '%{count} areas from another item in your list sit inside these. Remove those first.', {
                          count: inside.toLocaleString('en-US'),
                        })}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <DeleteConfirmDialog
                  title={t('common.remove_confirm', 'Remove %{name}?', { name })}
                  description={removeBody ?? t('geography.list.remove_body', 'These boundaries haven’t been saved, so nothing else changes.')}
                  onConfirm={() => onRemove(selection)}
                  disabled={disabled}
                  trigger={
                    <Button variant="ghost" size="sm" disabled={disabled} className="text-destructive hover:text-destructive" aria-label={removeLabel}>
                      {t('common.remove', 'Remove')}
                    </Button>
                  }
                />
              )}
            </div>
          </li>
        );
      })}
    </TooltipProvider>
  );
}
