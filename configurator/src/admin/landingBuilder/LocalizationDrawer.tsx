/** Inline localization drawer (P4, CCSD-2009): edit one key across ALL
 * supported languages without leaving the Builder. Edits are STAGED in the
 * draft store (locEdits) — preview updates live via the bridge, persistence
 * happens with Save Draft through the existing localization API.
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useBuilder } from './builderStore';
import { BUILDER_LOCALES, resolveText } from './localization';

export function LocalizationDrawer({
  open, onClose, locKey, title,
}: {
  open: boolean;
  onClose: () => void;
  locKey: string;
  title: string;
}) {
  const { state, dispatch } = useBuilder();
  const [visible, setVisible] = useState(open);
  useEffect(() => setVisible(open), [open]);
  if (!visible) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l border-border bg-card shadow-xl" role="dialog" aria-label={`Translations for ${title}`}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-sm font-semibold">Translations — {title}</h2>
            <p className="m-0 truncate text-[10px] text-muted-foreground" title={locKey}>{locKey}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {BUILDER_LOCALES.map((l) => {
            const value = resolveText(locKey, l.code, state.locEdits) ?? '';
            return (
              <div key={l.code} className="space-y-1">
                <Label className="text-xs font-medium">{l.label}</Label>
                <textarea
                  value={value}
                  onChange={(e) =>
                    dispatch({ type: 'patchLoc', locale: l.code, key: locKey, text: e.target.value, coalesce: `loc:${locKey}:${l.code}` })
                  }
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>
            );
          })}
          <p className="m-0 text-[10px] text-muted-foreground">
            Changes preview instantly and are saved with <strong>Save Draft</strong>.
          </p>
        </div>
        <div className="border-t border-border p-3">
          <Button size="sm" className="w-full" onClick={onClose}>Done</Button>
        </div>
      </aside>
    </>
  );
}
