/**
 * Self-serve onboarding contract (CCRS#1999).
 *
 * Every call the signup flow makes lives here behind one interface, with mock
 * implementations, because the backend is being built in parallel
 * (@KDwevedi). Swapping to the real endpoints should be a change to this file
 * and nothing else — the screens never call fetch directly.
 *
 * Two things are settled and encoded here:
 *  - Identity is a MAGIC LINK, not a password. digit-ui's KeycloakAuthAdapter
 *    signs up with {email, password}; the revamped flow deliberately does not,
 *    so there is no password anywhere in this module.
 *  - The Keycloak base URL comes from a BUILD-TIME env var, not globalConfigs.
 *    globalConfigs is being retired, and it was never injected into the
 *    configurator anyway (nginx sub_filter only rewrites /digit-ui — the same
 *    trap as #1841).
 */

/** Keycloak / token-exchange base. Empty means "not configured", see isOnboardingConfigured. */
export const KEYCLOAK_BASE_URL: string =
  (import.meta.env.VITE_KEYCLOAK_URL as string | undefined)?.trim() || '';

/**
 * Until the backend lands, the flow runs against in-memory mocks. Set
 * VITE_ONBOARDING_LIVE=true once the endpoints exist to switch over.
 */
export const ONBOARDING_LIVE: boolean =
  String(import.meta.env.VITE_ONBOARDING_LIVE ?? '').trim().toLowerCase() === 'true';

export interface AvailabilityResult {
  available: boolean;
  /** Why not, when unavailable — shown under the field. */
  reason?: string;
  /** A free alternative, when the backend can suggest one. */
  suggestion?: string;
}

export interface AccountDraft {
  firstName: string;
  lastName: string;
  email: string;
  accountName: string;
  accountCode: string;
  baseCountry: string;
  languages: string[];
  timezone: string;
  financialYear: string;
  accountUrl: string;
}

export interface OnboardingClient {
  /** Send the sign-in link. Resolves when the mail is accepted for delivery. */
  startEmailVerification(input: { email: string; firstName: string; lastName: string }): Promise<void>;
  /** True once the recipient has followed the link. Polled, or resolved by the return leg. */
  isEmailVerified(email: string): Promise<boolean>;
  checkAccountCode(code: string): Promise<AvailabilityResult>;
  checkAccountUrl(slug: string): Promise<AvailabilityResult>;
  /** Kicks off provisioning. The account is NOT ready when this resolves. */
  createAccount(draft: AccountDraft): Promise<{ accepted: true }>;
}

/** Codes and slugs already taken, so the availability UI has something to fail against. */
const TAKEN_CODES = new Set(['KE-NRB', 'KE-MCG', 'IN-AMC']);
const TAKEN_SLUGS = new Set(['nairobi', 'makueni-county-government', 'demo']);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-memory stand-in for the real service. Verification is satisfied by
 * markVerified(), which the "I have opened the link" affordance calls — the
 * prototype models the same thing with its "Simulate email verification"
 * button.
 */
class MockOnboardingClient implements OnboardingClient {
  private verified = new Set<string>();

  async startEmailVerification({ email }: { email: string }): Promise<void> {
    await delay(600);
    if (!email.includes('@')) throw new Error('Enter a valid email address.');
  }

  async isEmailVerified(email: string): Promise<boolean> {
    await delay(200);
    return this.verified.has(email.toLowerCase());
  }

  /** Test/dev only: stands in for the recipient clicking the emailed link. */
  markVerified(email: string): void {
    this.verified.add(email.toLowerCase());
  }

  async checkAccountCode(code: string): Promise<AvailabilityResult> {
    await delay(400);
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 3) return { available: false, reason: 'Account code is too short.' };
    if (TAKEN_CODES.has(normalized)) {
      return { available: false, reason: 'That account code is already in use.', suggestion: `${normalized}-2` };
    }
    return { available: true };
  }

  async checkAccountUrl(slug: string): Promise<AvailabilityResult> {
    await delay(400);
    const normalized = slug.trim().toLowerCase();
    if (normalized.length < 3) return { available: false, reason: 'Account URL is too short.' };
    if (TAKEN_SLUGS.has(normalized)) {
      return { available: false, reason: 'That account URL is taken.', suggestion: `${normalized}-gov` };
    }
    return { available: true };
  }

  async createAccount(): Promise<{ accepted: true }> {
    await delay(800);
    return { accepted: true };
  }
}

export const mockOnboardingClient = new MockOnboardingClient();

/**
 * Whether the flow can talk to a real backend. False keeps the screens on the
 * mock client so the flow stays demoable before the endpoints exist.
 */
export function isOnboardingConfigured(): boolean {
  return ONBOARDING_LIVE && KEYCLOAK_BASE_URL.length > 0;
}

/**
 * The client the screens use. Live wiring is deliberately absent rather than
 * guessed: the availability contract (one endpoint or two, and its response
 * shape) is still open with @KDwevedi, and a wrong guess here would be silent.
 */
export function getOnboardingClient(): OnboardingClient {
  return mockOnboardingClient;
}

/** "Bomet County Government" -> "bomet-county-government". */
export function slugifyAccountName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/**
 * "Bomet County Government" + KE -> "KE-BCG". Initials of the first three
 * words, prefixed by the country, matching what the prototype produces.
 */
export function deriveAccountCode(name: string, countryCode: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  if (!initials) return '';
  return countryCode ? `${countryCode.toUpperCase()}-${initials}` : initials;
}
