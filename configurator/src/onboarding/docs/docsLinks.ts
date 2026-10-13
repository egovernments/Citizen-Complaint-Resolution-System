import type { ComponentType } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import type { OnboardingT } from '../i18n';
import type { OnboardingStepId } from '../steps';

/** The Complaint Management documentation. */
export const DOCS_HOME = 'https://docs.digit.org/complaints-management';

/** All of DIGIT's documentation: the rail's footer, the same link as the account menu's. */
export const DIGIT_DOCS = 'https://docs.digit.org';

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
 * What the Documentation rail lists on each onboarding page: the guides for the
 * page itself, then where to start. Every link points at the Complaint
 * Management docs until each page has one of its own; product sends the real
 * addresses, and they change here only.
 */
export function docsFor(section: DocsSection, t: OnboardingT): DocsGroup[] {
  const link = (id: string, title: string, description: string): DocsLink => ({ id, title, description, url: DOCS_HOME });
  const gettingStarted: DocsGroup = {
    id: 'getting_started',
    title: t('docs.group.getting_started', 'Getting started'),
    icon: BookOpen,
    links: [
      link(
        'overview',
        t('docs.link.overview.title', 'Complaint Management overview'),
        t('docs.link.overview.description', 'How a complaint moves from report to resolution'),
      ),
      link(
        'onboarding',
        t('docs.link.onboarding.title', 'Setting up your account'),
        t('docs.link.onboarding.description', 'What each onboarding section is for'),
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
      return [gettingStarted];
    case 'branding':
      return [
        thisPage([
          link('branding', t('docs.link.branding.title', 'Branding guide'), t('docs.link.branding.description', 'Logo, name and theme')),
        ]),
        gettingStarted,
      ];
    case 'geography':
      return [
        thisPage([
          link(
            'geography',
            t('docs.link.geography.title', 'Geography guide'),
            t('docs.link.geography.description', 'Areas and the levels they break down into'),
          ),
          link(
            'boundary_import',
            t('docs.link.boundary_import.title', 'Importing boundaries'),
            t('docs.link.boundary_import.description', 'Upload a file or use a ready-made set'),
          ),
        ]),
        gettingStarted,
      ];
    case 'departments':
      return [
        thisPage([
          link(
            'departments',
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
            t('docs.link.employees.title', 'Employees guide'),
            t('docs.link.employees.description', 'Staff, their roles and the areas they serve'),
          ),
          link(
            'invites',
            t('docs.link.invites.title', 'Inviting employees'),
            t('docs.link.invites.description', 'How staff get access to sign in'),
          ),
        ]),
        gettingStarted,
      ];
    case 'complaints':
      return [
        thisPage([
          link(
            'complaints',
            t('docs.link.complaints.title', 'Complaints template guide'),
            t('docs.link.complaints.description', 'Complaint types, routing and resolution time'),
          ),
        ]),
        gettingStarted,
      ];
  }
}
