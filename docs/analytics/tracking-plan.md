# Tracking plan

The single list of product events the CMS sends to PostHog and Matomo: onboarding and the management console (`configurator/`), and the citizen and employee apps (`digit-ui-esbuild/`). Background, research and decisions are on #2582. A new event, or a change to one, is made here first, then in code. For the console, `configurator/src/lib/analytics.test.ts` fails when this page and the code disagree.

## Rules

- **Name:** `category:object_action`, lowercase snake_case, present tense (`submit`, `select`, `open`, `complete`). Names are fixed strings, never assembled from data.
- **Category** is the product area, not the app: `app`, `signup`, `onboarding`, `complaint`, `dashboard`. Which app sent the event is the `app` property.
- **No PII anywhere:** no names, phone numbers, emails, ID numbers or free text in any event, property or URL. Records are referred to by type and count, never by value. The *choices* people make (a country, a language, a method) are not PII and are sent. The console enforces this in one place: a property whose key names a person or contact detail, or whose value holds an `@`, a phone-length run of digits or more than 80 characters, is dropped before sending, and URLs lose their query string and any path segment with a digit in it (`/manage/employees/:id/show`).
- **Identity is pseudonymous.**
  - **Admins:** the first 32 hex characters of a SHA-256 of `cms-console:` plus the DIGIT user's uuid, so a funnel can follow one admin across days. No name, email or phone goes to PostHog or Sentry.
  - **Citizens and employees:** stay anonymous.
- **Matomo shape:** each event becomes Matomo's Category (before the colon), Action (after the colon), Name (the event's **label** property, below) and Value (`count`, when there is one). Matomo goals match one field, so every funnel step is its own Action, or its own Name under one Action.
- **PostHog shape:** the event name as is, with every property below. `app` and `tenant_id` are sent on every event.

## Where the console's events go

- **PostHog:** the console's own project, as before. No autocapture (it records the text of what was clicked), no session recording, and page views sent once each by the app.
- **Matomo:** the deployment's `common-masters.AnalyticsProvider` rows at the root tenant, read the same way the citizen app reads them. A Matomo row is used for the console only when its **Surfaces** list `console`, so a site set up for citizens doesn't start counting admins. Give the console its own Matomo site (its own site id) to keep admin visits out of citizen numbers. Cookies are off and Do Not Track is honoured.
- **Sentry:** errors, with emails and phone numbers masked in messages, no default PII and replays fully masked.

## Properties used everywhere

| Property | Values | PostHog | Matomo |
|---|---|---|---|
| `app` | `console`, `citizen`, `employee` | on every event | visit dimension (planned) |
| `tenant_id` | the workspace, or a city within it | on every event | visit dimension (planned) |
| `step` | onboarding: `branding`, `geography`, `departments`, `employees`, `complaints`; signup: `sign_in`, `check_email`, `account`, `preferences`, `review` | property | Name on `step_*` events |
| `method` | geography: `preconfigured`, `fetch`, `excel`; departments, employees and complaints: `form`, `bulk`; signup: `magic_link` or the sign-in provider's id | property | Name on `method_*` events |
| `entity` | `branding`, `boundary`, `department`, `designation`, `employee`, `complaint_type` | property | Name on record and import events |
| `count` | a number of records | property | Value |
| `error_code` | a stable code (`DUPLICATE_CODE`, `HTTP_403`, …), never a message | property | Name on `*_fail` and `*_refuse` events |

## Management console and onboarding (`configurator/`)

### App-wide

| Event | Label | Other properties | When |
|---|---|---|---|
| `app:session_restore` | — | — | a signed-in session is picked up on load |
| `app:sign_out` | — | — | the admin signs out |
| `app:locale_change` | `to` | `from` | the language is changed |
| `app:theme_change` | `to` | `from` | light or dark theme is changed |
| `app:help_open` | — | — | Help & Shortcuts is opened |
| `app:docs_open` | `link` | `from`, `section` | a documentation link is followed |

Page views are sent separately: PostHog `$pageview` and Matomo `trackPageView`, with the scrubbed path only.

