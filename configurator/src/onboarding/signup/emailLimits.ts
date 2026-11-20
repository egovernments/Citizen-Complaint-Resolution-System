import { OnboardingError } from '@/api/onboarding';
import { englishT, type OnboardingT } from '../i18n';

/** Whole minutes to wait, rounded up, from the BFF's `retryAfter` seconds (also its Retry-After). */
function minutesToWait(err: OnboardingError): number {
  const seconds = Number(err.details?.retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : 1;
}

/**
 * A sign-up link or password link request the identity BFF refused for being over a limit
 * (#2805), in words: what happened and how long to wait. It never says an email was sent,
 * because none was. Null for any other error.
 *
 * EMAIL_RATE_LIMITED counts requests for one address; NETWORK_RATE_LIMITED counts the network,
 * which an office behind one connection shares.
 */
export function describeEmailLimit(err: unknown, t: OnboardingT = englishT): string | null {
  if (!(err instanceof OnboardingError) || (err.code !== 'EMAIL_RATE_LIMITED' && err.code !== 'NETWORK_RATE_LIMITED')) return null;
  const minutes = minutesToWait(err);
  if (err.code === 'EMAIL_RATE_LIMITED') {
    return minutes === 1
      ? t('signup.limit_email_one', 'Too many emails were requested for this address. Try again in 1 minute.')
      : t('signup.limit_email', 'Too many emails were requested for this address. Try again in %{minutes} minutes.', { minutes });
  }
  return minutes === 1
    ? t('signup.limit_network_one', 'Too many requests from this network. Try again in 1 minute.')
    : t('signup.limit_network', 'Too many requests from this network. Try again in %{minutes} minutes.', { minutes });
}
