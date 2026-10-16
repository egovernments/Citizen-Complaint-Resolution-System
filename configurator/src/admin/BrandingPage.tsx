import { BrandingEditor } from '@/onboarding/BrandingStep';

/**
 * Branding in the management console: the onboarding Branding screen (logo,
 * citizen home banner, theme), so a workspace can change its branding after
 * onboarding instead of pasting image links into StateInfo.
 */
export default function BrandingPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <BrandingEditor mode="console" />
    </div>
  );
}
