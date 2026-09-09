# Contributing to CMS Mozambique

This guide explains how to file bugs, request features, and propose enhancements so the team can triage and prioritize effectively.

## Before You File

1. **Search existing issues** to avoid duplicates: [open issues](https://github.com/eGov-Global/CMS-MOZAMBIQUE/issues)
2. If you found a duplicate, add a comment with your context instead of opening a new one

## Issue Types

Use the correct template when creating an issue. Each template sets the right labels and title prefix automatically.

| Type | Title prefix | When to use |
|------|-------------|-------------|
| Bug | `[Bug]` | Something is broken or behaves incorrectly |
| Enhancement | `[Enhancement]` | Improvement to an existing capability |
| Feature | `[Feature]` | **Maintainers only.** New long-lived roadmap workstream |
| Story | `[Story]` | User-facing capability described from the user's perspective |

## Title Conventions

Titles should be clear, specific, and scannable.

**Format:** `[Type] Short description of the issue`

**Good:**
- `[Bug] Employee inbox sort options not working`
- `[Enhancement] Add hierarchy level label localizations`
- `[Bug] Localization cache not busted after writes`

**Bad:**
- `bug in UI` (too vague)
- `PROD: Localization issue` (don't prefix with environment name)
- `Fix the thing` (not descriptive)

**Do NOT prefix titles with environment names** (PROD, UAT, etc.). Use the **Source** project field instead (see below).

## Required Labels

Every issue needs **two labels** at minimum:

### 1. Feature Label

Which roadmap feature does this relate to? Pick one:

| Label | Area |
|-------|------|
| `feature:internationalization` | Localization, languages, i18n, country-specific formatting |
| `feature:omnichannel` | WhatsApp, chatbot, SMS, notifications |
| `feature:lifecycle-routing` | Complaint workflow, escalation, assignment, inbox |
| `feature:decision-support` | Dashboards, analytics, reports |
| `feature:privacy-consent` | Anonymous complaints, sensitive complaints, consent |
| `feature:deployment-installation` | Ansible, Docker, bootstrap, CI/CD, infrastructure |
| `feature:configuration-onboarding` | Configurator UI, employee management, tenant config, HRMS |
| `feature:saas-enablement` | Multi-tenancy, data portability, SaaS operations |
| `feature:platform-modernization` | UI framework, build tooling, service architecture |
| `feature:knowledge-ecosystem` | Documentation, guides, training materials |

**Not sure which feature?** Ask yourself: *"What business capability does this affect?"* Technology choices (Keycloak, Kafka, PostgreSQL) are never the feature - the capability they serve is.

**Maintenance bugs** that don't relate to any roadmap feature (e.g., a generic profile page crash) can skip the feature label. These are tracked by `bug` + `area:*` + Priority.

### 2. Area Label

Where in the stack is the issue?

| Label | Scope |
|-------|-------|
| `area:frontend` | React UI, digit-ui, configurator, CSS, browser behavior |
| `area:backend` | Java services, MCP, MDMS, egov-user, workflow, APIs |
| `area:devops` | Ansible, Docker Compose, CI/CD, Nginx, monitoring, secrets |

## Source Field (Project Board)

If the issue was discovered in a specific environment, set the **Source** field on the [project board](https://github.com/orgs/eGov-Global/projects/16):

| Source | When to use |
|--------|-------------|
| PROD | Found in production |
| UAT | Found during UAT |

This replaces the old convention of prefixing titles with environment names.

## Priority

Set priority when filing if you can. If unsure, leave it for triage.

| Priority | Meaning |
|----------|---------|
| P0 | System down, data loss, blocking go-live |
| P1 | Major functionality broken, no workaround |
| P2 | Broken but has workaround, or cosmetic issue affecting usability |
| P3 | Minor, nice-to-have, or only affects edge cases |

## Milestone

Release milestones are not yet defined for CMS Mozambique. Leave the milestone blank; the team will assign one during sprint planning once the release plan is set.

## Bug Reports

Use the **Bug report** template. A good bug report includes:

1. **What happened** - Clear description of the broken behavior
2. **Steps to reproduce** - Numbered steps someone else can follow
3. **Expected behavior** - What should have happened
4. **Environment** - PROD or UAT, browser, tenant
5. **Screenshots/logs** - Attach if possible

**The single most important thing:** Can someone else reproduce it from your description? If not, add more detail.
