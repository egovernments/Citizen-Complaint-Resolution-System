// The LIST-page cell renderers a descriptor can ask for by name
// (FieldSpec.listWidget).
//
// Kept out of the descriptors themselves on purpose: descriptors are plain
// serializable data with no React import (same reason `customEditor` is a
// string key), so the mapping from name to component lives here. The function
// that grafts these onto generated columns is `applyDescriptorListWidgets` in
// schemaUtils.ts, beside the other column post-processor.
import { Badge } from '@/components/ui/badge';
import type { ListWidgetKind } from '../schemaDescriptors';
import { badgeValues, namedBadgeValues, tokenSummary } from '../listWidgets';

/** Nothing to show — the same muted dash the generic renderer uses. */
function Empty() {
  return <span className="text-muted-foreground">--</span>;
}

function Chips({ values }: { values: string[] }) {
  if (values.length === 0) return <Empty />;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {values.map((v) => (
        <Badge key={v} variant="outline" className="text-[10px] font-normal">
          {v}
        </Badge>
      ))}
    </span>
  );
}

export function ListWidgetCell({ kind, value }: { kind: ListWidgetKind; value: unknown }) {
  switch (kind) {
    case 'badges':
      return <Chips values={badgeValues(value)} />;
    case 'named-badges':
      return <Chips values={namedBadgeValues(value)} />;
    case 'token-summary': {
      const summary = tokenSummary(value);
      if (summary.count === 0) return <Empty />;
      return (
        // The whole vocabulary is in the title, and on the row's Show page; the
        // cell itself stays one line so the table can be scanned.
        <span className="whitespace-nowrap text-xs" title={summary.full}>
          <span className="font-medium">{summary.count}</span>
          <span className="text-muted-foreground">
            {' · '}
            {summary.preview.join(' ')}
            {summary.truncated ? ' …' : ''}
          </span>
        </span>
      );
    }
    case 'plain':
    default: {
      const shown = value == null || value === '' ? '' : String(value);
      return shown ? <Badge variant="outline" className="text-[10px] font-normal">{shown}</Badge> : <Empty />;
    }
  }
}
