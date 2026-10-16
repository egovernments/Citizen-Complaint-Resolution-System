import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';

/** How long the page waits before it speaks: the role's screens register once its access policy has loaded, so a
 *  deep link opened by a role that MAY use the screen shows nothing for that moment rather than a false refusal. */
export const NO_ACCESS_SETTLE_MS = 1500;

/**
 * The management app's catch-all route. A screen the signed-in role may not use is not
 * registered for it (App.tsx `canViewResource`), and react-admin's default catch-all renders nothing: a blank page with
 * no word of why. This one says so and offers the way back.
 */
export function NoAccessPage() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), NO_ACCESS_SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div role="alert"><DigitCard className="max-w-xl p-6">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 mt-0.5 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">This page is not available</h1>
          <p className="text-sm text-muted-foreground">
            Your role does not have permission to use this screen, or the address does not exist. Ask an administrator
            if you need access.
          </p>
          <Link to="/manage" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Back to the dashboard</Link>
        </div>
      </div>
    </DigitCard></div>
  );
}
