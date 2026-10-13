# CMS v2.12.1 Release Notes (patch)

**Upgrades from:** v2.12
**Focus:** complaint escalation fixes, and security fixes for Ansible-deployed servers.

> **Upgrading?** Follow the [migration guide](migration-guide-v2.12-to-v2.12.1.md).

## At a glance

| Area | What changed | Who notices |
|---|---|---|
| **Escalation** | Complaints move up to the officer's reporting line reliably, on time, and once per level. An administrator can edit the duration after which auto-escalation occurs in Configurator. Automatic escalation is **off** by default after the upgrade (it was on in v2.12) unless a tenant overlay turns it on. | Citizens, officers, admins |
| **Roles** | Only the officer holding a complaint sees an option to **Escalate** a complaint. A GRO can only assign (naming an officer) or reject. | Employees |
| **Security** | 30+ findings from a partner security audit closed, including two high-severity ones. Hundreds of library vulnerabilities fixed. | Everyone (no visible change) |
| **Safe deploys** | A redeploy can no longer wipe an existing database. Remote deploys work again. | DevOps |

> On servers upgraded from v2.12, the Escalation and Roles changes take effect only after the escalation migration ([migration guide, step 6a](migration-guide-v2.12-to-v2.12.1.md#6a-migrate-escalation-required-on-every-upgraded-tenant)).

---

## 1. Escalation fixes

- **Standardised manual and automatic escalation:** the complaint goes to the reporting manager (`reportingTo`) of the officer currently holding it. Automatic escalation runs at time limits based on the complaint type's SLA, for example 80%, 120% and 200% of an SLA (#2049).
- **Escalate button:** shown only to the current assignee of a complaint (The government employee/officer who holds this complaint), and only if that officer has a reporting manager (#2138, #2148, #2177).
- **GRO only routes:** a Grievance Routing officer (GRO) can assign and reject, but no longer escalate, resolve or reassign a complaint (#2096, #2146, #2147). Assigning without naming an officer is rejected (#2137, #2149).
- **Per-complaint type timings takes precedence** over the global default (#2196). Reopening no longer resets the escalation level (#2233).
- **Configurator** has an editor for the escalation policy (#2090).

**Known limitations:** a GRO can assign straight to a higher-level manager and skip the chain ([#2222](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2222)). Rejected-then-reopened complaints do not escalate automatically ([#2195](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2195)).

**Setup and configuration:**
- [Escalation setup and configuration](../escalation.md)
- [Escalation rollout: preflight, workflow migration and validation](../migration/pgr-escalation-self-loop.md)

---

## 2. Security fixes

### Partner security audit (#2023)

| Category | Findings closed |
|---|---|
| **High severity** | Kong enforced auth only on POST (#5). MCP admin API had no login (#2). |
| **Network** | Backend, observability and datastore ports bound to `127.0.0.1` (#9, #10, #12). Kong Admin not published (#6). Host firewall (`ufw`) added (#16). |
| **Secrets** | Committed secrets, an RSA deploy key and Google Maps keys removed (#11, #27). MinIO credentials no longer hard-coded (#15). |
| **Authentication** | Anonymous `/user/_search` blocked (#23). Status board requires login (#26). Keycloak tightened (#20). Elasticsearch security on (#25). HRMS dev mode off (#32). |
| **Hardening** | Containers drop all capabilities and run with `no-new-privileges` (#29, #30). Images pinned (#17). Security headers added and CORS wildcard removed (#33, #7). |

### Deployment safety

- **No accidental database wipe (#2101):** a deploy with `db_fast_path` now stops unless `db_fast_path_ack_data_wipe: true` is set. See [postgres-volume-migration.md](operations/postgres-volume-migration.md).
- **Remote deploys fixed (#2115):** the `synchronize` tasks no longer fail with "Could not find the shell plugin".

### Dependency fixes

pgr-services: PostgreSQL driver upgraded for a critical SQL injection (CVE-2024-1597), and input validation works again (#2056). Frontend, digit-ui and digit-mcp library vulnerabilities fixed (#2055, #2058, #2053). New `MCP_READ_ONLY` mode (#2031).

### Not fixed in this patch

Seeded password `eGov@123` (#1) · fixed OTP `123456` (#4) · anonymous MinIO downloads (#13) · encryption salt and first-deploy defaults (#14, #22) · OpenBao TLS and unseal (#24) · root SSH user (#34).

---

## 3. Other improvements

- **Citizen UI:** new complaint filing flow, "My Complaints" inbox and updated copy.
- **Employee UI:** sidebar, inbox search and filter fixes, tenant switcher, renamed to "Complaint Management System".
- **Infra:** EKS terraform sample defaults to 4 worker nodes (#2060).

---

## 4. Service builds

Images changed in v2.12.1. These are the defaults in both the Docker Compose files and the Helm charts. All other images keep their v2.12 tags.

| Service | Image |
|---|---|
| pgr-services | `egovio/pgr-services:2.12.1-7a38661` |
| pgr-services-db | `egovio/pgr-services-db:2.12.1-7a38661` |
| digit-mcp | `egovio/digit-mcp:2.12.1-7a38661` |
| digit-ui | `egovio/digit-ui-esbuild:2.12.1-7a38661` |
| configurator | `egovio/configurator:2.12.1-6e8adb3` |
