# CMS v2.20 Release Notes

**Covers:** v2.12 → v2.20 (including the v2.12.1 patch), as of `master` at `63472b4a1` and `develop` at `c05914039` (27 Oct 2026). **Who this is for:** citizens, government administrators, partners and anyone evaluating the release.

**See also:** [Deployment changelog](release-config-changelog-v2.20.md) for the settings to change and the upgrade steps, and the [Migration guide](migration-guide-v2.12-to-v2.20-beta.md).

## A. Release overview

CMS (Complaint Management System) v2.20 adds self-serve workspace onboarding, a single sign-in service built on Keycloak, per-tenant notifications, and a redesigned citizen and employee experience. It also includes every v2.12.1 patch fix.

| Item | Value |
| --- | --- |
| Product | CMS (Complaint Management System), built on the DIGIT platform |
| Release | v2.20, the self-serve SaaS release |
| Builds on | v2.12 (September 2026) and its v2.12.1 patch (October 2026) |
| Release date | To be confirmed |
| For upgrades | See the [Deployment changelog](release-config-changelog-v2.20.md) |

**Themes**

1. **Self-serve onboarding.** A government signs up, sets up its own complaint system in five guided steps, and starts taking complaints without eGov engineers.
2. **One sign-in for everyone.** Citizens, employees and administrators sign in through one secure service. People can belong to several workspaces.
3. **Better complaint handling.** Escalation follows the officer's reporting line, roles are clearer, and the citizen and employee screens are redesigned.
4. **Notifications per workspace.** Each workspace chooses its own SMS, email and WhatsApp providers and its own message wording.
5. **Security and safe operations.** More than 30 partner security-audit findings are fixed (six remain open), and an upgrade can no longer wipe a database by accident.
6. **More languages and channels.** French and Portuguese work out of the box, citizens can speak their complaint, and WhatsApp complaints are supported end to end.

## B. Highlights at a glance

| Change | What it means | Who benefits |
| --- | --- | --- |
| Self-serve workspace onboarding | A new government signs up and sets up in five guided steps (Branding, Geography, Departments, Employees, Complaint types), then opens the complaint desk. | Administrators, partners |
| One secure sign-in | One sign-in for citizens, employees and admins, with invitations, sessions that stay alive while you work, and sign-out of other devices. | All users, security teams |
| Reliable escalation | Complaints move up the officer's reporting line on time and once per level. Admins set the timings. | Citizens, officers, admins |
| Clearer complaint roles | Only the officer holding a complaint can escalate it. A Grievance Routing Officer assigns or rejects. | Employees |
| Redesigned citizen journey | File a complaint in three steps, with voice input. "My Complaints" works as an inbox. | Citizens |
| Redesigned employee console | New top bar and sidebar, tidier inbox search and filters, better on phones. | Employees |
| Notifications per workspace | Each workspace has its own message providers, wording and delivery logs. | Administrators, operations |
| French and Portuguese | Citizen and employee screens in French and Portuguese, and the chosen language is remembered. | Citizens, employees |
| Workspace trial (optional) | Partners can put new workspaces on a 30-day trial, with reminder emails before it ends. | Partners, operators |
| Readable on every theme | Text, field borders and focus outlines meet accessibility contrast standards on all themes. | All users |
| Security audit findings fixed | 30+ audit findings fixed, including two high-severity ones; six remain open (section H). Plus hundreds of library vulnerabilities. | Everyone |
| Safer upgrades | An upgrade can no longer wipe an existing database. | Operations |

## C. New features

### 1. Self-serve workspace onboarding

A city or organisation can sign up on its own and get a working complaint system. A founder creates an account, then goes through five guided steps: Branding, Geography, Departments, Employees and Complaint types (with a resolution time per category). When setup is done, the console opens the complaint desk. Employees get invitations, and admins can see whether each invite was accepted. Self-serve workspaces created earlier pick up new defaults in the background without losing their own changes; workspaces set up by the deployment itself are not upgraded this way. Sign-up is offered in English, French, Hindi and Portuguese, and admins can sign up with their Google account. This cuts the engineering work needed to launch a new city.

### 2. One secure sign-in

