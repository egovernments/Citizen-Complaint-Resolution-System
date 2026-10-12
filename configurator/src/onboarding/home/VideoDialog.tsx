import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useOnboardingT } from '../i18n';
import type { LearnVideo } from './homeContent';

/** One "Learn the basics" video, with the others a step away. A video not published yet says so. */
export function VideoDialog({
  videos,
  index,
  onIndexChange,
  onClose,
}: {
  videos: LearnVideo[];
  /** The video shown, or null when closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const t = useOnboardingT();
  const video = index === null ? null : videos[index];
  return (
    <Dialog open={!!video} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-4xl gap-0 overflow-hidden p-0 sm:rounded-xl"
        closeClassName="right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-900 opacity-90 shadow"
      >
        {video && index !== null && (
          <>
            <div className="relative aspect-video w-full bg-neutral-900">
              {video.youtubeId ? (
                <iframe
                  key={video.youtubeId}
                  className="absolute inset-0 h-full w-full"
                  src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.youtubeId)}?rel=0`}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                    <Play className="ml-1 h-7 w-7" />
                  </span>
                  <p className="text-sm">{t('home.video.soon', 'This video is coming soon.')}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg font-semibold text-foreground">{video.title}</DialogTitle>
                <DialogDescription className="mt-0.5 text-sm text-muted-foreground">{video.summary}</DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="mr-1 text-sm text-muted-foreground">
                  {t('home.video.position', '%{n} of %{total}', { n: index + 1, total: videos.length })}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  disabled={index === 0}
                  onClick={() => onIndexChange(index - 1)}
                  aria-label={t('home.video.previous', 'Previous video')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  disabled={index === videos.length - 1}
                  onClick={() => onIndexChange(index + 1)}
                  aria-label={t('home.video.next', 'Next video')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
