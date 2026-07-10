# Contributing to DIGIT Complaints

This guide explains how to file bugs, request features, and propose enhancements so the team can triage and prioritize effectively.

## Before You File

1. **Search existing issues** to avoid duplicates: [open issues](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues)
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
- `Maputo: Localization issue` (don't prefix with deployment name)
- `Fix the thing` (not descriptive)

**Do NOT prefix titles with deployment or environment names** (Maputo, Nai Pepea, Local Setup, etc.). Use the **Source** project field instead (see below).

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

**Not sure which feature?** Ask yourself: *"What business capability does this affect?"* Technology choices (Keycloak, Kafka, PostgreSQL) are never the feature — the capability they serve is.

**Maintenance bugs** that don't relate to any roadmap feature (e.g., a generic profile page crash) can skip the feature label. These are tracked by `bug` + `area:*` + Priority + Milestone.

### 2. Area Label

Where in the stack is the issue?

| Label | Scope |
|-------|-------|
| `area:frontend` | React UI, digit-ui, configurator, CSS, browser behavior |
| `area:backend` | Java services, MCP, MDMS, egov-user, workflow, APIs |
| `area:devops` | Ansible, Docker Compose, CI/CD, Nginx, monitoring, secrets |

## Source Field (Project Board)

If the issue was discovered during a specific deployment or environment, set the **Source** field on the [project board](https://github.com/orgs/egovernments/projects/22):

| Source | When to use |
|--------|-------------|
| Maputo | Found during Maputo deployment |
| Nai Pepea | Found during Nai Pepea deployment |
| Sandbox | Found in sandbox environment |
| Local Setup | Found during local development |
| Unified Dev | Found in unified dev environment |

This replaces the old convention of prefixing titles with deployment names.

## Priority

Set priority when filing if you can. If unsure, leave it for triage.

| Priority | Meaning |
|----------|---------|
| P0 | System down, data loss, blocking go-live |
| P1 | Major functionality broken, no workaround |
| P2 | Broken but has workaround, or cosmetic issue affecting usability |
| P3 | Minor, nice-to-have, or only affects edge cases |

## Milestone

Assign a milestone if you know which release it targets:

- **Release 2.11** — Portable demo baseline
- **Release 2.12 (Nosy Build)** — Due June 20, 2026
- **Release 2.20 (SaaSSy Phase 1)** — Due July 31, 2026
- **Release 2.30 (SaaSSy Phase 2)** — Due September 30, 2026

If unsure, leave it blank. The team assigns milestones during sprint planning.

## Bug Reports

Use the **Bug report** template. A good bug report includes:

1. **What happened** — Clear description of the broken behavior
2. **Steps to reproduce** — Numbered steps someone else can follow
3. **Expected behavior** — What should have happened
4. **Environment** — Which deployment, browser, tenant
5. **Screenshots/logs** — Attach if possible

**The single most important thing:** Can someone else reproduce it from your description? If not, add more detail.

## Enhancements

Use the **Enhancement** template. Describe:

1. **What exists today** — Current behavior
2. **What you want changed** — Proposed improvement
3. **Why it matters** — Who benefits and how

## Features (Maintainers Only)

Feature issues represent long-lived roadmap workstreams. They use the **Feature request** template and are created only by project maintainers. If you think a new feature is needed, open a discussion or enhancement first.

## What NOT to Do

- Don't file issues with just a title and no body
- Don't prefix titles with environment names (use Source field)
- Don't create a Feature issue for a technology choice (Keycloak is not a feature; "Configuration & Customization" is)
- Don't skip the area label — it's how we route bugs to the right people
- Don't file multiple bugs in one issue — one issue per bug
- Don't reopen closed issues for new problems — file a new issue and reference the old one

## Quick Reference

```
Title:     [Bug] Clear, specific description
Labels:    bug, feature:lifecycle-routing, area:frontend
Priority:  P1
Milestone: Release 2.12 (Nosy Build)
Source:    Nai Pepea (set on project board)
```
