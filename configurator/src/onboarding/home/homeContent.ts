import type { ComponentType } from 'react';
import { Building2, MapPin, MessageSquareText, Network, Sparkles, Users } from 'lucide-react';
import type { OnboardingT } from '../i18n';
import type { OnboardingStepId } from '../steps';

/**
 * What the onboarding Home page says: each step's introduction, the
 * "Learn the basics" videos and the welcome slides. Product owns the wording,
 * images and video links, so they live here, apart from the components; a
 * video with no `youtubeId` yet shows as coming soon, and a slide with no
 * `image` falls back to an illustration of its step.
 */

export interface StepIntro {
  /** What the step is for, on the Start here card. */
  description: string;
  /** The short phrase "After this: <step> — <next>" uses. */
  next: string;
}

export function stepIntros(t: OnboardingT): Record<OnboardingStepId, StepIntro> {
  return {
    branding: {
      description: t(
        'home.intro.branding',
        'Set up your account logo, name and appearance that will show up on the citizen and employee experience.',
      ),
      next: t('home.next.branding', 'set your logo, name and theme'),
    },
    geography: {
      description: t(
        'home.intro.geography',
        'Define the areas you cover, from the largest down to the smallest, so every complaint can be placed and routed.',
      ),
      next: t('home.next.geography', 'define the areas you cover'),
    },
    departments: {
      description: t(
        'home.intro.departments',
        'Add the departments complaints are routed to, and the designations your employees hold.',
      ),
      next: t('home.next.departments', 'add the teams complaints go to'),
    },
    employees: {
      description: t('home.intro.employees', 'Add the people who will handle complaints, with their roles and the areas they cover.'),
      next: t('home.next.employees', 'add the people who handle complaints'),
    },
    complaints: {
      description: t(
        'home.intro.complaints',
        'Set up the kinds of complaints people can raise, which department handles each, and how long they should take.',
      ),
      next: t('home.next.complaints', 'set up what people can report'),
    },
  };
}

export interface LearnVideo {
  id: string;
  title: string;
  summary: string;
  /** The YouTube video id once it is published on eGov's channel. */
  youtubeId?: string;
  /** "2:14", shown once the video exists. */
  duration?: string;
  /** The card's placeholder tint until a real thumbnail exists. */
  tint: string;
}

export function learnVideos(t: OnboardingT): LearnVideo[] {
  return [
    { id: 'cms', title: t('home.videos.cms.title', 'What is CMS?'), summary: t('home.videos.cms.summary', 'How complaints flow end to end'), tint: 'bg-blue-50' },
    { id: 'branding', title: t('home.videos.branding.title', 'Setting up your branding'), summary: t('home.videos.branding.summary', 'Logo, name and theme'), tint: 'bg-amber-50' },
    { id: 'geography', title: t('home.videos.geography.title', 'Defining your geography'), summary: t('home.videos.geography.summary', 'Areas and their hierarchy'), tint: 'bg-emerald-50' },
    { id: 'departments', title: t('home.videos.departments.title', 'Adding departments'), summary: t('home.videos.departments.summary', 'Who complaints route to'), tint: 'bg-violet-50' },
    { id: 'employees', title: t('home.videos.employees.title', 'Adding employees'), summary: t('home.videos.employees.summary', 'Roles and the areas they cover'), tint: 'bg-sky-50' },
    { id: 'complaints', title: t('home.videos.complaints.title', 'Setting up complaints'), summary: t('home.videos.complaints.summary', 'Categories, routing and resolution time'), tint: 'bg-rose-50' },
  ];
}

export interface WelcomeSlide {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  note?: string;
  /** An illustration URL; until product supplies one, the slide shows its icon. */
  image?: string;
  icon: ComponentType<{ className?: string }>;
}

export function welcomeSlides(t: OnboardingT): WelcomeSlide[] {
  return [
    {
      id: 'welcome',
      eyebrow: t('home.welcome.welcome.eyebrow', 'Welcome'),
      title: t('home.welcome.welcome.title', 'Welcome to the Complaint Management System'),
      body: t(
        'home.welcome.welcome.body',
        'Citizens report a problem — a burst pipe, an unlit street, uncollected waste — and the system routes it to the team responsible, tracks it until it is resolved, and keeps the citizen informed.',
      ),
      note: t(
        'home.welcome.welcome.note',
        'Onboarding is where you describe your account so that routing can work. There are five sections, one after another, and you can come back to any of them.',
      ),
      icon: Sparkles,
    },
    {
      id: 'branding',
      eyebrow: t('home.welcome.branding.eyebrow', 'Step 1 · Branding'),
      title: t('home.welcome.branding.title', 'Make it yours'),
      body: t(
        'home.welcome.branding.body',
        'Your logo, name and colours appear on every page citizens and employees see, so they know whose service they are using.',
      ),
      icon: Building2,
    },
    {
      id: 'geography',
      eyebrow: t('home.welcome.geography.eyebrow', 'Step 2 · Geography'),
      title: t('home.welcome.geography.title', 'Where you work'),
      body: t(
        'home.welcome.geography.body',
        'The areas you cover, and how they nest inside each other. Every complaint is placed in one of them, and employees are given the areas they look after.',
      ),
      icon: MapPin,
    },
    {
      id: 'departments',
      eyebrow: t('home.welcome.departments.eyebrow', 'Step 3 · Departments'),
      title: t('home.welcome.departments.title', 'Who handles what'),
      body: t(
        'home.welcome.departments.body',
        'Departments are the teams complaints are sent to, and designations are the roles people hold in them.',
      ),
      icon: Network,
    },
    {
      id: 'employees',
      eyebrow: t('home.welcome.employees.eyebrow', 'Step 4 · Employees'),
      title: t('home.welcome.employees.title', 'Your team'),
      body: t(
        'home.welcome.employees.body',
        'The people who assign, work on and resolve complaints. Each one gets an invitation to sign in.',
      ),
      icon: Users,
    },
    {
      id: 'complaints',
      eyebrow: t('home.welcome.complaints.eyebrow', 'Step 5 · Complaints'),
      title: t('home.welcome.complaints.title', 'What people can report'),
      body: t(
        'home.welcome.complaints.body',
        'The kinds of complaints citizens can raise, the department each goes to, and how long it should take to resolve.',
      ),
      icon: MessageSquareText,
    },
  ];
}