Citizens, employees and administrators sign in through one secure service. A person can belong to several workspaces and pick one after signing in. Admins can invite people and resend activations; invitees can decline. Sessions end automatically when a person's credentials change, and otherwise stay alive while the person is active instead of ending 30 minutes after sign-in. Employees sign in with their email address and reset forgotten passwords by email, and "sign out other sessions" really signs out every other device. Existing staff must be linked to the new sign-in service before they can sign in (section F).

### 3. Notifications per workspace

Each workspace can have its own SMS, email and WhatsApp providers, wording and delivery logs. Six providers are supported: Twilio SMS, Twilio WhatsApp, SMTP email, SMSCountry, Ozeki and Jasmin. Admins manage this in the Configurator under Notifications: Providers, Channels, Configure, Events, Logs and User Preferences. Templates are checked when saved, and Logs show whether each message was delivered.

### 4. Citizen complaint filing with voice input

Citizens file a complaint in three steps and can speak the description instead of typing it. Voice works in English, French and Portuguese, and the screen shows which language it is listening in. "My Complaints" works as an inbox with search and paging.

### 5. French and Portuguese out of the box

Citizen and employee screens ship in French and Portuguese. The device remembers the chosen language. The onboarding pages and the Geography step are translated too, and sign-up offers English, French, Hindi and Portuguese. Swahili is no longer offered for new sign-ups; existing Kenyan workspaces keep it. The French, Hindi and Portuguese onboarding text is machine-translated and still needs a native-speaker review, and some sign-up screen text is still in English.

### 6. Complaints on WhatsApp

Citizens can file and track complaints over WhatsApp, in the workspace's own language and country code. Staff see the real complainant, not the chatbot account.

### 7. Official boundaries for Geography setup

During setup, an admin can start from a country's official administrative boundaries instead of drawing them. Each level shows how confident the match is, and licences travel with the data. Chosen boundaries stay in an editable list until the admin saves. Google Maps can be used as the map.

### 8. Escalation policy editor

Admins set when complaints escalate, for example at 80%, 120% and 200% of a complaint type's resolution time, and can override it per complaint type. The editor warns about settings that would not work and blocks saving them.

### 9. Workspace trial and reminder emails (optional)

A partner hosting many governments can put each new self-serve workspace on a 30-day trial. When a trial ends without approval, sign-in to that workspace pauses with a clear message, and an operator can approve or extend it. Workspace admins get reminder emails 14, 7, 3, 2 and 1 days before. Existing workspaces never lock.

### 10. App links for staff and citizens

The Configurator dashboard shows copyable links to the workspace's employee and citizen apps, ready to share right after setup.

### 11. Operations tools

- **Alerting (optional).** Alert rules and automatic investigation of alerts for single-server deployments.
- **AI incident diagnosis (optional).** An assistant that looks into incidents and reports findings, without making changes.
- **Per-container metrics.** CPU, memory and restarts for each part of the system.
- **Read-only automation tools.** The automation server can be shared publicly with write actions switched off.
- **Security scanning.** One scanner across the codebase, with a dashboard.

## D. Enhancements

These improve existing screens. The benefits are what each change is designed to do; no usage measurements were available.

**Employee console**

- A full-width top bar with a collapsible sidebar, including a Complaints section.
- Inbox search and filters line up, scroll correctly and work on tablets and phones.
- A tenant switcher for staff who work across tenants.
- The product is named "Complaint Management System" throughout.
- Account and security settings read as one tidy page, and changing your email returns you to your workspace.
- Password-reset pages keep the workspace's colours.

**Citizen app**

- The same look as the employee app, with a collapsible sidebar.
- Sign-up and sign-in screens share one design.
- A home-page banner the admin sets during Branding.
- "Complaint Category" and "Complaint Subcategory" are used everywhere.

**Public dashboard**

- Controls in the Configurator: status, preview, KPI list and access settings.
- KPI tiles show how fresh their data is, for example "updated 5 minutes ago".
- The Add KPI list is searchable and sorted A–Z, and the citizen app links to the dashboard.

**Configurator**

- A searchable time-zone picker, and a help panel, guided tour and short videos for each setup step.
- Translators can see the English text next to each translation.
- Required fields are marked, logo files are checked, and branding can be changed later.
- Complaint categories uploaded from a spreadsheet keep readable names in every language.
- Only administrators can open the Configurator.

**Analytics**

- Each workspace can send usage events to Matomo or PostHog, with no names, contact details or free text.
- One consistent set of event names across all three apps.
- Each partner uses its own analytics and error-tracking accounts.

