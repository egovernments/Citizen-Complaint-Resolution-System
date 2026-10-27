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

## Other Areas

Known issues for other areas will be added before release. Until then, see section H of the [release notes](release-notes-v2.20.md) and section 7 of the [deployment changelog](release-config-changelog-v2.20.md).

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [release-notes-v2.20.md](release-notes-v2.20.md) | Feature-level release notes |
| [release-config-changelog-v2.20.md](release-config-changelog-v2.20.md) | Deployment changelog: settings, services and upgrade steps |
| [migration-guide-v2.12-to-v2.20-beta.md](migration-guide-v2.12-to-v2.20-beta.md) | Operator upgrade procedure (v2.12 → v2.20) |
| [migration-guide-v2.12-to-v2.12.1.md](../2.12/migration-guide-v2.12-to-v2.12.1.md) | Escalation migration (step 6a) for servers still on v2.12 |

---

**Last Updated:** v2.20 (2026-10-27)  
**Status:** Active — refer to issue tracker for real-time updates
