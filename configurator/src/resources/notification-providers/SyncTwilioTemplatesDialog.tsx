// "Sync from Twilio" — the UI equivalent of the CLI
// local-setup/scripts/persist-provider-templates.py.
//
// Flow: (1) pull the operator's OWN approved Twilio WhatsApp Content templates
// from the bridge (already reconciled server-side against the PGR routing
// tuples); (2) let the operator review the auto-matched rows + see unmatched
// diagnostics; (3) confirm + upsert the selected rows into MDMS
// RAINMAKER-PGR.NotificationProviderTemplate (resource `notification-provider-template`).
//
// WHY THE WRITE PATH WORKS (identical mechanics to NotificationConfigure): the
// schema declares x-unique = [provider, channel, audience, action, toState,
// locale]; egov-mdms-service v2 derives `uniqueIdentifier` server-side by joining
// those with '.', so the deterministic uid we compute here is exactly the id
// react-admin reads back (dataProvider normalizeMdmsRecord sets id =
// uniqueIdentifier). Create-if-absent, update carrying the existing id (the
// dataProvider re-fetches + carries auditDetails) if present — idempotent, safe
// to re-run. Twilio secrets never reach the client; we only receive the SID map.

import { useState } from 'react';
import { useCreate, useUpdate, useGetList, useRefresh, useTranslate } from 'ra-core';
import { Loader2, RefreshCw, ChevronRight, AlertTriangle, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { isMdmsDuplicate, type Mutate } from '../notification-configure/notificationWritePath';
import {
  syncTwilioTemplates,
  type TwilioMatchedTemplate,
  type TwilioTemplatesResponse,
} from './providerApi';

const RESOURCE = 'notification-provider-template';
const RETURN_PROMISE = { returnPromise: true };

/** x-unique join = the server-derived MDMS uniqueIdentifier for a matched row. */
function uidOf(row: TwilioMatchedTemplate): string {
  return [row.provider, row.channel, row.audience, row.action, row.toState, row.locale].join('.');
}

/** Project a bridge row down to the persisted MDMS `data` object. The schema is
 *  additionalProperties:false, so we send ONLY the declared fields (drop any
 *  transport-only extras defensively — mirrors the CLI mdms_data()). */
function mdmsData(row: TwilioMatchedTemplate): Record<string, unknown> {
  return {
    provider: row.provider,
    channel: row.channel,
    audience: row.audience,
    action: row.action,
    toState: row.toState,
    locale: row.locale,
    templateId: row.templateId,
    templateName: row.templateName,
    variables: row.variables ?? [],
    approvalStatus: row.approvalStatus,
    active: row.active ?? true,
  };
}

function isApproved(row: TwilioMatchedTemplate): boolean {
  return String(row.approvalStatus ?? '').toLowerCase() === 'approved';
}

/** Truncate a long SID for the table (full value kept in a title tooltip). */
function truncateId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

type RowResult = { uid: string; action: 'created' | 'updated'; ok: boolean; error?: string };

function notify(title: string, description?: string, variant?: 'default' | 'destructive') {
  toast({ title, description, variant });
}

export function SyncTwilioTemplatesDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslate();
  const refresh = useRefresh();
  const [create] = useCreate();
  const [update] = useUpdate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<TwilioTemplatesResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);

  const [persisting, setPersisting] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});

  // Existing provider-template rows — react-admin id === MDMS uniqueIdentifier,
  // so this set tells us create-vs-update per row before we write (mirrors the
  // CLI's "search the master once, then decide per row").
  const { data: existing } = useGetList(RESOURCE, {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'action', order: 'ASC' },
  });
  const existingIds = new Set((existing ?? []).map((r) => String(r.id)));

  const reset = () => {
    setLoading(false);
    setError(null);
    setResp(null);
    setSelected(new Set());
    setShowSkipped(false);
    setPersisting(false);
    setResults({});
  };

  // Pull from Twilio. Default-select every APPROVED matched row.
  const sync = async () => {
    setLoading(true);
    setError(null);
    setResp(null);
    setResults({});
    try {
      const data = await syncTwilioTemplates();
      setResp(data);
      const preselect = new Set(
        (data.matched ?? []).filter(isApproved).map(uidOf),
      );
      setSelected(preselect);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to sync templates from Twilio');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (uid: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const matched = resp?.matched ?? [];
  const unmatched = resp?.unmatched ?? [];
  const selectedRows = matched.filter((r) => selected.has(uidOf(r)));

  // Upsert one row: update-in-place when it already exists, else create. Carries
  // the CLI's create-then-fallback safety for a create/create race
  // (MDMS_DUPLICATE -> update-with-reactivation).
  const persistRow = async (row: TwilioMatchedTemplate): Promise<RowResult> => {
    const uid = uidOf(row);
    const data = mdmsData(row);
    const willUpdate = existingIds.has(uid);
    try {
      if (willUpdate) {
        await (update as unknown as Mutate)(
          RESOURCE,
          { id: uid, data, previousData: {}, meta: { includeInactive: true } },
          RETURN_PROMISE,
        );
        return { uid, action: 'updated', ok: true };
      }
      try {
        await (create as unknown as Mutate)(RESOURCE, { data }, RETURN_PROMISE);
        return { uid, action: 'created', ok: true };
      } catch (err) {
        if (isMdmsDuplicate(err)) {
          await (update as unknown as Mutate)(
            RESOURCE,
            { id: uid, data, previousData: {}, meta: { includeInactive: true } },
            RETURN_PROMISE,
          );
          return { uid, action: 'updated', ok: true };
        }
        throw err;
      }
    } catch (err) {
      return {
        uid,
        action: willUpdate ? 'updated' : 'created',
        ok: false,
        error: (err as Error)?.message ?? 'unknown error',
      };
    }
  };

  const persist = async () => {
    if (selectedRows.length === 0) return;
    setPersisting(true);
    const collected: Record<string, RowResult> = {};
    for (const row of selectedRows) {
      const res = await persistRow(row);
      collected[res.uid] = res;
      setResults({ ...collected }); // progressive per-row feedback
    }
    setPersisting(false);

    const okCount = Object.values(collected).filter((r) => r.ok).length;
    const failCount = Object.values(collected).length - okCount;
    notify(
      t('app.providers.sync_persist_done', { _: 'Provider templates persisted.' }),
      t('app.providers.sync_persist_summary', {
        _: '%{ok} saved, %{fail} failed.',
        ok: okCount,
        fail: failCount,
      }),
      failCount > 0 ? 'destructive' : 'default',
    );
    refresh(); // refresh the list + our existingIds set for the next run
  };

  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('app.providers.sync_title', { _: 'Sync WhatsApp Templates from Twilio' })}</DialogTitle>
          <DialogDescription>
            {t('app.providers.sync_hint', {
              _: 'Pull your account\'s approved WhatsApp Content templates, review the matched '
                + 'routing rows, then persist them into the notification provider-template master. '
                + 'Twilio credentials stay server-side — only the approved template SIDs are returned.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button size="sm" className="gap-1.5" onClick={sync} disabled={loading || persisting}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {resp
                ? t('app.providers.sync_again', { _: 'Sync again' })
                : t('app.providers.sync_pull', { _: 'Sync from Twilio' })}
            </Button>
            {resp && (
              <span className="text-xs text-muted-foreground">
                {t('app.providers.sync_counts', {
                  _: '%{matched} matched · %{unmatched} skipped · %{total} total',
                  matched: matched.length,
                  unmatched: unmatched.length,
                  total: resp.total ?? matched.length + unmatched.length,
                })}
              </span>
            )}
          </div>

          {/* Error — surface bridge errors (e.g. NB_NO_TWILIO_INTEGRATION) cleanly. */}
          {error && !loading && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{error}</p>
                {/NB_NO_TWILIO_INTEGRATION|no twilio|integration/i.test(error) && (
                  <p className="mt-1 text-xs">
                    {t('app.providers.sync_no_integration', {
                      _: 'Add a Twilio WhatsApp provider on this page first, then sync again.',
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Review table of matched rows. */}
          {resp && matched.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <div className="max-h-[42vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="w-8 px-2 py-2">
                        <input
                          type="checkbox"
                          className="rounded"
                          aria-label={t('app.providers.sync_select_all', { _: 'Select all' })}
                          checked={selectedRows.length === matched.length && matched.length > 0}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedRows.length > 0 && selectedRows.length < matched.length;
                          }}
                          onChange={(e) =>
                            setSelected(e.target.checked ? new Set(matched.map(uidOf)) : new Set())
                          }
                        />
                      </th>
                      <th className="px-2 py-2 font-medium">{t('app.providers.sync_col_audience', { _: 'Audience' })}</th>
                      <th className="px-2 py-2 font-medium">{t('app.providers.sync_col_transition', { _: 'Action → State' })}</th>
                      <th className="px-2 py-2 font-medium">{t('app.providers.sync_col_locale', { _: 'Locale' })}</th>
                      <th className="px-2 py-2 font-medium">{t('app.providers.sync_col_template', { _: 'Template SID' })}</th>
                      <th className="px-2 py-2 font-medium">{t('app.providers.sync_col_vars', { _: 'Vars' })}</th>
                      <th className="px-2 py-2 font-medium">{t('app.providers.sync_col_status', { _: 'Approval' })}</th>
                      <th className="px-2 py-2 font-medium text-right">{t('app.providers.sync_col_result', { _: 'Result' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((row) => {
                      const uid = uidOf(row);
                      const res = results[uid];
                      const willUpdate = existingIds.has(uid);
                      return (
                        <tr key={uid} className="border-t border-border/60 hover:bg-muted/20">
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              className="rounded"
                              aria-label={uid}
                              checked={selected.has(uid)}
                              onChange={() => toggle(uid)}
                              disabled={persisting}
                            />
                          </td>
                          <td className="px-2 py-1.5">{row.audience}</td>
                          <td className="px-2 py-1.5">
                            <span className="font-medium">{row.action}</span>
                            <span className="text-muted-foreground"> → {row.toState}</span>
                          </td>
                          <td className="px-2 py-1.5 font-mono">{row.locale}</td>
                          <td className="px-2 py-1.5 font-mono" title={row.templateId}>{truncateId(row.templateId)}</td>
                          <td className="px-2 py-1.5" title={(row.variables ?? []).join(', ')}>{(row.variables ?? []).length}</td>
                          <td className="px-2 py-1.5">
                            <Badge
                              variant={isApproved(row) ? 'success' : 'warning'}
                              className="text-[10px]"
                            >
                              {row.approvalStatus ?? 'unknown'}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {res ? (
                              res.ok ? (
                                <span className="inline-flex items-center gap-1 text-green-700" title={res.uid}>
                                  <Check className="w-3.5 h-3.5" /> {res.action}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-700" title={res.error}>
                                  <X className="w-3.5 h-3.5" /> {t('app.providers.sync_failed', { _: 'failed' })}
                                </span>
                              )
                            ) : (
                              <span className="text-[10px] uppercase text-muted-foreground">
                                {willUpdate
                                  ? t('app.providers.sync_will_update', { _: 'update' })
                                  : t('app.providers.sync_will_create', { _: 'new' })}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resp && matched.length === 0 && !error && (
            <p className="text-sm text-muted-foreground py-2">
              {t('app.providers.sync_none', {
                _: 'No approved Twilio Content templates map to the PGR routing tuples yet.',
              })}
            </p>
          )}

          {/* Collapsed "N skipped" diagnostics. */}
          {unmatched.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50/60">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-amber-800"
                onClick={() => setShowSkipped((v) => !v)}
              >
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showSkipped ? 'rotate-90' : ''}`} />
                {t('app.providers.sync_skipped', {
                  _: '%{n} skipped (not mapped / not approved)',
                  n: unmatched.length,
                })}
              </button>
              {showSkipped && (
                <ul className="px-3 pb-2 space-y-1">
                  {unmatched.map((u) => (
                    <li key={u.templateId} className="text-xs text-amber-900 flex gap-2">
                      <span className="font-medium truncate">{u.templateName || u.templateId}</span>
                      <span className="text-amber-700">— {u.skipReason || u.approvalStatus || 'unmatched'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground self-center">
            {selectedRows.length > 0 &&
              t('app.providers.sync_selected_count', {
                _: '%{n} selected',
                n: selectedRows.length,
              })}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={persisting}>
              {t('ra.action.close', { _: 'Close' })}
            </Button>
            <Button onClick={persist} disabled={selectedRows.length === 0 || persisting || loading}>
              {persisting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('app.providers.sync_persist', {
                _: 'Persist %{n} selected',
                n: selectedRows.length,
              })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
