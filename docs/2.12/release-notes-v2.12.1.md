# CMS v2.12.1 Release Notes (patch)

**Upgrades from:** v2.12 · **Source:** branch `2.12.1` @ `7a3866111` (2026-10-07)
**Focus:** complaint escalation fixes and security fixes for Ansible-deployed servers.

> **Upgrading?** Follow the [migration guide](migration-guide-v2.12-to-v2.12.1.md).

## At a glance

| Area | What changed | Who notices |
|---|---|---|
| **Escalation** | Complaints move up to the officer's manager reliably, on time, and once per level. Admins edit the timings in DIGIT Studio. | Citizens, officers, admins |
| **Roles** | Only the officer holding a complaint sees **Escalate**. A GRO can only assign (naming an officer) or reject. | Employees |
| **Security** | 30+ findings from a partner security audit closed, including two high-severity ones. Hundreds of library vulnerabilities fixed. | Everyone (no visible change) |
| **Safe deploys** | A redeploy can no longer wipe an existing database. Remote deploys work again. | DevOps |

---

## 1. Escalation fixes

- **One rule for manual and automatic escalation:** the complaint goes to the HRMS reporting manager (`reportingTo`) of the officer currently holding it. Automatic escalation runs at time limits based on the complaint type's SLA, for example 80%, 120% and 200% (#2049).
- **Escalate button:** shown only to the current holder, and only if that officer has a reporting manager (#2138, #2148, #2177).
- **GRO only routes:** a GRO can assign and reject, but no longer escalate, resolve or reassign (#2096, #2146, #2147). Assigning without naming an officer is rejected (#2137, #2149).
- **Per-type timings win** over the global default (#2196). Reopening no longer resets the escalation level (#2233).
- **DIGIT Studio** has an editor for the escalation policy (#2090).

**Known limitations:** a GRO can assign straight to a higher-level manager and skip the chain ([#2222](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2222)). Rejected-then-reopened complaints do not escalate automatically ([#2195](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2195)).

**Setup and configuration:**
- [Escalation setup and configuration](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/master/docs/escalation.md)
- [Escalation rollout: preflight, workflow migration and validation](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/master/docs/migration/pgr-escalation-self-loop.md)

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
