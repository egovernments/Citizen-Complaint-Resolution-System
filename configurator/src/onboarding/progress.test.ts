import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS } from './steps';
import { completedCount, finishesOnboarding, isOnboardingComplete, resumePath, stepForPath, stepStatus } from './progress';

const step = (id: string) => ONBOARDING_STEPS.find((candidate) => candidate.id === id)!;

describe('onboarding progress', () => {
  it('has the five agreed steps, in unlock order', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual(['branding', 'geography', 'departments', 'employees', 'complaints']);
    expect(ONBOARDING_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resumes at the first unfinished step', () => {
    expect(resumePath([])).toBe('/onboarding/branding');
    expect(resumePath([1, 2])).toBe('/onboarding/departments');
    // A gap resumes at the gap, not after the furthest step
    expect(resumePath([1, 3])).toBe('/onboarding/geography');
  });

  it('is complete only when every step is done', () => {
    expect(isOnboardingComplete([1, 2, 3, 4])).toBe(false);
    expect(isOnboardingComplete([5, 4, 3, 2, 1])).toBe(true);
    // Numbers that are not steps do not count
    expect(completedCount([1, 2, 9])).toBe(2);
  });

  it('opens finished steps and the next one, and locks the rest', () => {
    const completed = [1, 2];
    expect(stepStatus(step('branding'), completed)).toBe('done');
    expect(stepStatus(step('departments'), completed)).toBe('in-progress');
    expect(stepStatus(step('employees'), completed)).toBe('locked');
    expect(stepStatus(step('complaints'), completed)).toBe('locked');
  });

  it('maps a path, including nested ones, to its step', () => {
    expect(stepForPath('/onboarding/employees')?.id).toBe('employees');
    expect(stepForPath('/onboarding/employees/new')?.id).toBe('employees');
    expect(stepForPath('/manage')).toBeUndefined();
  });

  it('counts onboarding finished on the step that completes the last one, once', () => {
    // The complaints template (step 5) ends onboarding, not employees (step 4).
    expect(finishesOnboarding(4, [1, 2, 3])).toBe(false);
    expect(finishesOnboarding(5, [1, 2, 3, 4])).toBe(true);
    // Re-saving a step after onboarding is done doesn't finish it again.
    expect(finishesOnboarding(1, [1, 2, 3, 4, 5])).toBe(false);
  });
});
