import { useState } from 'react';
import { useInput } from 'ra-core';
import { useWatch } from 'react-hook-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { AlertTriangle, FlaskConical } from 'lucide-react';

// "Make this a testing tenant" — writes the `isTestingTenant` flag onto the
// tenant record (MDMS accepts it as an additive field). The flag is what the
// citizen/employee UIs read to route a tenant to the gated /digit-ui-test
// entrance and hide it from production surfaces — replacing the old
// deploy-time globalConfigs TESTING_TENANT_ID pin with per-tenant data an
// ADMIN can toggle here.
//
// Guard rails against mistakenly flagging production:
//   1. The tenant NAME must contain "Testing" (case-insensitive).
//   2. Root/state tenants (code without a ".") cannot be flagged — only
//      sub-tenants. This blocks marking e.g. `mz` itself.
//   3. Enabling shows a confirmation dialog spelling out the consequences.
const NAME_MUST_CONTAIN = /testing/i;
const isSubTenant = (code?: string) => !!code && code.includes('.');

export function TestingTenantToggle() {
  const { id, field } = useInput({ source: 'isTestingTenant', parse: (v: boolean) => v });
  const name = (useWatch({ name: 'name' }) as string | undefined) ?? '';
  const code = (useWatch({ name: 'code' }) as string | undefined) ?? '';

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState<string[]>([]);

  const checked = !!field.value;

  const attemptEnable = () => {
    const reasons: string[] = [];
    if (!NAME_MUST_CONTAIN.test(name)) {
      reasons.push('The tenant Name must contain the word "Testing" (e.g. "IGE Testing").');
    }
    if (!isSubTenant(code)) {
      reasons.push('Only a sub-tenant can be a testing tenant — a root/state tenant cannot be flagged.');
    }
    if (reasons.length) {
      setBlockReason(reasons);
      setBlockOpen(true); // checkbox stays unchecked (value not set)
      return;
    }
    setConfirmOpen(true); // wait for explicit confirmation before enabling
  };

  const onToggle = (next: boolean) => {
    if (!next) {
      field.onChange(false); // disabling is immediate
      return;
    }
    attemptEnable();
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/50 p-3">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          onBlur={field.onBlur}
          className="h-4 w-4 rounded border-gray-300"
        />
        <Label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <FlaskConical className="h-4 w-4 text-amber-600" />
          Make this a testing tenant
        </Label>
      </div>
      <p className="mt-1 pl-6 text-xs text-muted-foreground">
        Routes this tenant to the gated <code>/digit-ui-test</code> entrance and hides it from
        production. Name must contain "Testing".
      </p>

      {/* Confirmation before enabling */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-amber-600" />
              Make “{name || code}” a testing tenant?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Flagging this tenant as a testing tenant will:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Show it <strong>only</strong> on the password-gated <code>/digit-ui-test</code> entrance.</li>
                  <li><strong>Hide</strong> it from the production citizen and employee UIs (dispatcher, complaints list, login institutions).</li>
                  <li>Keep its complaints out of production reports (complaints filed here are test data).</li>
                </ul>
                <p className="flex items-start gap-1.5 rounded bg-amber-100 p-2 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Only do this for a genuine QA/testing tenant. Real citizens and employees will lose access to it on the production entrance.</span>
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                field.onChange(true);
                setConfirmOpen(false);
              }}
            >
              Yes, make it a testing tenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Blocked (validation failed) */}
      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Can’t flag this tenant as testing
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This safeguard prevents marking a production tenant by mistake:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {blockReason.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBlockOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
