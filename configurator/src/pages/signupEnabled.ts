import { resolveConfig } from '@/api/runtimeConfig';

/**
 * ours (cfgreview F31, #1577): whether the sign-in page offers self-serve sign-up. Off unless the deployment says
 * so (config.js SIGNUP_ENABLED or VITE_SIGNUP_ENABLED = "true"): a deployment whose backend does not serve sign-up
 * should not send people to a form that fails.
 */
export function signupEnabled(): boolean {
  return String(resolveConfig('SIGNUP_ENABLED' as never, import.meta.env.VITE_SIGNUP_ENABLED) ?? '').trim().toLowerCase() === 'true';
}
