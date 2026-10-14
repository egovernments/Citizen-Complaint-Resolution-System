import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOnboardingT } from '../i18n';
import type { LearnVideo } from './homeContent';
import { cardsPerPage, MAX_PER_PAGE } from './videoRow';

/** The "Learn the basics" row: a page of video cards at a time, as many as the width allows. */
export function LearnTheBasics({ videos, onOpen }: { videos: LearnVideo[]; onOpen: (index: number) => void }) {
  const t = useOnboardingT();
  const row = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(MAX_PER_PAGE);
  const [start, setStart] = useState(0);

  useEffect(() => {
    const el = row.current;
    // ResizeObserver also reports the first size, so nothing is measured here directly.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setPerPage(cardsPerPage(el.clientWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A wider window shows more cards; keep the page inside the list.
  const first = Math.min(start, Math.max(0, videos.length - perPage));
  const shown = videos.slice(first, first + perPage);
  const last = first + shown.length;

  return (
    <section className="space-y-4" aria-labelledby="learn-the-basics">
      <div className="flex items-center gap-3">
        <h3 id="learn-the-basics" className="text-lg font-semibold text-foreground">
          {t('home.learn', 'Learn the basics')}
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {shown.length === 1
              ? t('home.video.position', '%{n} of %{total}', { n: first + 1, total: videos.length })
              : t('home.learn_range', '%{from}–%{to} of %{total}', { from: first + 1, to: last, total: videos.length })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={first === 0}
            onClick={() => setStart(Math.max(0, first - perPage))}
            aria-label={t('home.learn_previous', 'Previous videos')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={last >= videos.length}
            onClick={() => setStart(first + perPage)}
            aria-label={t('home.learn_next', 'More videos')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div ref={row} className="grid gap-5" style={{ gridTemplateColumns: `repeat(${perPage}, minmax(0, 1fr))` }}>
        {shown.map((video, i) => (
          <button
            key={video.id}
            type="button"
            onClick={() => onOpen(first + i)}
            className="group text-left focus-visible:outline-none"
            aria-label={t('home.play', 'Play %{title}', { title: video.title })}
          >
            <span
              className={`relative block aspect-[16/10] overflow-hidden rounded-lg border border-border ${video.tint} transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring`}
            >
              {video.youtubeId ? (
                <img
                  src={`https://i.ytimg.com/vi/${encodeURIComponent(video.youtubeId)}/hqdefault.jpg`}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <span aria-hidden="true" className="absolute inset-x-4 top-4 space-y-2">
                  <span className="block h-2 w-full rounded-full bg-foreground/10" />
                  <span className="block h-2 w-1/2 rounded-full bg-foreground/10" />
                </span>
              )}
              <span className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-card shadow">
                <Play className="ml-0.5 h-4 w-4 fill-foreground text-foreground" />
              </span>
            </span>
            <span className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">{video.title}</span>
              {video.duration && <span className="text-sm text-muted-foreground">{video.duration}</span>}
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{video.summary}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
