/** Landing Page Builder — page assembly (P4a, CCSD-2009).
 *
 * Three-pane visual editor over the SAME MDMS resources as the P3 generic CRUD
 * (LandingSection / LandingPageConfig). Left: section list (select / enable /
 * reorder). Center: the production landing page in an iframe, driven from
 * draft state via postMessage. Right: registry-driven properties. Nothing
 * persists until Save; Save = validate -> diff-persist via DigitApiClient ->
 * refetch -> rebase.
 *
 * Mounted from (a) the /manage/landing-builder CustomRoute and (b) the
 * landing-sections customEditor escape hatch (row edit -> Builder pre-selected
 * on that section, via the :id route param).
 */
import { useCallback, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/hooks/use-toast';
import { useApp } from '../../App';
import {
  BuilderProvider, useBuilder, fetchAll, persist, validateAll, isDirty,
} from './builderStore';
import { SectionListPane } from './SectionListPane';
import { PreviewFrame } from './PreviewFrame';
import { PropertiesPane } from './PropertiesPane';

function BuilderInner() {
  const { state, dispatch } = useBuilder();
  const { state: app } = useApp();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  const tenantId = app.tenant ?? '';
  const preselect = params.id ?? search.get('select') ?? undefined;
  const dirty = isDirty(state);

  // Load both masters once.
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'loadStart' });
    fetchAll(tenantId)
      .then(({ sections, page }) => {
        if (!cancelled) dispatch({ type: 'hydrate', sections, page, select: preselect });
      })
      .catch((e) => !cancelled && dispatch({ type: 'loadError', error: String(e?.message ?? e) }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Unsaved-changes guard (browser navigation / close).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const onValidate = useCallback(() => {
    const issues = validateAll(state);
    dispatch({ type: 'setValidation', issues });
    if (issues.length === 0) toast({ title: 'Validation passed', description: 'No issues found.' });
    return issues;
  }, [state, dispatch]);

  const onSave = useCallback(async () => {
    const issues = validateAll(state);
    const errors = issues.filter((i) => i.level === 'error');
    dispatch({ type: 'setValidation', issues: issues.length ? issues : null });
    if (errors.length > 0) {
      toast({ title: 'Fix validation errors before saving', variant: 'destructive' });
      return;
    }
    dispatch({ type: 'saveStart' });
    try {
      await persist(state, tenantId);
      const { sections, page } = await fetchAll(tenantId);
      dispatch({ type: 'saveDone', sections, page });
      toast({ title: 'Saved', description: 'Landing configuration updated.' });
    } catch (e) {
      dispatch({ type: 'saveError', error: String((e as Error)?.message ?? e) });
      toast({ title: 'Save failed', description: String((e as Error)?.message ?? e), variant: 'destructive' });
    }
  }, [state, tenantId, dispatch]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/manage/landing-sections')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <h1 className="m-0 flex-1 text-base font-semibold">Landing Page Builder</h1>
        {dirty && <Badge variant="outline" className="border-amber-500 text-amber-600">Unsaved changes</Badge>}
        <Button variant="outline" size="sm" onClick={onValidate}>
          <CheckCircle2 className="mr-1 h-4 w-4" /> Validate
        </Button>
        <Button size="sm" onClick={onSave} disabled={!dirty || state.saving}>
          <Save className="mr-1 h-4 w-4" /> {state.saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {state.error && (
        <Alert variant="destructive" className="m-3">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.validation && state.validation.length > 0 && (
        <Alert className="m-3">
          <AlertDescription>
            <ul className="m-0 list-disc pl-4">
              {state.validation.map((i, n) => (
                <li key={n} className={i.level === 'error' ? 'text-destructive' : ''}>
                  {i.section ? `[${i.section}] ` : ''}{i.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Panes */}
      {state.loading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading landing configuration…</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <SectionListPane />
          <PreviewFrame />
          <PropertiesPane />
        </div>
      )}
    </div>
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
