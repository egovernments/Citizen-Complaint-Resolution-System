// The banner a READ-ONLY master shows on its list and show screens.
//
// A resource is read-only when its configuration moved somewhere else (the
// legacy RAINMAKER-PGR.Notification* four) or when another system owns the rows
// (the module-generated event catalogue). In both cases the rows are still real
// — on a tenant whose copy step has not run, the legacy rows ARE what gets
// delivered — so the screen must show them AND explain, in one place, why there
// is no Create button and what to do instead. A greyed-out button with no
// explanation is how an operator ends up re-typing the configuration into a
// second master.
//
// Renders nothing for a writable resource, so callers can drop it in
// unconditionally.

import { AlertTriangle } from 'lucide-react';
import { readOnlyNoticeFor } from '@/providers/bridge';

export function ReadOnlyResourceNotice({ resource }: { resource: string }) {
  const notice = readOnlyNoticeFor(resource);
  if (!notice) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <div className="font-medium">Read-only</div>
        <p className="mt-0.5 leading-relaxed">{notice}</p>
      </div>
    </div>
  );
}

export default ReadOnlyResourceNotice;
