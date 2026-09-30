import type { ComponentType } from 'react';
import { Building2, MapPin, Network, Users, MessageSquareText } from 'lucide-react';

export type OnboardingStepId = 'branding' | 'geography' | 'departments' | 'employees' | 'complaints';

export interface OnboardingStep {
  id: OnboardingStepId;
  /** 1-based position; also the number App state records in completedPhases. */
  number: number;
  path: string;
  label: string;
  /** The rail section it sits under. */
  group: string;
  icon: ComponentType<{ className?: string }>;
  /** The master whose edit rights decide whether this step is actionable. */
  master: string;
}

/**
 * The onboarding steps, in the order they unlock. Each depends on the ones
 * before it: employees need departments, designations and jurisdictions;
 * complaint types route to departments.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'branding', number: 1, path: '/onboarding/branding', label: 'Branding', group: 'Account', icon: Building2, master: 'tenants' },
  { id: 'geography', number: 2, path: '/onboarding/geography', label: 'Geography', group: 'Organisation', icon: MapPin, master: 'boundaries' },
  { id: 'departments', number: 3, path: '/onboarding/departments', label: 'Departments', group: 'Organisation', icon: Network, master: 'departments' },
  { id: 'employees', number: 4, path: '/onboarding/employees', label: 'Employees', group: 'Organisation', icon: Users, master: 'employees' },
  { id: 'complaints', number: 5, path: '/onboarding/complaints', label: 'Complaints Template', group: 'Complaints', icon: MessageSquareText, master: 'complaint-hierarchy' },
];

export function stepById(id: OnboardingStepId): OnboardingStep {
  return ONBOARDING_STEPS.find((step) => step.id === id)!;
}

/** The steps either side of this one, for a step's Back and continue. */
export function adjacentSteps(id: OnboardingStepId): { previous?: OnboardingStep; next?: OnboardingStep } {
  const index = ONBOARDING_STEPS.findIndex((step) => step.id === id);
  return { previous: ONBOARDING_STEPS[index - 1], next: ONBOARDING_STEPS[index + 1] };
}
