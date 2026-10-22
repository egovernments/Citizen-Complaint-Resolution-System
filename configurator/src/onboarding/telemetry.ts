import { captureError } from '@/lib/telemetry';
import { errorCode, track, type AnalyticsProps } from '@/lib/analytics';
import type { OnboardingStepId } from './steps';

/**
 * Onboarding's telemetry, the tracking plan's `onboarding:*` events. Events
 * say what was done, to what kind of record, how many and which way; never
 * what was typed, so no names, phone numbers or emails reach analytics.
 */

export type OnboardingEntity =
  | 'branding'
  | 'hierarchy'
  | 'boundary'
  | 'department'
  | 'designation'
  | 'employee'
  | 'complaint_type';

/** The way a step is done: geography's three sources, or a form against a bulk upload. */
export type OnboardingMethod = 'preconfigured' | 'fetch' | 'excel' | 'form' | 'bulk' | 'template';

type Details = AnalyticsProps;

/** A way of doing the step was picked, or backed out of. */
export function trackMethod(step: OnboardingStepId, method: OnboardingMethod, cancelled = false) {
  track(cancelled ? 'onboarding:method_cancel' : 'onboarding:method_select', { step, method });
}

/** One record saved from a form. */
export function trackRecordSave(
  step: OnboardingStepId,
  entity: OnboardingEntity,
  operation: 'create' | 'update' | 'delete',
  details: Details = {},
) {
  track('onboarding:record_save', { method: 'form', ...details, step, entity, operation });
}

/** A bulk upload or a fetch finished, with how many records it wrote and how many failed. */
export function trackImport(
  step: OnboardingStepId,
  entity: OnboardingEntity,
  details: { method: OnboardingMethod; count: number; failed?: number } & Details,
) {
  track('onboarding:import_complete', { ...details, step, entity });
}

/** A bulk-upload template was downloaded. */
export function trackTemplateDownload(step: OnboardingStepId, entity: OnboardingEntity) {
  track('onboarding:template_download', { step, entity });
}

/** An uploaded file was refused before anything was written. */
export function trackUploadRefused(step: OnboardingStepId, entity: OnboardingEntity, code: string, problems?: number) {
  track('onboarding:upload_refuse', { step, entity, error_code: code, count: problems });
}

/**
 * A failed save the step showed the admin; reported so it isn't only on their
 * screen. Sentry gets the error; analytics gets its code only.
 */
export function reportStepError(step: OnboardingStepId, action: string, error: unknown, tenant: string) {
  captureError(error instanceof Error ? error : new Error(String(error)), { component: 'onboarding', step, action, tenant });
  track('onboarding:step_fail', { step, action, error_code: errorCode(error) });
}
