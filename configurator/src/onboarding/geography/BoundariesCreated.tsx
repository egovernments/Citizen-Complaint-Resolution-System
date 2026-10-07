import { AlertTriangle, ArrowLeft, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * The end of a boundary import, in the Geography step's own style: what was
 * created, level by level, where it came from, and the way back.
 */
export function BoundariesCreated({
  levels,
  counts,
  total,
  hierarchyType,
  workspace,
  sourceText,
  skipped = 0,
  failed = 0,
  attribution,
  onDone,
}: {
  /** The hierarchy's level names, broadest first. */
  levels: string[];
  counts: Record<string, number>;
  total: number;
  hierarchyType: string;
  /** The workspace's name, or its tenant code when the name isn't known. */
  workspace: string;
  /** Where the areas came from, e.g. "the official boundaries for Kenya". */
  sourceText: string;
  /** Areas left out before create (unnamed, or in no area of the level above). */
  skipped?: number;
  /** Areas boundary-service refused; the error above the screen says why. */
  failed?: number;
  attribution?: string | null;
  onDone: () => void;
}) {
  // All, some or none of the areas made it: the header must not call a failure a success.
  const outcome = failed === 0 ? 'created' : total > 0 ? 'partial' : 'failed';
  const Icon = outcome === 'created' ? Check : outcome === 'partial' ? AlertTriangle : X;
  const tone =
    outcome === 'created' ? 'bg-success/10 text-success' : outcome === 'partial' ? 'bg-amber-50 text-amber-800' : 'bg-destructive/10 text-destructive';
  const n = (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'area' : 'areas'}`;
  return (
    <section className="max-w-3xl space-y-6" data-testid="boundaries-created" data-outcome={outcome}>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <div className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${tone}`}>
          <Icon className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">
            {outcome === 'created' ? 'Boundaries created' : outcome === 'partial' ? 'Some boundaries were not created' : 'No boundaries were created'}
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {outcome === 'failed' ? (
              <>
                All {n(failed)} from {sourceText} were refused by the boundary service. Nothing was added to the{' '}
                <span className="font-medium text-foreground">{hierarchyType}</span> hierarchy on {workspace}.
              </>
            ) : (
              <>
                {n(total)} in the <span className="font-medium text-foreground">{hierarchyType}</span> hierarchy on{' '}
                {workspace}, from {sourceText}.
                {outcome === 'partial' && ` ${n(failed)} could not be created.`}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Level</TableHead>
              <TableHead className="text-right">Areas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {levels.map((level, i) => (
              <TableRow key={level}>
                <TableCell>
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-xs font-medium text-primary">
                    {i + 1}
                  </span>
                  {level}
                </TableCell>
                <TableCell className="text-right tabular-nums">{(counts[level] ?? 0).toLocaleString('en-US')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Total</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{total.toLocaleString('en-US')}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {(skipped > 0 || attribution) && (
        <div className="space-y-1 text-sm text-muted-foreground">
          {skipped > 0 && (
            <p>
              {skipped.toLocaleString('en-US')} {skipped === 1 ? 'area was' : 'areas were'} left out: unnamed, or lying in
              no area of the level above. The review step listed them.
            </p>
          )}
          {attribution && (
            <p className="text-xs" data-testid="boundary-attribution">
              {attribution}
            </p>
          )}
        </div>
      )}

      <Button onClick={onDone} className="h-10 gap-2 px-5">
        <ArrowLeft className="w-4 h-4" />
        Back to Geography
      </Button>
    </section>
  );
}
