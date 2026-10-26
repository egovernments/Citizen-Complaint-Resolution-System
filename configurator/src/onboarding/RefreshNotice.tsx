import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useOnboardingT } from './i18n';

/**
 * A refresh failed while an earlier load is still on screen. The table stays, but the user is
 * told it may be out of date, so they don't act on a list that is missing their last change.
 */
export function RefreshNotice({ onRetry }: { onRetry: () => void }) {
  const t = useOnboardingT();
  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{t('common.refresh_failed', 'Couldn’t refresh this list, so it may be out of date.')}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.try_again', 'Try again')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
