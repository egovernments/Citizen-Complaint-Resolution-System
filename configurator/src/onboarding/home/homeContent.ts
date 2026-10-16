import type { ComponentType } from 'react';
import { Building2, MapPin, MessageSquareText, RotateCcw, Sparkles, Users } from 'lucide-react';
import type { OnboardingT } from '../i18n';
import brandingImage from './tour/branding.webp';
import cmsImage from './tour/cms.webp';
import complaintsImage from './tour/complaints.webp';
import geographyImage from './tour/geography.webp';
import peopleImage from './tour/people.webp';

/**
 * What the onboarding Home page says: the "Learn the basics" videos and the
 * tour. Product owns the wording, images and video links, so they live here,
 * apart from the components; a video with no `youtubeId` yet shows as coming
 * soon, and a tour page with no `image` shows its step's icon. Each step's
 * description and button are in ../stepGuide.
 */

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
    { id: 'branding', title: t('home.videos.branding.title', 'Setting up your branding'), summary: t('home.videos.branding.summary', 'Logo, name and theme'), youtubeId: 'ZdkVdTviiY8', duration: '0:59', tint: 'bg-amber-50' },
    { id: 'geography', title: t('home.videos.geography.title', 'Defining your geography'), summary: t('home.videos.geography.summary', 'Areas and their hierarchy'), youtubeId: 'nA8sNGnCzxc', duration: '4:30', tint: 'bg-emerald-50' },
    { id: 'departments', title: t('home.videos.departments.title', 'Adding departments'), summary: t('home.videos.departments.summary', 'Who complaints route to'), youtubeId: '-akBHQQbJz0', duration: '2:11', tint: 'bg-violet-50' },
    { id: 'employees', title: t('home.videos.employees.title', 'Adding employees'), summary: t('home.videos.employees.summary', 'Roles and the areas they cover'), youtubeId: 'SuI3lzRpdI4', duration: '2:20', tint: 'bg-sky-50' },
    { id: 'complaints', title: t('home.videos.complaints.title', 'Setting up complaints'), summary: t('home.videos.complaints.summary', 'Categories, routing and resolution time'), youtubeId: 'gG2WKsV2H18', duration: '2:20', tint: 'bg-rose-50' },
  ];
}

export interface WelcomeSlide {
  id: string;
  eyebrow: string;
  title: string;
  /** The page's text, one paragraph each. */
  paragraphs: string[];
  /** A square illustration; a page without one shows its icon. */
  image?: string;
  icon: ComponentType<{ className?: string }>;
}

/** The tour ("Take a tour" on Home), in product's order and wording from #2358. */
export function welcomeSlides(t: OnboardingT): WelcomeSlide[] {
  const setup = t('home.tour.eyebrow_setup', 'Setting up your account');
  return [
    {
      id: 'cms',
      eyebrow: t('home.tour.cms.eyebrow', 'Welcome'),
      title: t('home.tour.cms.title', 'Complaint Management System'),
      paragraphs: [
        t('home.tour.cms.body', 'One modular system connecting citizen voices to responsive institutions and efficient services.'),
        t(
          'home.tour.cms.body_flow',
          'A citizen reports a burst pipe, an unlit street or uncollected waste, and the staff responsible pick up the complaints assigned to them, resolve them, and keep the citizen informed.',
        ),
        t('home.tour.cms.body_onboarding', 'Onboarding is where you set up your account to make this system possible.'),
      ],
      image: cmsImage,
      icon: Sparkles,
    },
    {
      id: 'complaints',
      eyebrow: setup,
      title: t('home.tour.complaints.title', 'Complaints Template'),
      paragraphs: [
        t(
          'home.tour.complaints.body',
          'Pick from our template offerings with pre-loaded setup for issues ranging from Electricity-related complaints to Local Governance Complaints.',
        ),
      ],
      image: complaintsImage,
      icon: MessageSquareText,
    },
    {
      id: 'branding',
      eyebrow: setup,
      title: t('home.tour.branding.title', 'Branding'),
      paragraphs: [
        t(
          'home.tour.branding.body',
          'Establish your account’s identity by adding a logo, name and appearance that will be reflected in the citizen and employee experience.',
        ),
      ],
      image: brandingImage,
      icon: Building2,
    },
    {
      id: 'geography',
      eyebrow: setup,
      title: t('home.tour.geography.title', 'Geography'),
      paragraphs: [
        t(
          'home.tour.geography.body',
          'Add the areas your account covers and the levels they break down into, such as county, sub-county and ward. Complaints are raised at the lowest level of this hierarchy and reported at every level above.',
        ),
        t(
          'home.tour.geography.body_use',
          'These define the area a complaint is raised in, and the jurisdictions an employee is assigned to serve.',
        ),
      ],
      image: geographyImage,
      icon: MapPin,
    },
    {
      id: 'people',
      eyebrow: setup,
      title: t('home.tour.people.title', 'Departments and Employees'),
      paragraphs: [
        t(
          'home.tour.people.body',
          'Define the Departments associated with your account and the employees working in these departments.',
        ),
        t(
          'home.tour.people.body_routing',
          'Each employee is assigned to a department and to the geographic areas they serve, which is what lets a complaint reach the right person.',
        ),
      ],
      image: peopleImage,
      icon: Users,
    },
    {
      id: 'return',
      eyebrow: t('home.tour.return.eyebrow', 'Anytime'),
      title: t('home.tour.return.title', 'You can come back to this'),
      paragraphs: [
        t(
          'home.tour.return.body',
          'The ‘Take a tour’ button sits at the top-right of your Home screen. It reopens this tour whenever you want it.',
        ),
        t(
          'home.tour.return.body_docs',
          'Every section during account setup also has a “Documentation” section on the right side, with guidance for how to fill each field on that page.',
        ),
      ],
      icon: RotateCcw,
    },
  ];
}
