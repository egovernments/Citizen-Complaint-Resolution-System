# Known Issues & Limitations — DIGIT CMS v2.12

The limitations below are known and tracked for this release. Each is logged individually in the project issue tracker — check there for current status before starting an implementation.

---

## Platform Support

**Supported Operating Systems:**
- ✅ **Ubuntu** (Ansible-based setup)
- ✅ **macOS** (Ansible-based setup)
- 🟠 **Windows** WSL2 support functional as notified by partners(see [Windows quickstart guide](../../WINDOWS-QUICKSTART.md))
- ❌ Windows (native)
- ❌ Red Hat

---

## Complaint Category Migration

The earlier two-level complaint-category master has been replaced by the new multi-level complaint hierarchy. A validated [migration tool](../migration/servicedefs-to-complainthierarchy-migration.md) is available.

### Things to Watch

| Issue | Impact | Solution |
|-------|--------|----------|
| Complaints with unmigrated categories | Still open and display correctly, but **fail to send notifications** on their next workflow action (assignment, resolution, or escalation). | Run category migration before enabling notifications. |
| Multi-city shared category codes | Dashboard tiles may misattribute a category to the wrong city's department. | See migration documentation for diagnostic query. |

---

## Jurisdiction & Department Access Control

This is a **new capability**. We recommend verifying it against your own role setup before enabling it in production — particularly if your city relies on tenant-wide admin or supervisor roles seeing unrestricted data.

### Known Issues

| Issue | Symptom | Workaround |
|-------|---------|-----------|
| Tenant-wide roles lose dashboard access | Admin/supervisor roles see empty dashboard instead of unrestricted view. | Verify role scoping configuration in MDMS before production rollout. |
| DGRO permission gap | Department Grievance Routing Officer (DGRO) receives Dashboard link but not permission to use it; requests are denied. | Grant DGRO the same analytics permission as other roles. |
| Filter dropdown scope mismatch | Complaint search and inbox filter dropdowns show **every** jurisdiction/department in the city, even though actual results are scoped. | Results **are** correctly scoped; UI dropdowns show all options for filtering. |
| No removal mechanism | A jurisdiction/department granted via Configurator cannot be removed. | Requires manual MDMS edit or re-provisioning. |
| Personal info masking incomplete | Employee complaint timeline does not mask sensitive data, even where visibility settings suggest it should. | Treat as information disclosure risk; plan masking implementation. |

**See also:** [Jurisdiction-Access-Control Guide](jurisdiction-access-control.md)

---



## Complaint Workflow

| Issue | Symptom | Workaround |
|-------|---------|-----------|
| Post-escalation assignment | After a complaint escalates automatically, completing the workflow from the escalated assignee's side does not always work correctly. | Manually re-assign if workflow appears stuck. |
| Resolution blocking (caching) | Last-mile resolvers can occasionally be unable to mark a complaint resolved. | Clear application cache; this is a caching issue, not a workflow defect. |

---

## Notifications

### Critical Issues

| Issue | Symptom | Mitigation |
|-------|---------|-----------|
| **Token expiration ** | If the notification provider's access token expires, SMS and WhatsApp messages **stop sending with no error in the Configurator**. | Monitor provider console proactively; set up alerts for token expiration. |
| **Missing employee assignment notifications** | Employees are not yet notified when a complaint is assigned to them (SMS, WhatsApp, Email, in-app). | Implement custom notification workflow or workaround. |
| **Template & config sync issues** | Partners have reported that some template synchronization and notification-configuration actions do not behave as expected. | Verify configs manually in MDMS; restart notification service if needed. |
| **Documentation gap** | Setup documentation for implementation teams is evolving and will be published in the next release. | Track [documentation roadmap](https://docs.digit.org/complaints-management); reach out to support. |

---

## Two-Way WhatsApp Engagement

- **Status:** Available as a **multi-city sandbox pilot** only
- **Production Use:** Assess the code before pulling this feature into production.
- **Timeline:** Will be marked as generally available (GA) in a future release

---

## Other Areas in Progress

The following remain open for this release and are candidates for future patch or minor releases:

- Observability and security enhancements are expected in the following path release.


---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [Complaints Management Roadmap](https://docs.digit.org/complaints-management/community/roadmap) | Product roadmap and future features |
| [Full Engineering Changelog](#full-engineering-changelog-keep-a-changelog) | Complete Added / Changed / Fixed / Deprecated / Removed / Security log |
| [release-config-changelog-v2.12.md](release-config-changelog-v2.12.md) | Configuration and infrastructure changelog |
| [migration-guide-v2.11-to-v2.12.md](migration-guide-v2.11-to-v2.12.md) | Operator upgrade procedure (v2.11 → v2.12) |
| [servicedefs-to-complainthierarchy-migration.md](../migration/servicedefs-to-complainthierarchy-migration.md) | Complaint-category migration procedure |
| [jurisdiction-access-control.md](jurisdiction-access-control.md) | Jurisdiction & department access control — detailed guide |
| [WINDOWS-QUICKSTART.md](../../WINDOWS-QUICKSTART.md) | Windows setup via WSL2 |
| [ONBOARDING-AND-ADDONS.md](../../local-setup/docs/ONBOARDING-AND-ADDONS.md) | City onboarding & add-ons catalogue |
| [complaint-hierarchy-feature.md](../complaint-hierarchy-feature.md) | Multi-level complaint categories — design doc |
| [dashboard-configuration.md](dashboard/dashboard-configuration.md) | Supervisor Dashboard configuration reference |
| [notifications/](notifications/README.md) | Notifications setup guide (SMS, WhatsApp, email) |
| [observability/](../observability/enabling-monitoring.md) | Monitoring stack & dashboard telemetry |
| [01-openbao.md](../../local-setup/ansible/runbooks/01-openbao.md) | Secrets store operations runbook |

---

**Last Updated:** v2.12 (2026-08-03)  
**Status:** Active — refer to issue tracker for real-time updates
