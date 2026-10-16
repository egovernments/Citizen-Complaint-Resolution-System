import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.uiHomePage` — the citizen home page: the app
 * banners (desktop / mobile), the WhatsApp banners, the services card and the
 * "what's new" / information sections.
 *
 * Every field but `redirectURL` is an object, and the generic Edit form skips
 * object fields, so without this descriptor the form showed nothing but the
 * identifier and none of the home page could be changed from the configurator.
 * Each section is edited as JSON (the 'json' widget parse-validates and blocks
 * save while invalid).
 */
const section = (path: string, label: string, help: string) => ({ path, label, widget: 'json' as const, help });

export const uiHomePageDescriptor: SchemaDescriptor = {
  schema: 'common-masters.uiHomePage',
  groups: [
    { title: 'Banners', fields: ['appBannerDesktop', 'appBannerMobile', 'whatsAppBannerDesktop', 'whatsAppBannerMobile'] },
    { title: 'Sections', fields: ['citizenServicesCard', 'informationAndUpdatesCard', 'whatsNewSection'] },
  ],
  fields: [
    section('appBannerDesktop', 'App banner (desktop)', 'The citizen home banner on a wide screen: {"code", "name", "bannerUrl", "enabled"}.'),
    section('appBannerMobile', 'App banner (mobile)', 'The citizen home banner on a phone: {"code", "name", "bannerUrl", "enabled"}.'),
    section('whatsAppBannerDesktop', 'WhatsApp banner (desktop)', 'The WhatsApp banner on a wide screen.'),
    section('whatsAppBannerMobile', 'WhatsApp banner (mobile)', 'The WhatsApp banner on a phone.'),
    section('citizenServicesCard', 'Citizen services card', 'The services card on the citizen home.'),
    section('informationAndUpdatesCard', 'Information and updates card', 'The information and updates card on the citizen home.'),
    section('whatsNewSection', "What's new section", "The what's new section on the citizen home."),
  ],
};
