import { describe, expect, it } from 'vitest';
import { OnboardingError } from '@/api/onboarding';
import { ApiClientError } from '@/api';
import { describeProvisioningFailure, describeSignupError, problemText } from './signupErrors';

const refused = (message: string, code = 'ONBOARDING_VALIDATION_ERROR', status = 400) => new OnboardingError(status, code, message);

describe('describeSignupError', () => {
  it('puts a refused mobile number under the field, naming the country (#2353)', () => {
    expect(describeSignupError(refused('Signup.tenantMetadata.tenantAdmin.mobileNumber is invalid'), undefined, { countryName: 'Mozambique' })).toEqual({
      field: 'mobile',
      message: 'That isn’t a valid mobile number in Mozambique.',
    });
    expect(describeSignupError(refused('Signup.tenantMetadata.tenantAdmin.mobileNumber is required'))).toEqual({
      field: 'mobile',
      message: 'Enter your mobile number.',
    });
  });

  it('says what to fix for any other refused field, never the field path', () => {
    expect(describeSignupError(refused('Signup.timeZone is invalid')).message).toBe('Choose a timezone.');
    expect(describeSignupError(refused('Signup.acceptedTermsVersion is required')).message).toBe('Agree to the terms of service to continue.');
    expect(describeSignupError(refused('Signup.countryCode is not supported')).message).toMatch(/can’t be set up in that country/);
    expect(describeSignupError(refused('Signup.somethingNew is invalid')).message).toBe('Some of your details aren’t valid. Check them and try again.');
  });

  it('tells a taken account code from a taken URL', () => {
    expect(describeSignupError(refused('ACCOUNT_CODE is already in use', 'ONBOARDING_IDENTIFIER_TAKEN', 409))).toEqual({
      field: 'accountCode',
      message: 'That account code is already taken. Choose a different one.',
    });
    expect(describeSignupError(refused('URL_SLUG is already reserved', 'ONBOARDING_IDENTIFIER_TAKEN', 409))).toEqual({
      field: 'urlSlug',
      message: 'That account URL is already taken. Choose a different one.',
    });
  });

  it('puts every taken identifier under its own field, the name never under the URL (#2775)', () => {
    const taken = (message: string) => describeSignupError(refused(message, 'ONBOARDING_IDENTIFIER_TAKEN', 409), undefined, { accountName: ' Bomet County ' });
    // The submit check and the reservation word a taken name differently.
    for (const message of ['ORGANIZATION_NAME is already in use', 'Organization name is already reserved']) {
      expect(taken(message)).toEqual({
        field: 'accountName',
        message: 'A workspace called “Bomet County” already exists. Choose a different name.',
      });
    }
    // The tenant id and alias are both made from the URL.
    for (const message of ['TENANT_ID is already in use', 'ORGANIZATION_ALIAS is already reserved']) {
      expect(taken(message).field).toBe('urlSlug');
    }
    expect(describeSignupError(refused('Organization name is already reserved', 'ONBOARDING_IDENTIFIER_TAKEN', 409)).message)
      .toBe('A workspace with this name already exists. Choose a different name.');
  });

  it('never blames the URL for a taken identifier it can’t name, and keeps the code as a reference (#2775)', () => {
    const problem = describeSignupError(refused('Something is already in use', 'ONBOARDING_IDENTIFIER_TAKEN', 409));
    expect(problem.field).toBeUndefined();
    expect(problem.message).not.toMatch(/URL is already taken/);
    expect(problem.message).toMatch(/account name, account code or account URL/);
    expect(problem.reference).toBe('ONBOARDING_IDENTIFIER_TAKEN');
  });

  it('says what an account code must be, starting with a letter or digit (#2802)', () => {
    expect(describeSignupError(refused('Signup.accountCode is invalid')).message).toMatch(/must start with a letter or digit/);
  });

  it('reads the identity BFF by code, not its display text', () => {
    expect(describeSignupError(refused('Keycloak onboarding request failed', 'IDENTITY_UNAVAILABLE', 503)).message).toMatch(/isn’t responding right now/);
    expect(describeSignupError(refused('Accept the invitation first', 'PENDING_INVITATION', 403)).message).toBe('Accept your invitation to this workspace first.');
    expect(describeSignupError(refused('Untrusted request origin', 'UNTRUSTED_ORIGIN', 403)).message).toMatch(/Open the sign-up page from the main site/);
  });

  it('reads INVALID_REQUEST on the email sign-up as the name or email', () => {
    const err = refused('First name, last name, and a valid email are required', 'INVALID_REQUEST');
    expect(describeSignupError(err, undefined, { magicLink: true }).message).toBe('Enter your first name, last name and a valid email address.');
  });

  it('keeps an unknown code as a reference instead of showing its text', () => {
    const problem = describeSignupError(refused('Could not store onboarding data', 'ONBOARDING_SERIALIZATION_ERROR', 500));
    expect(problem).toEqual({
      message: 'Something went wrong on our side. Try again, and if it keeps happening, contact support.',
      reference: 'ONBOARDING_SERIALIZATION_ERROR',
    });
    // A page with no small print of its own still shows the reference, after the message.
    expect(problemText(problem)).toBe(`${problem.message} Reference: ONBOARDING_SERIALIZATION_ERROR`);
  });

  it('explains a dropped connection, and a workspace call by its own catalogue', () => {
    expect(describeSignupError(new OnboardingError(0, 'NETWORK_ERROR', 'x')).message).toMatch(/Check your connection/);
    const workspace = new ApiClientError([{ code: 'WORKSPACE_DEPENDENCY_UNAVAILABLE', message: 'raw' }] as never, 503);
    expect(describeSignupError(workspace).message).toMatch(/isn’t responding right now/);
  });
});

describe('describeProvisioningFailure', () => {
  it('names a rejected founder account, and never the raw code', () => {
    expect(describeProvisioningFailure({ status: 'TERMINAL_FAILED', errorCode: 'TENANT_ADMIN_ACCOUNT_REJECTED' })).toMatch(/usually the mobile number/);
  });

  it('falls back on whether a retry is offered', () => {
    expect(describeProvisioningFailure({ status: 'RETRYABLE_FAILED', errorCode: 'MDMS_INVALID_RESPONSE' })).toMatch(/usually temporary/);
    expect(describeProvisioningFailure({ status: 'TERMINAL_FAILED', errorCode: 'BINDING_CONFLICT' })).toBe('The setup could not be completed.');
  });
});