**Accessibility**

- Text, field borders and focus outlines meet colour-contrast standards on every theme. Contrast failures dropped from 31 to 0 on citizen pages and from 87 to 0 on employee pages.
- Keyboard and screen-reader improvements are not part of this release.

**Quality**

- Automated tests run on every change, including a full journey from sign-up to a resolved complaint.
- The test dashboard keeps 30 runs and emails the team when something regresses.

## E. Bug fixes

About 55 fixes, grouped by area.

| Area | What was fixed |
| --- | --- |
| Escalation | Manual and automatic escalation now follow the same rule: the officer's reporting manager. A complaint type's own timings win over the default. Reopening keeps the escalation level. Escalate is hidden when there is nobody to escalate to. |
| Roles | A Grievance Routing Officer can only assign or reject. Assigning always names an employee. |
| Complaints | Assigned officers can always see their complaints. Complaints without a map pin no longer show a false location. Search never shows another tenant's complaints. A complaint filed by staff for a citizen now appears in that citizen's My Complaints. WhatsApp complaints show the real complainant. Labels, locked locations and category choices behave correctly. |
| Employees | New employees can file complaints. A failed invitation no longer creates a duplicate. Employee look-ups stay within the workspace. Adding an employee no longer fails at random with a password error. |
| Sign-in | Signing out of other sessions really ends them. Employees can use Forgot password again. The sign-in page asks for an email, unused social sign-in buttons are hidden, and a lost sign-in returns to the sign-in page. The two-step verification page footer no longer overlaps. |
| Public dashboard | A workspace's public dashboard now shows that workspace's own data, not the state's. |
| Configurator and onboarding | All boundary hierarchies are listed. Duplicate boundary codes are caught before saving. Jurisdictions and departments can be revoked. Settings save reliably, and setup progress keeps updating to the end. Older workspaces can use the new workspace screens. Branding finds the workspace in large installations. Sign-up no longer stops on a boundary timing error. Employee templates and screens are corrected. |
| Notifications | Upgrading no longer fails when a workspace already uses the same internal permission numbers. |
| Screens (both apps) | Long dropdown options, inbox cells, complaint numbers and statuses show in full. Text with a colon is no longer cut. Themes apply to the whole page, buttons keep readable labels, and screen text is translated. |
| WhatsApp | Long complaint menus work, and tenants without a complaint template can file. |
| Deployment | An upgrade can no longer wipe an existing database. Remote deployments and fresh-machine setups work again. |
| Monitoring | The status board no longer reports a false failure on hardened servers. |

## F. What changes when you upgrade

v2.20 is not a drop-in upgrade from v2.12: sign-in, web addresses and several services change. Plan a staged upgrade on a test environment first. The [deployment changelog](release-config-changelog-v2.20.md) has the settings to change and the upgrade steps.

| What changes | Who is affected | What to do |
| --- | --- | --- |
| Everyone signs in through the new sign-in service; the old login pages are gone. | All users, custom app versions | Use the new sign-in. Update any customised login screens. |
| App addresses now include the workspace name. Old bookmarks stop working unless a default workspace is set. | Users with bookmarks, external links | Update links, or ask operations to set a default workspace. |
| Existing staff can sign in only after they are linked to the new sign-in service. Staff whose home is a city tenant cannot be linked and lose sign-in unless they are re-created at the state level. | All existing employees | Ask operations to link staff during the upgrade. Plan for city-tenant staff. |
| Employees reset passwords by email; reset by SMS is removed. | Employees without an email address | Add email addresses to staff records before upgrading. |
| Citizens can no longer sign in with Google; they sign in with their phone and a one-time code. | Citizens who used Google | Tell citizens about the change. |
| The old citizen address (`/citizen`) no longer works. The citizen app is at `/<workspace>/digit-ui/citizen`. | Citizens with bookmarks, external links | Update links. |
| Swahili is no longer offered when signing up a new workspace. Existing Kenyan workspaces keep it. | New Swahili-speaking workspaces | Plan translations if needed. |
| Citizen sign-in is off until it is switched on. | Citizen-facing workspaces | Choose the citizen sign-in methods during the upgrade. |
| Automatic escalation is off after upgrading, and escalation works differently. | Workspaces upgraded from v2.12 | Review escalation settings, and ask operations to turn automatic escalation back on. It is one switch for the whole installation, not per workspace. |
| Notifications move to per-workspace settings. Existing workspaces send no complaint notifications until they are migrated. | Workspaces using notifications | Run the notification migration for each workspace. |
| Only administrators can open the Configurator. | Staff who used it without an admin role | Grant admin roles where needed. |
| Employee import templates use the employee code as the username. | Admins doing bulk imports | Use the new templates. |
| Analytics events have new names. | Teams with analytics reports | Update reports to the new names. |
| Several back-end services are replaced, and some systems that called the old ones directly stop working. | Integrators, operations | Move integrations to the new sign-in service. |

