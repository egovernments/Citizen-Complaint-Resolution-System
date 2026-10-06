import { ONBOARDING_STEPS, type OnboardingStep } from './steps';

/**
 * Onboarding progress, read from the step numbers App state records as each
 * step finishes. Everything that asks "how far along is this account" goes
 * through here, so the backend's progress record can replace that source in
 * one place.
 */

export type StepStatus = 'done' | 'in-progress' | 'locked';

export function isOnboardingComplete(completed: number[]): boolean {
  return ONBOARDING_STEPS.every((step) => completed.includes(step.number));
}

/** Whether finishing `phase` completes onboarding for the first time. */
export function finishesOnboarding(phase: number, completedBefore: number[]): boolean {
  return !isOnboardingComplete(completedBefore) && isOnboardingComplete([...completedBefore, phase]);
}

export function completedCount(completed: number[]): number {
  return ONBOARDING_STEPS.filter((step) => completed.includes(step.number)).length;
}

/** Where to resume: the first step not yet finished (the last one once all are). */
export function resumeStep(completed: number[]): OnboardingStep {
  return ONBOARDING_STEPS.find((step) => !completed.includes(step.number)) ?? ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
}

export function resumePath(completed: number[]): string {
  return resumeStep(completed).path;
}

/** Steps unlock in order: a finished step stays open, and so does the next one to do. */
export function stepStatus(step: OnboardingStep, completed: number[]): StepStatus {
  if (completed.includes(step.number)) return 'done';
  return step.number === resumeStep(completed).number ? 'in-progress' : 'locked';
}

export function stepForPath(pathname: string): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find((step) => pathname === step.path || pathname.startsWith(step.path + '/'));
}
