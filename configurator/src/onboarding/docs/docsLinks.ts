import type { ComponentType } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import type { OnboardingT } from '../i18n';
import type { OnboardingStepId } from '../steps';

/** The Complaint Management documentation. */
export const DOCS_HOME = 'https://docs.digit.org/complaints-management';

/** All of DIGIT's documentation: the rail's footer, the same link as the account menu's. */
export const DIGIT_DOCS = 'https://docs.digit.org';

/** The account creation and onboarding guide: on every page, and the root of each page's own guide. */
export const ONBOARDING_GUIDE = `${DOCS_HOME}/access/account-creation-and-onboarding-guide`;

/** Home, or one of the steps. */
export type DocsSection = 'home' | OnboardingStepId;

export interface DocsLink {
  /** Stable, for telemetry. */
  id: string;
  title: string;
  description: string;
  url: string;
}

export interface DocsGroup {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  links: DocsLink[];
}

/**
 * What the Documentation rail lists on each onboarding page: the guide for the
 * page itself, then the onboarding guide, which every page carries. The pages
 * of the guide are product's (#2358); their addresses change here only.
 */
export function docsFor(section: DocsSection, t: OnboardingT): DocsGroup[] {
  const link = (id: string, url: string, title: string, description: string): DocsLink => ({ id, title, description, url });
  const guide = (page: string) => `${ONBOARDING_GUIDE}/${page}`;
  const gettingStarted: DocsGroup = {
    id: 'getting_started',
    title: t('docs.group.getting_started', 'Getting started'),
    icon: BookOpen,
    links: [
      link(
        'onboarding',
        ONBOARDING_GUIDE,
        t('docs.link.onboarding.title', 'Setting up your account'),
        t('docs.link.onboarding.description', 'What each onboarding section is for'),
      ),
      link(
        'overview',
        DOCS_HOME,
        t('docs.link.overview.title', 'Complaint Management overview'),
        t('docs.link.overview.description', 'How a complaint moves from report to resolution'),
      ),
    ],
  };
  const thisPage = (links: DocsLink[]): DocsGroup => ({
    id: 'this_section',
    title: t('docs.group.this_section', 'This section'),
    icon: FileText,
    links,
  });

  switch (section) {
    case 'home':
      return [
        thisPage([
          link(
            'get_started',
            guide('get-started'),
            t('docs.link.get_started.title', 'Get started'),
            t('docs.link.get_started.description', 'What you need before you begin'),
          ),
          link(
            'onboarding_steps',
            guide('onboarding'),
            t('docs.link.onboarding_steps.title', 'The onboarding steps'),
            t('docs.link.onboarding_steps.description', 'Branding, geography, departments, employees and complaints'),
          ),
          link(
            'create_account',
            guide('create-account'),
            t('docs.link.create_account.title', 'Creating your account'),
            t('docs.link.create_account.description', 'Signing up and verifying your details'),
          ),
          link('glossary', guide('glossary'), t('docs.link.glossary.title', 'Glossary'), t('docs.link.glossary.description', 'The terms used during setup')),
        ]),
        gettingStarted,
      ];
    case 'branding':
      return [
        thisPage([
          link(
            'branding',
            guide('branding'),
            t('docs.link.branding.title', 'Branding guide'),
            t('docs.link.branding.description', 'Logo, name and theme'),
          ),
        ]),
        gettingStarted,
      ];
    case 'geography':
      return [
        thisPage([
          link(
            'geography',
            guide('geography'),
            t('docs.link.geography.title', 'Geography guide'),
            t('docs.link.geography.description', 'Areas and the levels they break down into'),
          ),
        ]),
        gettingStarted,
      ];
    case 'departments':
      return [
        thisPage([
          link(
            'departments',
            guide('departments'),
            t('docs.link.departments.title', 'Departments guide'),
            t('docs.link.departments.description', 'Departments and the designations in them'),
          ),
        ]),
        gettingStarted,
      ];
    case 'employees':
      return [
        thisPage([
          link(
            'employees',
            guide('employees'),
            t('docs.link.employees.title', 'Employees guide'),
            t('docs.link.employees.description', 'Staff, their roles and the areas they serve'),
          ),
        ]),
        gettingStarted,
      ];
    case 'complaints':
      return [
        thisPage([
          link(
            'complaints',
            guide('complaint-template'),
            t('docs.link.complaints.title', 'Complaints template guide'),
            t('docs.link.complaints.description', 'Complaint types, routing and resolution time'),
          ),
        ]),
        gettingStarted,
      ];
  }
}