**Rollback.** No full rollback path to v2.12.1 is confirmed yet. Back up all data before upgrading.

## G. Security and reliability

**Security**

- More than 30 findings from a partner security audit are fixed, including both high-severity ones. Six remain open (see below and section H).
- Hundreds of known vulnerabilities in third-party libraries are fixed, including a critical database-driver issue.
- Sign-in is hardened: security tokens stay on the server, sessions end when credentials change, and staff cannot grant themselves admin rights.
- Each workspace's data stays within that workspace in search, look-ups and preferences. The public dashboard now does too; before this release it could show the state's data.
- Servers expose fewer network ports, run a firewall, and send stricter browser security headers.
- Six audit items are still open (section H).

**Reliability**

- An upgrade can no longer wipe an existing database by accident.
- Onboarding retries failed steps on its own.
- Escalation checks are logged one by one, so a failure is easier to find.

**Performance**

No performance measurements were available for this release.

## H. Known issues and limitations

| Area | Issue | Status |
| --- | --- | --- |
| Escalation | A Grievance Routing Officer can assign straight to a senior manager and skip the chain. | Open |
| Escalation | Complaints rejected and then reopened do not escalate automatically. | Open |
| Access | Limiting the Configurator to administrators covers the screens only; some staff data can still be read by non-admin roles through the system's interfaces. | Open |
| Sign-in | Workspace branding can disappear when a timed-out sign-in restarts. The new email sign-in wording is English only. | Open |
| Sign-in | The setup email for non-admin staff opens the Configurator instead of the employee app. | Open |
| Sign-in | Signing in as staff right after a Configurator session can fail with "already authenticated as a different user". | Open |
| Sign-in | Staff who also use the citizen app with the same phone number count as two people; joining them is optional and off by default. | Open |
| Onboarding | Setup can show a "usually temporary" boundary error and then fail on Try again, although the setup succeeded. | Open |
| Notifications | One provider per channel per workspace, with no automatic failover. | By design in this release |
| Notifications | WhatsApp messages need each workspace's own approved templates. | Register templates with the provider |
| Notifications | Twilio messages show "Sent" even after delivery. The new notification screens are English only. | Open |
| Notifications | Citizen sign-in by phone does not use the new notification service yet. | Needs a separate SMS sender |
| Monitoring | Sign-in service metrics may not be collected, depending on the deployment settings. | Open |
| Security | Six audit items remain open, including a seeded default password and anonymous file downloads. | Open |

## I. Impact and action required

| Audience | What changes for them | Action |
| --- | --- | --- |
| Citizens and employees | New sign-in, workspace-specific links, a three-step complaint form with voice input, a new employee console. Employees reset passwords by email. Citizens sign in with phone and code. | Update bookmarks. Make sure every employee has an email address. |
| Government administrators | Self-serve onboarding, the escalation policy editor, notification settings, branding, public dashboard controls, app links. Automatic escalation is off after upgrading. | Review escalation settings. Set up notification providers and messages. Use the new employee templates. |
| Partners | Many governments on one installation, each set up without eGov support, with an optional 30-day trial. | Decide on trial use and analytics accounts per deployment. |
| Developers and integrators | Sign-in goes through the new sign-in service; old user endpoints are closed. New onboarding and notification services. | Follow the [deployment changelog](release-config-changelog-v2.20.md). Update custom login code. |
| QA teams | Wide changes to screens and workflows. | Regression-test sign-in for every role, onboarding end to end, the complaint lifecycle including escalation and reopen, notifications per channel, French and Portuguese, phone layouts, and WhatsApp if used. |
| Operations teams | New and retired services, new settings and secrets, data migrations, linking existing staff to the new sign-in. | Follow the upgrade steps in the [deployment changelog](release-config-changelog-v2.20.md). Back up all databases first. |
