// The note a schema descriptor can put at the TOP of its create/edit form.
//
// It exists because a "prefer the other screen" warning written as a code
// comment above a descriptor is a warning nobody who needs it will ever read.
// The raw notification masters use it to point at Notifications → Configure,
// which is the screen that cannot produce a mismatched routing/template pair.
//
// Renders nothing when the descriptor has no notice, so callers drop it in
// unconditionally.

import { Info } from 'lucide-react';
import type { SchemaDescriptor } from './schemaDescriptors/types';

export function DescriptorNotice({ descriptor }: { descriptor?: SchemaDescriptor }) {
  const notice = descriptor?.notice;
  if (!notice) return null;
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="leading-relaxed">{notice}</p>
    </div>
  );
}

export default DescriptorNotice;
