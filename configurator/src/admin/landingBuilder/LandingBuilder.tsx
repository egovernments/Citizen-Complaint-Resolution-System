/** Landing Page Builder v2 — page assembly (P4, CCSD-2009).
 *
 * Visual editor over the SAME MDMS resources as the P3 generic CRUD. Layout:
 * section list (left) · LIVE production-page preview as the primary workspace
 * (center, flexible ≈60%) · Inspector (right). Draft rows + staged
 * localization edits persist only on Save Draft; Publish also promotes
 * enabled sections to PUBLISHED. Keyboard: Ctrl+S save · Ctrl+Z / Ctrl+Y
 * undo/redo. Live validation runs on every change.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { HelpCircle, History, LayoutList, Palette, PanelRight, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useApp } from '../../App';
import {
  BuilderProvider, useBuilder, fetchAll, persist, validateAll, isDirty,
} from './builderStore';
import { loadMessages, BUILDER_LOCALES } from './localization';
import { BuilderToolbar } from './BuilderToolbar';
import { SectionListPane } from './SectionListPane';
import { PreviewFrame } from './PreviewFrame';
import { Inspector } from './Inspector';

function BuilderInner() {
  const { state, dispatch } = useBuilder();
  const { state: app } = useApp();
  const navigate = useNavigate();
  // Workspace pane toggles (right icon rail): more canvas on demand.
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const params = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  const tenantId = app.tenant ?? '';
  const preselect = params.id ?? search.get('select') ?? undefined;
  const dirty = isDirty(state);

  // Load rows + warm the localization cache (both locales) once.
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'loadStart' });
    Promise.all([
      fetchAll(tenantId),
      ...BUILDER_LOCALES.map((l) => loadMessages(tenantId, l.code).catch(() => ({}))),
    ])
      .then(([{ sections, page }]) => {
        if (!cancelled) dispatch({ type: 'hydrate', sections, page, select: preselect });
      })
      .catch((e) => !cancelled && dispatch({ type: 'loadError', error: String((e as Error)?.message ?? e) }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Unsaved-changes guard.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const doSave = useCallback(async (publish: boolean) => {
    const issues = validateAll(state);
    const errors = issues.filter((i) => i.level === 'error');
    dispatch({ type: 'setValidation', issues: issues.length ? issues : null });
    if (errors.length > 0) {
      toast({ title: 'Fix validation errors first', description: errors[0].message, variant: 'destructive' });
      return;
    }
    dispatch({ type: 'saveStart' });
    try {
      await persist(state, tenantId, { publish });
      const { sections, page } = await fetchAll(tenantId);
      dispatch({ type: 'saveDone', sections, page });
      toast({ title: publish ? 'Published' : 'Draft saved', description: publish ? 'The public landing page is updated.' : 'Configuration + translations saved.' });
    } catch (e) {
      dispatch({ type: 'saveError', error: String((e as Error)?.message ?? e) });
      toast({ title: 'Save failed', description: String((e as Error)?.message ?? e), variant: 'destructive' });
    }
  }, [state, tenantId, dispatch]);

  const onValidate = useCallback(() => {
    const issues = validateAll(state);
    dispatch({ type: 'setValidation', issues: issues.length ? issues : null });
    if (!issues.length) toast({ title: 'Validation passed', description: 'No issues found.' });
  }, [state, dispatch]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); if (dirty && !state.saving) void doSave(false); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); dispatch({ type: 'redo' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave, dirty, state.saving, dispatch]);

  const errorCount = useMemo(
    () => (state.validation ?? []).filter((i) => i.level === 'error').length,
    [state.validation],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <BuilderToolbar
        onValidate={onValidate}
        onSaveDraft={() => void doSave(false)}
        onPublish={() => void doSave(true)}
      />

      {state.error && (
        <Alert variant="destructive" className="m-3">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.validation && state.validation.length > 0 && (
        <Alert className="m-3" variant={errorCount ? 'destructive' : undefined}>
          <AlertDescription>
            <ul className="m-0 list-disc pl-4">
              {state.validation.map((i, n) => (
                <li key={n}>{i.section ? `[${i.section}] ` : ''}{i.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {state.loading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading landing configuration…</p>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          {showLeft && <SectionListPane />}
          <PreviewFrame />
          {showRight && <Inspector />}

          {/* Right icon rail (mockup): Inspector / Structure / Theme / History / Help */}
          <div className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-l border-border bg-card py-2">
            <RailButton
              label="Inspector"
              active={showRight}
              icon={<PanelRight className="h-4 w-4" />}
              onClick={() => setShowRight((v) => !v)}
            />
            <RailButton
              label="Structure"
              active={showLeft}
              icon={<LayoutList className="h-4 w-4" />}
              onClick={() => setShowLeft((v) => !v)}
            />
            <RailButton
              label="Theme"
              icon={<Palette className="h-4 w-4" />}
              onClick={() => navigate('/manage/theme-config')}
            />
            <RailButton label="History (P5)" disabled icon={<History className="h-4 w-4" />} />
            <RailButton
              label="Help"
              active={showHelp}
              icon={<HelpCircle className="h-4 w-4" />}
              onClick={() => setShowHelp((v) => !v)}
            />
          </div>

          {showHelp && (
            <div className="absolute bottom-4 right-14 z-40 w-64 rounded-lg border border-border bg-card p-4 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="m-0 text-xs font-semibold">Tips & Shortcuts</h3>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowHelp(false)} aria-label="Close help">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="m-0 mb-3 text-[11px] leading-snug text-muted-foreground">
                Use localization keys to manage content in multiple languages. Click any element in
                the preview to edit it. Drag section cards to reorder.
              </p>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="font-mono text-muted-foreground">Ctrl+S</dt><dd className="m-0">Save Draft</dd>
                <dt className="font-mono text-muted-foreground">Ctrl+Z</dt><dd className="m-0">Undo</dd>
                <dt className="font-mono text-muted-foreground">Ctrl+Y</dt><dd className="m-0">Redo</dd>
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RailButton({ label, icon, onClick, active, disabled }: {
  label: string; icon: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-12 w-11 flex-col items-center justify-center gap-0.5 rounded-md text-muted-foreground transition-colors ${
        disabled ? 'opacity-40' : 'hover:bg-accent hover:text-foreground'
      } ${active ? 'bg-emerald-50 text-emerald-700' : ''}`}
    >
      {icon}
      <span className="text-[8px] leading-none">{label.replace(' (P5)', '')}</span>
    </button>
  );
}

export function LandingBuilder() {
  return (
    <BuilderProvider>
      <BuilderInner />
    </BuilderProvider>
  );
}

export default LandingBuilder;
