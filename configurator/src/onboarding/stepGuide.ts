import type { OnboardingT } from './i18n';
import type { OnboardingStepId } from './steps';

export interface StepGuide {
  /** What the step is for: the rail's setup card and Home's Start here card both show it. */
  description: string;
  /** The button that opens the step from either card. */
  action: string;
  /** The short phrase Home's "After this: <step> — <next>" uses. */
  next: string;
}

/**
 * Product's wording for each step, from #2358. The rail's setup card and Home's
 * Start here card read the same strings, so the two never describe a step
 * differently.
 */
export function stepGuide(t: OnboardingT): Record<OnboardingStepId, StepGuide> {
  return {
    branding: {
      description: t(
        'guide.branding.description',
        'Set up your account logo, name and appearance that will show up on the citizen and employee experience.',
      ),
      action: t('guide.branding.action', 'Set Up Branding'),
      next: t('home.next.branding', 'set your logo, name and theme'),
    },
    geography: {
      description: t(
        'guide.geography.description',
        'Define the geographic areas your account covers and their hierarchies (e.g. County → Sub-county).',
      ),
      action: t('guide.geography.action', 'Define Geography'),
      next: t('home.next.geography', 'define the areas you cover'),
    },
    departments: {
      description: t(
        'guide.departments.description',
        'The departments complaints get routed to, and the designations your employees hold.',
      ),
      action: t('guide.departments.action', 'Add Departments'),
      next: t('home.next.departments', 'add the teams complaints go to'),
    },
    employees: {
      description: t(
        'guide.employees.description',
        'Add the staff who will actually resolve complaints, and assign them to departments and geographic jurisdictions.',
      ),
      action: t('guide.employees.action', 'Add Employees'),
      next: t('home.next.employees', 'add the people who handle complaints'),
    },
    complaints: {
      description: t('guide.complaints.description', 'Choose the template that defines what citizens can report.'),
      action: t('guide.complaints.action', 'Choose Template'),
      next: t('home.next.complaints', 'set up what people can report'),
    },
  };
}
