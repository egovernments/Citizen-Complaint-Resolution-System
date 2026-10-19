import digitMarkColor from '@/assets/digit-mark.png';
import digitMarkBw from '@/assets/digit-mark-bw.png';

// Link target when the deployment has not configured DIGIT_HOME_URL.
const DEFAULT_HOME_URL = 'https://egov.org.in/digit/';

const getConfig = (key: string): unknown =>
  (window as unknown as { globalConfigs?: { getConfig?: (k: string) => unknown } })
    .globalConfigs?.getConfig?.(key);

/** Read a config key only when it resolves to a string; anything else is "unset". */
function configuredUrl(key: string): string | undefined {
  const value = getConfig(key);
  return typeof value === 'string' ? value : undefined;
}

export interface DigitFooterProps {
  /**
   * `bw` is the near-white lockup for dark surfaces (the wizard's bg-secondary
   * bar); `color` is the default for light surfaces.
   */
  variant?: 'color' | 'bw';
  className?: string;
}

/**
 * "Powered by DIGIT" attribution (CCRS#1841). Stock, it is "Powered by" set as
 * text beside the bundled DIGIT mark; a deployment that configures its own
 * lockup gets that single image instead.
 *
 * Resolution order, and why it differs from the dashboard's DashboardFooter:
 * that component reads globalConfigs only, because nginx injects
 * `/digit-ui/globalConfigs.js` into the digit-ui shell (local-setup/nginx/
 * digit-ui.conf). The configurator is served from its own location with no such
 * injection and its index.html loads no config script, so `window.globalConfigs`
 * is undefined here — a config-only lookup would render nothing on every
 * install. The bundled asset is therefore the fallback, which is what #1841
 * means by "a stock install should render the attribution with no
 * configuration".
 *
 * An explicit empty string still hides it, so a deployment that does inject
 * globalConfigs can opt out or rebrand without a code change.
 */
export function DigitFooter({ variant = 'color', className }: DigitFooterProps) {
  const configured = configuredUrl(variant === 'bw' ? 'DIGIT_FOOTER_BW' : 'DIGIT_FOOTER');

  // Never paint a broken-image icon plus alt text — the failure mode that
  // caused #1836. An empty configured value means "hide it".
  if (configured === '') return null;

  const linkProps = {
    href: configuredUrl('DIGIT_HOME_URL') || DEFAULT_HOME_URL,
    target: '_blank',
    rel: 'noopener noreferrer',
  };

  // A deployment's own lockup is shown as it is, text and all.
  if (configured) {
    return (
      <a {...linkProps} className={['inline-flex items-center', className].filter(Boolean).join(' ')}>
        <img src={configured} alt="Powered by DIGIT" className="h-4 w-auto" />
      </a>
    );
  }

  // The stock attribution sets "Powered by" as live text beside the bundled
  // DIGIT mark, in the DIGIT console's weight: the full lockup image carried a
  // light, thin "Powered by" that read fainter than the console's. The image's
  // alt names the whole attribution, so the visible words stay out of the
  // accessibility tree rather than being read twice.
  return (
    <a {...linkProps} className={['inline-flex h-4 items-center gap-1.5', className].filter(Boolean).join(' ')}>
      <span
        aria-hidden="true"
        className={`text-[13px] font-medium leading-none ${variant === 'bw' ? 'text-white/85' : 'text-foreground'}`}
      >
        Powered by
      </span>
      <img src={variant === 'bw' ? digitMarkBw : digitMarkColor} alt="Powered by DIGIT" className="h-[13px] w-auto" />
    </a>
  );
}

export default DigitFooter;
