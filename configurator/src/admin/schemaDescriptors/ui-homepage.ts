import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.uiHomePage` — the citizen homepage layout
 * master (banners, services card, info card, what's-new) (CCSD-2002).
 *
 * Needed because every field except `redirectURL` is a nested object and the
 * generic Edit form skips objects it has no descriptor for; `redirectURL`
 * itself is the row id (x-unique) and renders disabled on the generic loop.
 * Net effect before this descriptor: the Edit screen had zero editable inputs.
 *
 * `redirectURL` is intentionally not listed (stays on the generic loop,
 * rendered disabled — it is the MDMS unique identifier). The per-service
 * `props` arrays inside citizenServicesCard / informationAndUpdatesCard have
 * no matching widget yet; unrendered fields stay in the form defaultValues
 * and the data provider merges onto the existing record, so they round-trip
 * unchanged on save.
 */
export const uiHomePageDescriptor: SchemaDescriptor = {
  schema: 'common-masters.uiHomePage',
  groups: [
    {
      title: 'App banners',
      fields: [
        'appBannerMobile.enabled',
        'appBannerMobile.bannerUrl',
        'appBannerDesktop.enabled',
        'appBannerDesktop.bannerUrl',
      ],
    },
    {
      title: 'WhatsApp banners',
      fields: [
        'whatsAppBannerMobile.enabled',
        'whatsAppBannerMobile.bannerUrl',
        'whatsAppBannerMobile.navigationUrl',
        'whatsAppBannerDesktop.enabled',
        'whatsAppBannerDesktop.bannerUrl',
        'whatsAppBannerDesktop.navigationUrl',
      ],
    },
    {
      title: 'Citizen services card',
      fields: [
        'citizenServicesCard.enabled',
        'citizenServicesCard.headerLabel',
        'citizenServicesCard.sideOption.enabled',
        'citizenServicesCard.sideOption.name',
        'citizenServicesCard.sideOption.navigationUrl',
      ],
    },
    {
      title: 'Information & updates card',
      fields: [
        'informationAndUpdatesCard.enabled',
        'informationAndUpdatesCard.headerLabel',
        'informationAndUpdatesCard.sideOption.enabled',
        'informationAndUpdatesCard.sideOption.name',
        'informationAndUpdatesCard.sideOption.navigationUrl',
      ],
    },
    {
      title: "What's new section",
      fields: [
        'whatsNewSection.enabled',
        'whatsNewSection.headerLabel',
        'whatsNewSection.sideOption.enabled',
        'whatsNewSection.sideOption.name',
        'whatsNewSection.sideOption.navigationUrl',
      ],
    },
  ],
  fields: [
    { path: 'appBannerMobile.enabled', widget: 'boolean', label: 'App banner (mobile) — enabled' },
    { path: 'appBannerMobile.bannerUrl', widget: 'text', label: 'App banner (mobile) — image URL' },
    { path: 'appBannerDesktop.enabled', widget: 'boolean', label: 'App banner (desktop) — enabled' },
    { path: 'appBannerDesktop.bannerUrl', widget: 'text', label: 'App banner (desktop) — image URL' },
    { path: 'whatsAppBannerMobile.enabled', widget: 'boolean', label: 'WhatsApp banner (mobile) — enabled' },
    { path: 'whatsAppBannerMobile.bannerUrl', widget: 'text', label: 'WhatsApp banner (mobile) — image URL' },
    { path: 'whatsAppBannerMobile.navigationUrl', widget: 'text', label: 'WhatsApp banner (mobile) — link URL' },
    { path: 'whatsAppBannerDesktop.enabled', widget: 'boolean', label: 'WhatsApp banner (desktop) — enabled' },
    { path: 'whatsAppBannerDesktop.bannerUrl', widget: 'text', label: 'WhatsApp banner (desktop) — image URL' },
    { path: 'whatsAppBannerDesktop.navigationUrl', widget: 'text', label: 'WhatsApp banner (desktop) — link URL' },
    { path: 'citizenServicesCard.enabled', widget: 'boolean', label: 'Citizen services card — enabled' },
    {
      path: 'citizenServicesCard.headerLabel',
      widget: 'text',
      label: 'Citizen services card — header label',
      help: 'Localization key or plain text shown as the card title.',
    },
    { path: 'citizenServicesCard.sideOption.enabled', widget: 'boolean', label: 'Citizen services card — side link enabled' },
    { path: 'citizenServicesCard.sideOption.name', widget: 'text', label: 'Citizen services card — side link label' },
    { path: 'citizenServicesCard.sideOption.navigationUrl', widget: 'text', label: 'Citizen services card — side link URL' },
    { path: 'informationAndUpdatesCard.enabled', widget: 'boolean', label: 'Info & updates card — enabled' },
    { path: 'informationAndUpdatesCard.headerLabel', widget: 'text', label: 'Info & updates card — header label' },
    { path: 'informationAndUpdatesCard.sideOption.enabled', widget: 'boolean', label: 'Info & updates card — side link enabled' },
    { path: 'informationAndUpdatesCard.sideOption.name', widget: 'text', label: 'Info & updates card — side link label' },
    { path: 'informationAndUpdatesCard.sideOption.navigationUrl', widget: 'text', label: 'Info & updates card — side link URL' },
    { path: 'whatsNewSection.enabled', widget: 'boolean', label: "What's new — enabled" },
    { path: 'whatsNewSection.headerLabel', widget: 'text', label: "What's new — header label" },
    { path: 'whatsNewSection.sideOption.enabled', widget: 'boolean', label: "What's new — side link enabled" },
    { path: 'whatsNewSection.sideOption.name', widget: 'text', label: "What's new — side link label" },
    { path: 'whatsNewSection.sideOption.navigationUrl', widget: 'text', label: "What's new — side link URL" },
  ],
};
