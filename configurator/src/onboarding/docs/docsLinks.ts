import type { OnboardingStepId } from '../steps';

/** The Complaint Management documentation. */
export const DOCS_HOME = 'https://docs.digit.org/complaints-management';

/** Home, or one of the steps. */
export type DocsSection = 'home' | OnboardingStepId;

/**
 * The guide for each onboarding section. They all point at the Complaint
 * Management docs until each section has a page of its own.
 */
export const SECTION_DOCS: Record<DocsSection, string> = {
  home: DOCS_HOME,
  branding: DOCS_HOME,
  geography: DOCS_HOME,
  departments: DOCS_HOME,
  employees: DOCS_HOME,
  complaints: DOCS_HOME,
};
