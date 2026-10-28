# Known Issues & Limitations — DIGIT CMS v2.20

The limitations below are known and tracked for this release. Each is logged individually in the project issue tracker — check there for current status before starting an implementation.

---

## Complaint Escalation

Automatic escalation is **off after the upgrade** and is one switch for the whole deployment (`PGR_ESCALATION_ENABLED`), not per tenant. See the [deployment changelog](release-config-changelog-v2.20.md), section 2.

| Issue | Symptom | Workaround |
|-------|---------|-----------|
| [#2222](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2222) | A Grievance Routing Officer can assign a complaint straight to a senior manager and skip the escalation chain. | Instruct GROs to assign to the last-mile resolver; fix pending. |
| [#2195](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2195) | Complaints that were rejected and then reopened do not escalate automatically. How the escalation level resets on reopen is not yet defined. | Escalate reopened complaints manually. |
| [#2142](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2142) | Escalation details stored on the complaint are lost after the first escalation, so the complaint's escalation history can be incomplete. | Use the workflow history, which records every escalation. |
| [#2620](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2620) | A percentage-only override on a complaint type that has no resolution time (`slaHours`) silently uses the default ladder. | Set `slaHours` on the complaint type, or give the override fixed timings. |
| [#2625](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2625) | The escalation policy editor does not flag some overrides the server ignores (empty or non-list timings, very large numbers). | Check overrides against the default ladder after saving. |
| [#2130](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2130) | Per-complaint-type overrides use a different key name than the default policy, which is easy to get wrong outside the editor. | Edit overrides in the Configurator's escalation policy editor. Fix in review. |
| [#2215](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2215) | Escalation timings count weekends and public holidays. | Size the timings to allow for non-working days. |

---

## Complaint Workflow

| Issue | Symptom | Workaround / status |
|-------|---------|-----------|
| [#1967](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1967) | A last-mile resolver cannot mark a complaint resolved (`INVALID_ASSIGNEE`). | Fix merged (#2405, #2406), awaiting QA. |
| [#1968](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1968) | When a GRO assigns a complaint, the assignee list shows GROs as well as last-mile resolvers. | Pick a last-mile resolver; waiting on the role-hierarchy work. |

---

## Employee App & Sign-in

| Issue | Symptom | Workaround / status |
|-------|---------|-----------|
| [#2700](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2700) | Forgot Password on the employee sign-in page does not work. | Fix merged (#2701) and deployed for QA; awaiting sign-off. |
| [#99](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/99) | The Privacy Policy link on the employee sign-in page does nothing; no policy text is shown. | None yet. |
| [#1970](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1970) | Employee names and mobile numbers in the complaint timeline are shown to all users instead of being masked. | None yet. Treat as an information-disclosure risk. |
| [#1984](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1984) | Complaint search filters list every jurisdiction and department, not only the ones assigned to the user. | Results are still scoped correctly; only the filter options are not. |

---

## Configurator

| Issue | Symptom | Workaround / status |
|-------|---------|-----------|
| [#2729](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2729) | When adding an employee in the management console, the mobile number skips the country format set at onboarding. | Enter numbers in the onboarding format. |
| [#1150](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1150) | Advanced › Role Actions has no Create or Edit buttons. | Fix merged on develop (#1856), awaiting QA; not on master yet. |

---

## Dashboards

| Issue | Symptom | Workaround / status |
|-------|---------|-----------|
| [#1983](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1983) | Some KPIs (Employees with Most Open Complaints, Employee Performance, Complaints at Risk) are missing for admin and GRO users, and the SLA non-compliance rate does not match the counts shown. | None yet. |
| [#1977](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1977) | Dashboards exported to Excel show raw numbers instead of percentages, and one pie chart has overlapping labels. | Planned for 2.21. |
| [#1755](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1755) | The Add KPI list is not searchable or sorted. | Updated list deployed for QA; awaiting sign-off. |

---

## Notifications

| Issue | Symptom | Workaround / status |
|-------|---------|-----------|
| [#1975](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1975) | When the Twilio token expires, SMS and WhatsApp messages stop. | Failed sends now appear in Configurator › Notifications › Logs. Watch the provider console for token expiry. |

---

## WhatsApp Chatbot

| Issue | Symptom | Workaround / status |
|-------|---------|-----------|
| [#2726](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2726) | A citizen cannot change the language or name chosen at the start of a WhatsApp conversation. | None yet. |

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [release-notes-v2.20.md](release-notes-v2.20.md) | Feature-level release notes |
| [release-config-changelog-v2.20.md](release-config-changelog-v2.20.md) | Deployment changelog: settings, services and upgrade steps |
| [migration-guide-v2.12-to-v2.20-beta.md](migration-guide-v2.12-to-v2.20-beta.md) | Operator upgrade procedure (v2.12 → v2.20) |
| [migration-guide-v2.12-to-v2.12.1.md](../2.12/migration-guide-v2.12-to-v2.12.1.md) | Escalation migration (step 6a) for servers still on v2.12 |

---

**Last Updated:** v2.20 (2026-10-28)  
**Status:** Active — refer to issue tracker for real-time updates
