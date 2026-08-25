import digitFooterColor from '@/assets/digit-footer.png';
import digitFooterBw from '@/assets/digit-footer-bw.png';

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
 * "Powered by DIGIT" attribution (CCRS#1841), matching the citizen/employee
 * shells. The asset is the full lockup — wordmark and logo in one image — so
 * this renders an image, not text beside an icon.
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
  const bundled = variant === 'bw' ? digitFooterBw : digitFooterColor;
  const configured = configuredUrl(variant === 'bw' ? 'DIGIT_FOOTER_BW' : 'DIGIT_FOOTER');
  const logoUrl = configured ?? bundled;

  // Never paint a broken-image icon plus alt text — the failure mode that
  // caused #1836. An empty configured value means "hide it".
  if (!logoUrl) return null;

  return (
    <a
      href={configuredUrl('DIGIT_HOME_URL') || DEFAULT_HOME_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={['inline-flex items-center', className].filter(Boolean).join(' ')}
    >
      <img src={logoUrl} alt="Powered by DIGIT" className="h-5 w-auto" />
    </a>
  );
}

export default DigitFooter;
