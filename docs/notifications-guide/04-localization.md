# 4. Localization

## 4.1 Where locale lives

Locale is a **first-class dimension of the template key**. A `NotificationTemplate` row
is uniquely `(audience, action, toState, channel, locale)` (`RAINMAKER-PGR.json:318-324`),
and the renderer matches on all five including locale
(`TemplateRenderer.findField :69-83`). The seed carries both `en_IN` and `hi_IN` bodies
for many keys, and `NotificationProviderTemplate` carries `en_IN`/`hi_IN` Content SID
pairs for WhatsApp (see the seed — every WhatsApp row is duplicated per locale).

So the **data model fully supports per-locale content.** The gap is in *selection*.

## 4.2 The current single-locale reality

pgr-services renders every recipient with **one** locale:
`pgr.notification.default.locale` (default `en_IN`, `PGRConfiguration.java:253-254`).

- `processConfigDriven` sets `String locale = config.getNotificationDefaultLocale()`
  once and uses it for the whole fan-out (`NotificationService.java:883, 933, 939`).
- `ResolvedRecipient.locale` is populated with the same default for every recipient
  (citizen, assignee, role-pool member — `:970, 1004, 1084`), **not** from the user's
  actual `preferredLanguage`.
- The class documents this as an accepted limitation for the single-locale pilot: *"the
  NotificationTemplate `locale` dimension and Contact.locale are carried but not yet
  resolved per recipient"* (`:860-865`).

The consequence: even though a user's preference record says `preferredLanguage: hi_IN`
(as the live `ke` probe showed), they still receive the `en_IN` body, because rendering
never consults it. Per-recipient localization is a tracked open item — it needs
resolving a real per-user locale and rendering per `(audience, channel, locale)` group.

## 4.3 Default-locale fallback (renderer)

Within the single-locale model there is still a safety fallback in the renderer:
`renderField` first looks up the requested locale; if no row matches and the configured
default locale differs, it retries at the default locale before giving up
(`TemplateRenderer.java:55-58`). Today, since the requested locale *is* the default,
this rarely fires — but it means a deployment that later passes a non-default requested
locale won't hard-fail when only a default-locale template exists. (This is also why the
reconstructed dispatch-log `templateKey` "matches the template uid except when the
renderer fell back to its default locale" — `DispatchPipelineService.java:340-347`.)

## 4.4 novu-bridge's locale handling

novu-bridge does **not** localize — PGR owns it. The bridge only carries the locale
through: `deriveContext` reads `contact.locale` (falling back to
`novu.bridge.default.locale`, default `en_IN`, `NovuBridgeConfiguration.java:38-39`) and
passes it to Novu `identify` as the subscriber's `locale`
(`NovuClient.identify :102-104`). That subscriber locale would matter only if a Novu
workflow did in-Novu translation — these delivery-shell workflows do not; they emit the
pre-rendered `payload.body` verbatim.

## 4.5 Adding a language

To make Swahili (`sw_KE`) content available (data side), you would seed, at tenant `ke`:
1. `NotificationTemplate` rows for every `(audience, action, toState, channel)` you
   notify, with `locale: sw_KE` and a translated `body`/`subject`.
2. For WhatsApp, `NotificationProviderTemplate` rows with `locale: sw_KE` pointing at
   approved `sw_KE` Content SIDs.

But **it won't reach anyone** until per-recipient locale selection is implemented in
`processConfigDriven` (or `pgr.notification.default.locale` is switched deployment-wide).
Until then, the effective rule is: **whatever `pgr.notification.default.locale` is, that
is the only language delivered.**
