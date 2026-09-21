// Shared presentation for validateNotifications findings.
//
// Used by the Configure tab's Validate panel, by its inline add/edit form and
// by the generic MDMS create/edit forms, so an operator sees the same rule id
// and the same wording wherever notification configuration is edited.

import { Badge } from '@/components/ui/badge';
import type { ValidationFinding } from '../workflow-services/validateNotifications';

export function FindingList({
  findings,
  className = '',
}: {
  findings: ValidationFinding[];
  className?: string;
}) {
  if (findings.length === 0) return null;
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {findings.map((f, i) => (
        <li
          key={`${f.rule}-${f.ref ?? ''}-${i}`}
          className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-xs ${
            f.level === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <Badge variant={f.level === 'error' ? 'destructive' : 'warning'} className="text-[10px] uppercase">
              {f.level}
            </Badge>
            <span className="font-mono font-medium">{f.rule}</span>
          </div>
          <span>{f.message}</span>
          {f.ref && <span className="font-mono text-[11px] opacity-70">{f.ref}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The banner a save path shows: what blocked (if anything) and what is merely
 * advisory. `blocking` is what the operator MUST fix; `advisory` includes
 * warnings and errors that were already there on rows this edit does not touch,
 * so it is explicitly labelled as not standing in the way.
 */
export function GuardBanner({
  blocking,
  advisory,
  className = '',
}: {
  blocking: ValidationFinding[];
  advisory: ValidationFinding[];
  className?: string;
}) {
  if (blocking.length === 0 && advisory.length === 0) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {blocking.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-800">
            {blocking.length === 1
              ? 'This change cannot be saved until the following is fixed:'
              : `This change cannot be saved until the following ${blocking.length} problems are fixed:`}
          </p>
          <FindingList findings={blocking} className="mt-1.5" />
        </div>
      )}
      {advisory.length > 0 && (
        <details className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {advisory.length} other finding{advisory.length === 1 ? '' : 's'} in this tenant&apos;s notification
            configuration — these do not block this save
          </summary>
          <FindingList findings={advisory} className="mt-2" />
        </details>
      )}
    </div>
  );
}
