import { useMemo, useState } from 'react';
import { Hash, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { parseMask, previewMask, rowsToNumberFormat, toRows, type Row } from './numberFormatMask';

export function NumberFormatCard({
  value, onSave, disabled,
}: {
  value: unknown;
  onSave: (next: Record<string, string>) => Promise<void>;
  disabled?: boolean;
}) {
  // the parent remounts the card (key) when the saved record changes
  const [rows, setRows] = useState<Row[]>(() => toRows(value));
  const [saving, setSaving] = useState(false);

  const problems = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const locale = r.locale.trim();
      if (!locale && !r.mask.trim()) continue;
      if (!/^(default|[a-z]{2,3}_[A-Z]{2})$/.test(locale)) out.push(`"${locale || '(empty)'}" is not a locale code (e.g. en_IN) or "default"`);
      if (seen.has(locale)) out.push(`${locale} is listed twice`);
      seen.add(locale);
      if (!parseMask(r.mask)) out.push(`${locale || 'a row'}: "${r.mask}" is not a mask (use #, 0 and . , space ' _ as separators)`);
    }
    return out;
  }, [rows]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(rowsToNumberFormat(rows));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-primary" />
          <CardTitle>Number format</CardTitle>
        </div>
        <CardDescription className="mt-2">
          How the supervisor dashboard writes numbers, per language: the separators for thousands and decimals.
          "default" applies to languages without their own row; a language with neither keeps the dashboard's built-in format.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* a grid, not a table: the screen's KPI tab owns the page's table */}
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2" role="group" aria-label="Number formats">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Language</span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mask</span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Example</span>
          <span />
          {rows.map((r, i) => (
            <div key={i} className="contents">
              <Input aria-label={`Number format language ${i + 1}`} value={r.locale} disabled={disabled || saving}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, locale: e.target.value } : x)))} />
              <Input aria-label={`Number format mask ${i + 1}`} value={r.mask} disabled={disabled || saving}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, mask: e.target.value } : x)))} />
              <span className="font-mono text-sm text-muted-foreground">{previewMask(r.mask) ?? '—'}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove number format ${i + 1}`} disabled={disabled || saving}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-destructive" role="alert">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div className="flex gap-2">
          <Button variant="outline" disabled={disabled || saving}
            onClick={() => setRows([...rows, { locale: rows.some((r) => r.locale === 'default') ? '' : 'default', mask: '#,##0.00' }])}>
            <Plus /> Add language
          </Button>
          <Button onClick={() => void save()}
            disabled={disabled || saving || problems.length > 0 || Object.keys(rowsToNumberFormat(rows)).length === 0}>
            Save number format
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