### Account creation (signup)

| Event | Label | Other properties | When |
|---|---|---|---|
| `signup:step_view` | `step` | — | a sign-up step opens: the sign-in gate, the check-your-email screen, then Account, Preferences and Review |
| `signup:method_select` | `method` | — | a way to sign up is picked |
| `signup:link_send` | — | — | the sign-up email is sent |
| `signup:step_complete` | `step` | on `preferences`: `country`, `languages` (comma-separated codes), `time_zone`, `financial_year` | a step's Continue succeeds (never the mobile number) |
| `signup:account_submit` | `country` | — | the account is submitted for creation |
| `signup:provision_complete` | — | — | the account is ready |
| `signup:provision_fail` | `error_code` | `retryable` | provisioning stops |
| `signup:details_change` | `error_code` | — | "Change my details" after a refused run |

### Onboarding

| Event | Label | Other properties | When |
|---|---|---|---|
| `onboarding:home_view` | — | `done` (steps completed) | Home opens |
| `onboarding:tour_open` | — | `auto` (first visit) | the tour opens |
| `onboarding:tour_page_view` | `page` | — | a tour page shows |
| `onboarding:tour_close` | `page` | `finished` | the tour closes |
| `onboarding:video_play` | `video` | — | a Learn the basics video opens |
| `onboarding:step_view` | `step` | — | a step opens (was `phase_start`) |
| `onboarding:method_select` | `method` | `step` | a way of doing the step is chosen |
| `onboarding:method_cancel` | `method` | `step` | backing out of that way |
| `onboarding:geography_area_search` | `method` | `outcome` (`found`, `choose_one`, `no_results`, `nothing_inside`, `no_boundaries`, `too_few_levels`, `fetch_failed`), `source`, `levels` | an area search answers (fetch, preconfigured) |
| `onboarding:geography_levels_select` | `method` | `levels`, `hierarchy` (`new`, `existing`, `fetched`) | the hierarchy's levels are settled |
| `onboarding:template_download` | `entity` | `step` | a bulk-upload template is downloaded |
| `onboarding:upload_refuse` | `error_code` | `step`, `entity`, `count` (problems) | an uploaded file is refused before anything is written |
| `onboarding:record_save` | `entity` | `step`, `method` (`form`), `operation` (`create`, `update`, `delete`), and counts such as `roles` | records are saved from a form (was `entity_create/update/delete`) |
| `onboarding:import_complete` | `entity` | `step`, `method`, `count`, `failed` | a bulk upload or fetch finishes (was `entity_import`) |
| `onboarding:invite_send` | `outcome` | `link` on a resend | an employee invite is sent (`sent`, `sent_again`, `resent`, `failed`) |
| `onboarding:step_complete` | `step` | `skipped` | a step is completed (was `phase_complete`) |
| `onboarding:step_fail` | `error_code` | `step`, `action` | a save the admin saw fail; the error itself goes to Sentry |
| `onboarding:flow_complete` | — | — | all five steps are done (was `onboarding_complete`) |

#### The onboarding funnels

- **Whole flow:** `signup:account_submit` → `signup:provision_complete` → `onboarding:step_complete` for each of the 5 steps, in order (Matomo: Name) → `onboarding:flow_complete`.
- **Geography, per method:** `onboarding:method_select` (step = geography) → `onboarding:geography_area_search` (outcome = found) or `onboarding:template_download` → `onboarding:geography_levels_select` → `onboarding:import_complete` (step = geography) → `onboarding:step_complete` (Name `geography`). Break down by `method`; `onboarding:upload_refuse` and `onboarding:method_cancel` show where it stalls.

## Citizen and employee apps (`digit-ui-esbuild/`)

`app` is `citizen` or `employee` from the route. Click tags (`data-analytics-event`, with `data-analytics-label` for the label) and `trackEvent` calls use the same names. The analytics shim (`public/analytics.js`) reads a name of this shape as Matomo's Category and Action; PostHog gets `app` and `tenant_id` on every event and page view, next to the older `tenant` and `entrance`.

