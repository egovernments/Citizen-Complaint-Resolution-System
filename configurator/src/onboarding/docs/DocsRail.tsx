import { useEffect, useId, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { track } from '@/lib/analytics';
import { useOnboardingT } from '../i18n';
import { DIGIT_DOCS, docsFor, type DocsSection } from './docsLinks';
import { DOCS_BESIDE_PX, useMinWidth } from './useMinWidth';

const COLLAPSED_KEY = 'ccrs-onboarding-docs-collapsed';

function storedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage unavailable: the rail opens again next time, which is harmless.
  }
}

/** The page's guides, then where to start, then all of DIGIT's documentation. */
function DocsContent({ section }: { section: DocsSection }) {
  const t = useOnboardingT();
  const newTab = t('docs.new_tab', '(opens in a new tab)');
  return (
    <>
      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        {docsFor(section, t).map((group) => {
          const Icon = group.icon;
          return (
            <section key={group.id} className="space-y-1.5">
              <h3 className="flex items-center gap-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {group.title}
              </h3>
              <ul className="space-y-0.5">
                {group.links.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${link.title} ${newTab}`}
                      onClick={() => track('app:docs_open', { from: 'onboarding_docs', section, link: link.id })}
                      className="group flex items-start justify-between gap-2 rounded-md p-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground group-hover:text-primary">{link.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{link.description}</span>
                      </span>
                      <ExternalLink aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="border-t border-border p-3">
        <a
          href={DIGIT_DOCS}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('app:docs_open', { from: 'onboarding_docs', section, link: 'digit_docs' })}
          className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
          {t('app.nav.open_digit_docs', 'Open DIGIT Docs')}
        </a>
      </div>
    </>
  );
}

function DocsTitle() {
  const t = useOnboardingT();
  return (
    <span className="flex items-center gap-2">
      <BookOpen aria-hidden="true" className="h-4 w-4 text-primary" />
      <span className="text-sm font-medium text-foreground">{t('docs.heading', 'Documentation')}</span>
    </span>
  );
}

/**
 * The Documentation rail on the right of every onboarding page, the management
 * console's old docs pane brought back for onboarding (#2358). Beside the page
 * from DOCS_BESIDE_PX, where closing it is remembered; a strip below that, which
 * opens over the page. Below lg (phones and tablets, where even the strip would
 * cost the Employees table its width) DocsButton in the top bar opens it as a sheet.
 */
export function DocsRail({ section }: { section: DocsSection }) {
  const t = useOnboardingT();
  const panelId = useId();
  const beside = useMinWidth(DOCS_BESIDE_PX);
  const [closedBeside, setClosedBeside] = useState(storedCollapsed);
  // The page an overlay was opened on: going to another page, or widening the
  // window, closes it without having to reset anything.
  const [overlayFor, setOverlayFor] = useState<DocsSection | null>(null);
  const openOver = !beside && overlayFor === section;
  const open = beside ? !closedBeside : openOver;

  useEffect(() => {
    if (!openOver) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverlayFor(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [openOver]);

  const toggle = () => {
    if (beside) {
      setClosedBeside((closed) => {
        rememberCollapsed(!closed);
        return !closed;
      });
    } else {
      setOverlayFor(openOver ? null : section);
    }
  };

  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={open ? t('docs.hide', 'Hide documentation') : t('docs.show', 'Show documentation')}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {open ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
    </button>
  );

  return (
    <aside aria-label={t('docs.heading', 'Documentation')} className="relative hidden h-full shrink-0 lg:flex">
      {/* The strip: always there below DOCS_BESIDE_PX, and beside the page once the rail is closed. */}
      {!(beside && open) && (
        <div className="flex h-full w-12 flex-col items-center border-l border-border bg-card">
          <div className="flex h-14 w-full items-center justify-center border-b border-border">{toggleButton}</div>
          <button
            type="button"
            onClick={toggle}
            tabIndex={-1}
            aria-hidden="true"
            className="mt-4 text-muted-foreground transition-colors hover:text-primary"
          >
            <BookOpen className="h-5 w-5" />
          </button>
        </div>
      )}
      {open && (
        <div
          id={panelId}
          className={`flex h-full w-64 flex-col border-l border-border bg-card ${
            beside ? '' : 'absolute right-0 top-0 z-40 shadow-xl'
          }`}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            {toggleButton}
            <DocsTitle />
          </div>
          <DocsContent section={section} />
        </div>
      )}
    </aside>
  );
}

/** Phones and tablets: the same documentation, from a button in the top bar, as a sheet. */
export function DocsButton({ section }: { section: DocsSection }) {
  const t = useOnboardingT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('docs.heading', 'Documentation')}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring lg:hidden"
      >
        <BookOpen className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="left-auto right-0 top-0 flex h-full max-h-none w-[85vw] max-w-xs translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:rounded-none"
        >
          <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
            <DialogTitle asChild>
              <span>
                <DocsTitle />
              </span>
            </DialogTitle>
          </div>
          <DocsContent section={section} />
        </DialogContent>
      </Dialog>
    </>
  );
}
