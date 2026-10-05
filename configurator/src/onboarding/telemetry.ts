import { captureError, trackEvent } from '@/lib/telemetry';
import type { OnboardingStepId } from './steps';

/**
 * Onboarding's telemetry. Events say what was done, to what kind of record,
 * how many and how it came in; never what was typed, so no names, phone
 * numbers or emails reach analytics.
 */

export type OnboardingEntity = 'branding' | 'boundary' | 'department' | 'designation' | 'employee' | 'complaint_type';
export type OnboardingSource = 'form' | 'bulk' | 'osm' | 'excel';
type ActionEvent = 'entity_create' | 'entity_update' | 'entity_delete' | 'entity_import';

interface ActionDetails {
  tenant: string;
  count?: number;
  failed?: number;
  source?: OnboardingSource;
  [detail: string]: string | number | boolean | undefined;
}

export function trackStepAction(step: OnboardingStepId, event: ActionEvent, entity: OnboardingEntity, details: ActionDetails) {
  trackEvent(event, { step, entity, ...details });
}

/** A failed save the step showed the admin; reported so it isn't only on their screen. */
export function reportStepError(step: OnboardingStepId, action: string, error: unknown, tenant: string) {
  captureError(error instanceof Error ? error : new Error(String(error)), { component: 'onboarding', step, action, tenant });
}
