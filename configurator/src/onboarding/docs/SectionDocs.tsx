import type { ReactNode } from 'react';
import { BookOpen, ExternalLink, Library } from 'lucide-react';
import { trackEvent } from '@/lib/telemetry';
import { useOnboardingT } from '../i18n';
import { stepById } from '../steps';
import { DOCS_HOME, SECTION_DOCS, type DocsSection } from './docsLinks';

/**
 * Documentation for the onboarding section on screen: its guide and the docs
 * as a whole. The layout puts it beside the page on wide screens and under it
 * on narrower ones.
 */
export function SectionDocs({ section, className = '' }: { section: DocsSection; className?: string }) {
  const t = useOnboardingT();
  const guide =
    section === 'home'
      ? t('docs.getting_started', 'Getting started guide')
      : t('docs.section_guide', '%{section} guide', { section: t(`steps.${section}`, stepById(section).label) });
  const newTab = t('docs.new_tab', '(opens in a new tab)');

  const link = (href: string, link: 'guide' | 'all', icon: ReactNode, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} ${newTab}`}
      onClick={() => trackEvent('docs_click', { from: 'onboarding_docs', section, link })}
      className="group flex items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {icon}
      <span className="min-w-0">{label}</span>
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </a>
  );

  return (
    <aside aria-labelledby="section-docs-heading" className={`rounded-xl border border-border bg-card p-3 ${className}`}>
      <h2 id="section-docs-heading" className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-[0.5px] text-muted-foreground">
        {t('docs.heading', 'Documentation')}
      </h2>
      {/* A row under the page from sm up; a column again beside it from 1400px. */}
      <ul className="flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-2 min-[1400px]:flex-col">
        <li>{link(SECTION_DOCS[section], 'guide', <BookOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />, guide)}</li>
        <li>{link(DOCS_HOME, 'all', <Library aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />, t('docs.all', 'All documentation'))}</li>
      </ul>
    </aside>
  );
}
