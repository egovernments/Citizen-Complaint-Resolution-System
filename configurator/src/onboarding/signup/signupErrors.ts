import { OnboardingError, type Operation } from '@/api/onboarding';
import { ApiClientError } from '@/api';
import { describeWorkspaceError } from '../errors';
import { englishT, MessageError, type OnboardingT } from '../i18n';

/**
 * The sign-up's backend error codes, in words. Keyed by the code, as
 * `signup_errors.<CODE>`. The services' own messages are written for logs
 * ("Signup.tenantMetadata.tenantAdmin.mobileNumber is invalid") or may change
 * at any time (the identity BFF's `error`), so a founder is shown these instead.
 */
export const SIGNUP_ERRORS: Record<string, string> = {
  // The client's own code for a request that never got an answer.
  NETWORK_ERROR: 'Couldn’t reach the server. Check your connection and try again.',
  // pgr-services onboarding.
  ONBOARDING_IDENTIFIER_TAKEN: 'That account URL is already taken. Choose a different one.',
  ONBOARDING_DRAFT_CONFLICT: 'Your details were changed in another tab or window. Reload the page to see the latest, then carry on.',
  ONBOARDING_DRAFT_LOCKED: 'Setup has already started, so these details can’t be changed now. Reload the page to see how it’s going.',
  ONBOARDING_PROVISIONED_FIELD_LOCKED: 'The account code and country can’t change after a setup attempt. Put them back as they were to carry on.',
  ONBOARDING_OPERATION_NOT_RETRYABLE: 'Setup can’t be retried from here right now. Reload the page to see where it’s up to.',
  ONBOARDING_PUBLICATION_PENDING: 'The last attempt is still finishing. Wait a minute, then try again.',
  ONBOARDING_SIGNUP_NOT_FOUND: 'We couldn’t find your sign-up. Reload the page to start again.',
  ONBOARDING_OPERATION_NOT_FOUND: 'We couldn’t find this setup run. Reload the page.',
  // Identity BFF: the email sign-up request.
  SIGNUP_UNAVAILABLE: 'Sign-up by email isn’t available right now. Try again later, or sign up another way.',
  UNTRUSTED_ORIGIN: 'Sign-up can’t be started from this address. Open the sign-up page from the main site and try again.',
  UNSUPPORTED_RETURN_TO: 'Sign-up can’t be started from this address. Open the sign-up page from the main site and try again.',
  // Identity BFF: opening a workspace once it exists.
  TENANT_CONTEXT_UNAVAILABLE: 'You can’t open this workspace with this sign-in.',
  EMPLOYEE_ACCOUNT_NOT_LINKED: 'Your sign-in isn’t connected to an account in this workspace yet. Ask its admin to invite you.',
  PENDING_INVITATION: 'Accept your invitation to this workspace first.',
  ACCOUNT_LOCKED: 'Your account in this workspace is locked. Ask its admin to unlock it.',
  DIGIT_ACCOUNT_INACTIVE: 'Your account in this workspace isn’t active. Ask its admin to turn it back on.',
  TENANT_ROLES_MISSING: 'This workspace isn’t fully set up yet. Try again in a few minutes.',
};

/**
 * What to fix when pgr-services refuses a draft field (`Signup.<field> is
 * required | invalid`), keyed `signup_fields.<field in snake case>`. The mobile
 * number isn't here: it is answered under the field itself, naming the country.
 */
export const SIGNUP_FIELD_ERRORS: Record<string, string> = {
  accountName: 'Enter a name for your account.',
  accountCode: 'The account code must be 2 to 32 characters, using A–Z, 0–9 and hyphens.',
  urlSlug: 'The account URL must be 2 to 63 lowercase letters, digits and hyphens, with at least two letters.',
  countryCode: 'Choose your base country from the list.',
  languages: 'Choose at least one language.',
  timeZone: 'Choose a timezone.',
  financialYearPolicy: 'Choose a financial year.',
  acceptedTermsVersion: 'Agree to the terms of service to continue.',
};

