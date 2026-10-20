import { useTranslate } from 'ra-core';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenAppUrl, complaintDeskUrl, useWorkspaceSlug } from '@/identity/workspaceSlug';
import { notify } from '@/resources/notification-providers/providerToast';
import { useApp } from '../App';

/**
 * The two links a partner shares with their people: the employee app (staff
 * sign-in) and the citizen app. Shown as soon as the workspace slug is known,
 * not only after onboarding, because sign-in links matter from day one.
 */
export function WorkspaceLinksCard() {
  const t = useTranslate();
  const { state } = useApp();
  const slug = useWorkspaceSlug(state.tenant);

  const employeeUrl = complaintDeskUrl(state.environment, slug);
  const citizenUrl = citizenAppUrl(state.environment, slug);
  if (!employeeUrl || !citizenUrl) return null;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify(t('app.workspace_links.copied', { _: 'Link copied.' }));
    } catch {
      notify(t('app.providers.copy_failed', { _: 'Could not copy to clipboard.' }), undefined, 'destructive');
    }
  };

  const rows = [
    { key: 'employee', url: employeeUrl, label: 'Employee app', hint: 'Where your staff sign in and handle complaints' },
    { key: 'citizen', url: citizenUrl, label: 'Citizen app', hint: 'Share this with citizens to file and track complaints' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('app.workspace_links.title', { _: 'Workspace links' })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map(({ key, url, label, hint }) => (
          <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{t(`app.workspace_links.${key}_label`, { _: label })}</p>
              <p className="text-sm text-muted-foreground">{t(`app.workspace_links.${key}_hint`, { _: hint })}</p>
              <p className="mt-1 break-all font-mono text-sm select-all">{url}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => copy(url)}>
                <Copy className="mr-1 h-4 w-4" /> {t('app.workspace_links.copy', { _: 'Copy' })}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-4 w-4" /> {t('app.workspace_links.open', { _: 'Open' })}
                </a>
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
