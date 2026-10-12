import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useOnboardingT } from '../i18n';
import { welcomeSlides } from './homeContent';

/** "What's onboarding?": what the system does and what each section is for, one slide at a time. */
export function WelcomeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useOnboardingT();
  const slides = welcomeSlides(t);
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const last = index === slides.length - 1;
  const Icon = slide.icon;

  const change = (next: boolean) => {
    // Each opening starts from the welcome slide.
    if (!next) setIndex(0);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:rounded-xl">
        {/* A fixed minimum height so the dialog doesn't jump as slides change length. */}
        <div className="grid md:min-h-[26rem] md:grid-cols-[5fr_6fr]">
          <div className="flex h-40 items-center justify-center bg-primary/10 md:h-auto" aria-hidden="true">
            {slide.image ? (
              <img src={slide.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon className="h-16 w-16 text-primary/70" />
            )}
          </div>
          <div className="flex flex-col p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">{slide.eyebrow}</p>
            <DialogTitle className="mt-3 text-2xl font-bold leading-tight text-foreground">{slide.title}</DialogTitle>
            <DialogDescription className="mt-3 text-[15px] leading-6 text-foreground/80">{slide.body}</DialogDescription>
            {slide.note && <p className="mt-3 text-sm leading-6 text-muted-foreground">{slide.note}</p>}
            <div className="mt-auto flex items-center justify-between gap-3 pt-8">
              <div className="flex items-center gap-1.5" aria-label={t('home.welcome.position', 'Slide %{n} of %{total}', { n: index + 1, total: slides.length })}>
                {slides.map((item, i) => (
                  <span key={item.id} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => i - 1)}
                  aria-label={t('home.previous', 'Previous')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {last ? (
                  <Button className="h-10 rounded-full px-5" onClick={() => change(false)}>
                    {t('home.welcome.start', 'Get started')}
                  </Button>
                ) : (
                  <Button size="icon" className="h-10 w-10 rounded-full" onClick={() => setIndex((i) => i + 1)} aria-label={t('home.next_slide', 'Next')}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