export const signupFieldKey = (field: string) => `signup_fields.${field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;

/**
 * A failed provisioning run, by the operation's errorCode, keyed
 * `provisioning_errors.<CODE>`. Only codes a founder can act on or would want
 * explained; the rest read by whether a retry is offered.
 */
export const PROVISIONING_ERRORS: Record<string, string> = {
  TENANT_ADMIN_ACCOUNT_REJECTED:
    'Your user account couldn’t be created with the details you gave. This is usually the mobile number: check it, then create the account again.',
  COUNTRY_NOT_SUPPORTED: 'Accounts can’t be set up in this country yet.',
  TENANT_TAKEN: 'Another workspace took this account URL while yours was being set up.',
  ONBOARDING_IDENTIFIER_TAKEN: 'Another workspace took this account URL while yours was being set up.',
};

export interface SignupProblem {
  message: string;
  /** Set when the problem belongs under a field rather than in the page's banner. */
  field?: 'mobile';
}

/** The country a mobile message names. */
interface Context {
  countryName?: string;
  /** The email sign-up request, whose INVALID_REQUEST means the name or email. */
  magicLink?: boolean;
}

const FIELD_REFUSAL = /^Signup\.([\w.]+) is (required|invalid|not supported)$/;

export function mobileInvalid(countryName: string | undefined, t: OnboardingT = englishT): string {
  return countryName
    ? t('signup.mobile_invalid', 'That isn’t a valid mobile number in %{country}.', { country: countryName })
    : t('signup.mobile_invalid_any', 'That isn’t a valid mobile number for the country you chose.');
}

/** A failed sign-up call in words, and which field it belongs to when it belongs to one. */
export function describeSignupError(err: unknown, t: OnboardingT = englishT, context: Context = {}): SignupProblem {
  if (err instanceof MessageError) return { message: t(err.key, err.english, err.params).trim() };
  // Entering a new workspace reads it through the workspace API.
  if (err instanceof ApiClientError) return { message: describeWorkspaceError(err, undefined, t) };
  if (!(err instanceof OnboardingError)) {
    return { message: err instanceof Error && err.message ? err.message : t('signup.error_unknown', 'Something went wrong. Try again.') };
  }

  const { code, message, status } = err;
  if (code === 'ONBOARDING_VALIDATION_ERROR') {
    const [, field, problem] = FIELD_REFUSAL.exec(message) ?? [];
    if (field?.startsWith('tenantMetadata')) {
      return {
        field: 'mobile',
        message: problem === 'required' ? t('signup.mobile_required', 'Enter your mobile number.') : mobileInvalid(context.countryName, t),
      };
    }
    if (field === 'countryCode' && problem === 'not supported') {
      return { message: t('signup.country_not_supported', 'Accounts can’t be set up in that country yet. Choose another one.') };
    }
    if (field && SIGNUP_FIELD_ERRORS[field]) return { message: t(signupFieldKey(field), SIGNUP_FIELD_ERRORS[field]) };
    return { message: t('signup.details_invalid', 'Some of your details aren’t valid. Check them and try again.') };
  }
  // One code for every identifier; the message names which ("ACCOUNT_CODE is already in use").
  if (code === 'ONBOARDING_IDENTIFIER_TAKEN' && /ACCOUNT_CODE/.test(message)) {
    return { message: t('signup.account_code_taken', 'That account code is already taken. Go back and choose a different one.') };
  }
  if (code === 'INVALID_REQUEST' && context.magicLink) {
    return { message: t('signup.magic_link_invalid', 'Enter your first name, last name and a valid email address.') };
  }
  if (code && SIGNUP_ERRORS[code]) return { message: t(`signup_errors.${code}`, SIGNUP_ERRORS[code]) };
  if (status === 503 || /UNAVAILABLE|BUSY$/.test(code ?? '')) {
    return { message: t('signup.error_unavailable', 'A service sign-up needs isn’t responding right now. Try again in a minute.') };
  }
  return {
    message: code
      ? t('signup.error_reference', 'Something went wrong on our side. Try again, and if it keeps happening, contact support with reference %{code}.', { code })
      : t('signup.error_unknown', 'Something went wrong. Try again.'),
  };
}

/**
 * A failed provisioning run in words. PGR records the failure's code as its
 * message too, so the message is never shown: the code picks the words, and is
 * kept as a reference for support.
 */
export function describeProvisioningFailure(operation: Pick<Operation, 'status' | 'errorCode'>, t: OnboardingT = englishT): string {
  const code = operation.errorCode ?? '';
  if (PROVISIONING_ERRORS[code]) return t(`provisioning_errors.${code}`, PROVISIONING_ERRORS[code]);
  return operation.status === 'RETRYABLE_FAILED'
    ? t('signup.setup_failed_retryable', 'Setup hit a problem that’s usually temporary. Try again.')
    : t('signup.setup_failed_detail', 'The setup could not be completed.');
}