| Event | Label | Was |
|---|---|---|
| `app:menu_open` | — | `shell.menu.open` |
| `app:nav_toggle` | — | `shell.rail.toggle` |
| `app:sign_out` | — | `shell.rail.logout`, `shell.drawer.logout` |
| `app:language_menu_open` | — | `shell.language.open` |
| `app:locale_change` | `to` | `shell.language.select` |
| `complaint:file_stepper_click` | `step` | `pgr.file-complaint.stepper.<step>` |
| `complaint:file_details_complete` | — | `pgr.file-complaint.details` (Next) |
| `complaint:file_location_complete` | — | `pgr.file-complaint.location` (Next) |
| `complaint:file_submit` | — | `pgr.file-complaint.submit` |
| `complaint:file_submit_success` | — | `pgr.file-complaint.submitted` |
| `complaint:file_submit_fail` | — | `pgr.file-complaint.submit-failed` |
| `complaint:file_cancel` | — | `pgr.file-complaint.cancel` |
| `complaint:file_step_back` | `step` | `pgr.file-complaint.back.<step>` |
| `complaint:location_level_select` | `level` | `pgr.boundary.selected` |
| `complaint:photo_picker_open` | — | `pgr.file-complaint.photo.open` |
| `complaint:photo_browse_click` | — | `…photo.browse` |
| `complaint:photo_camera_click` | — | `…photo.camera` |
| `complaint:photo_gallery_click` | — | `…photo.gallery` |
| `complaint:photo_picker_cancel` | — | `…photo.cancel` |
| `complaint:photo_upload_retry` | — | `…photo.retry` |
| `complaint:photo_remove` | — | `…photo.remove` |
| `complaint:photo_upload_success` | `size` (`original`, `scaled`) | `…photo.uploaded` |
| `complaint:photo_upload_fail` | — | `…photo.upload-failed` |
| `complaint:photo_reject` | `reason` (`type`, `size`, `limit`) | `…photo.rejected` |
| `complaint:photo_drop` | — (Value: files) | `…photo.dropped` |
| `complaint:voice_recorder_open` | — | `…voice.open` |
| `complaint:voice_record_stop` | — | `…voice.stop` |
| `complaint:voice_recorder_cancel` | — | `…voice.cancel` |
| `complaint:voice_transcript_use` | — | `…voice.use` |
| `complaint:voice_retake` | — | `…voice.retake` |
| `complaint:voice_delete` | — | `…voice.delete` |
| `complaint:voice_retry` | — | `…voice.retry` |
| `complaint:voice_transcribe_success` | — (Value: seconds) | `…voice.transcribed` |
| `complaint:voice_transcribe_fail` | `error_code` | `…voice.failed` |
| `complaint:my_complaints_item_open` | `from` (Value: 1 while searching) | `pgr.my-complaints.open` |
| `complaint:my_complaints_search` | — (Value: matches) | `pgr.my-complaints.search` |
| `complaint:details_home_click` | — | `pgr.complaint.details-home` |
| `complaint:details_file_another_click` | — | `pgr.complaint.details-file-another` |
| `complaint:response_view_click` | — | `pgr.complaint.response-view` |
| `complaint:response_retry_click` | — | `pgr.complaint.response-try-again` |
| `complaint:response_home_click` | — | `pgr.complaint.response-go-home` |
| `complaint:response_number_copy` | — | `pgr.complaint.response-copy-number` |
| `complaint:action_menu_open` | — | `pgr.complaint.take-action` |
| `complaint:action_select` | `action` | `pgr.complaint.action-selected` |
| `complaint:reopen_block` | — | `pgr.complaint.reopen-blocked` |
| `dashboard:filters_clear` | — | `dashboard.filters.clear` |

#### The citizen funnel

Page view of `/citizen/pgr/create-complaint` → `complaint:file_details_complete` → `complaint:file_location_complete` → `complaint:file_submit` → `complaint:file_submit_success`. Step-by-step setup in each tool is in the funnel guide on #2582.
