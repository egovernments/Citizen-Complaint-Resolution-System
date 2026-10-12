import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Info } from 'lucide-react';
import { useApp } from '../../App';
import { Button } from '@/components/ui/button';
import { ONBOARDING_STEPS } from '../steps';
import { completedCount, resumeStep } from '../progress';
import { useOnboardingT } from '../i18n';
import { learnVideos, stepIntros } from './homeContent';
import { LearnTheBasics } from './LearnTheBasics';
import { VideoDialog } from './VideoDialog';
import { WelcomeDialog } from './WelcomeDialog';

const welcomeSeenKey = (tenant: string) => `ccrs-onboarding-welcome-seen:${tenant}`;

function welcomeSeen(tenant: string): boolean {
  try {
    return window.localStorage.getItem(welcomeSeenKey(tenant)) === '1';
  } catch {
    return true;
  }
}

function rememberWelcomeSeen(tenant: string) {
  try {
    window.localStorage.setItem(welcomeSeenKey(tenant), '1');
  } catch {
    // Storage unavailable: the welcome shows again next time, which is harmless.
  }
}

/**
 * Onboarding's Home: what onboarding is, where this account has got to, the
 * step to do next, and short videos on each step. The welcome opens by itself
 * the first time an account lands here, and from "What's onboarding?" after.
 */
export default function HomePage() {
  const { state } = useApp();
  const t = useOnboardingT();
  const navigate = useNavigate();
  const tenant = state.targetTenant || state.tenant;
  const completed = state.completedPhases;
  const done = completedCount(completed);
  const total = ONBOARDING_STEPS.length;
  const next = resumeStep(completed);
  const after = ONBOARDING_STEPS.find((step) => step.number > next.number && !completed.includes(step.number));
  const intros = stepIntros(t);
  const videos = learnVideos(t);
  const stepName = (step: (typeof ONBOARDING_STEPS)[number]) => t(`steps.${step.id}`, step.label);

  const [welcomeOpen, setWelcomeOpen] = useState(() => !welcomeSeen(tenant));
  const [video, setVideo] = useState<number | null>(null);

  const closeWelcome = (open: boolean) => {
    setWelcomeOpen(open);
    if (!open) rememberWelcomeSeen(tenant);
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.5px] text-muted-foreground">{t('layout.home', 'Home')}</p>
          <h2 className="text-3xl font-bold font-condensed text-foreground">{t('layout.setup_account', 'Let’s set up your account')}</h2>
        </div>
        <Button variant="outline" onClick={() => setWelcomeOpen(true)} className="h-10 gap-2 text-primary hover:text-primary">
          <Info className="h-4 w-4" />
          {t('home.whats_onboarding', 'What’s onboarding?')}
        </Button>
      </header>

      <section className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card p-6 sm:p-7" aria-labelledby="home-next-step">
        <div className="min-w-0 flex-1 basis-80 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em]">
            <span className="text-primary">
              {done === 0 ? t('home.start_here', 'Start here') : t('home.up_next', 'Up next')}
            </span>
            <span aria-hidden="true" className="mx-2 font-normal text-muted-foreground">·</span>
            <span className="font-normal normal-case tracking-normal text-muted-foreground">
              {t('layout.completed_count', '%{done} of %{total} completed', { done, total })}
            </span>
          </p>
          <h3 id="home-next-step" className="text-2xl font-semibold text-foreground">
            {stepName(next)}
          </h3>
          <p className="max-w-2xl text-[15px] leading-6 text-foreground/80">
            {intros[next.id].description}
          </p>
          {after && (
            <p className="text-sm text-muted-foreground">
              {t('home.after', 'After this: %{step} — %{what}.', { step: stepName(after), what: intros[after.id].next })}
            </p>
          )}
        </div>
        <Button onClick={() => navigate(next.path)} className="h-11 w-full gap-2 px-6 text-[15px] sm:w-auto">
          {t('home.set_up', 'Set up %{step}', { step: stepName(next) })}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </section>

      <LearnTheBasics videos={videos} onOpen={setVideo} />

      <WelcomeDialog open={welcomeOpen} onOpenChange={closeWelcome} />
      <VideoDialog videos={videos} index={video} onIndexChange={setVideo} onClose={() => setVideo(null)} />
    </div>
  );
}
