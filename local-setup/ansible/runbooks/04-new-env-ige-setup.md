# Runbook 04 — Bringing up a NEW IGE (Mozambique) environment

End-to-end, operator-run procedure for deploying a fresh CCRS/DIGIT server
"like cms-pilot" and onboarding IGE from the XLSX workbook set. Every step
below was validated on cms-pilot; each ⚠ marks a mistake that actually
happened there so you don't repeat it.

Companion template: `inventory/host_vars/ige-prod.yml.example`.

---

## Phase 0 — Prerequisites

| Item | Requirement |
|---|---|
| Server | Ubuntu 20.04+, ≥16 GB RAM (Novu adds ~1 GB), ≥100 GB disk |
| Software | docker + compose plugin, git, python3 |
| DNS | the FQDN already resolving to the box |
| Data | the 4-workbook onboarding set, **verified** (see Phase 4 checklist) |

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System && git checkout release-v2.12-moz
```

---

## Phase 1 — Create the host_vars yml (step by step)

1. **Copy the template:**
   ```bash
   cd local-setup/ansible
   cp inventory/host_vars/ige-prod.yml.example inventory/host_vars/<tenant>.yml
   ```
   `<tenant>` is your handle for this box (e.g. `ige-prod`); the filename
   becomes the `./deploy.sh` argument. Real host_vars files are gitignored.

2. **Target box block:** set `domain` to the FQDN, keep
   `ansible_host: localhost` + `ansible_connection: local` if you run
   ansible on the server itself (recommended), `tls_enabled: true`.

3. **Tenancy block:** leave the `mz` pins as-is. Add the city tenant the
   wizard will create (`mz.ige`) to `login_tenant_allowlist`, or the login
   screen's institution dropdown will not offer it.

4. **Locale block:** keep `locale_default: "pt"` / `locale_region: "PT"`.
   ⚠ cms-pilot omitted these and every fresh session booted in English
   until a manual toggle (CCSD-2162).

5. **Boundary taxonomy:** the three level strings must EXACTLY match the
   `boundaryType` values in your Boundary xlsx — including accents or the
   lack of them. ⚠ The IGE workbook uses *unaccented* `Provincia /
   Distrito / Municipio`; the older kit files used accented values. Pick
   one convention and align both sides before the wizard runs.

6. **Mobile + postal:** keep `+258` / `^8[0-9]{8}$` (without the backend
   keys, egov-user falls back to +91 and stamps it on citizens) and the
   4-digit MZ postal pattern. ⚠ The bomet kit shipped Kenya's 5-digit
   postal pattern — do not copy it.

7. **Notifications block:** keep `enable_novu: true` AND
   `pgr_notification_config_driven: true` (the default is false = legacy
   path, no config-driven email at all). ⚠ Replace the FOUR `NOVU_*_URL`
   values with THIS server's domain — the kit example carried cms-pilot's
   URLs baked in; copying them points your Novu at another environment.
   Leave `novu_api_key` empty for the first deploy.

8. **Image pins:** keep a `pgr_services_image` pin on a
   `release-v2.12-moz-*` tag (update to the newest). ⚠ Without a pin, any
   redeploy rolls the backend back to the stock image and complaint
   creation starts failing hierarchy validation.
   `digit_ui_esbuild_branch: release-v2.12-moz` (⚠ kit pointed at a stale
   feature branch on a personal fork).

9. **First-boot switches:** `db_fast_path: true` +
   `db_fast_path_ack_data_wipe: true` for the FIRST deploy only. ⚠ Flip
   `db_fast_path` to `false` immediately after — it recreates the postgres
   volume and WIPES data; the preflight will (correctly) block you later.

10. **OTP:** `enable_otp_services: false` keeps the mock with fixed OTP
    `123456` — fine for staging/QA, wrong for citizen-facing production.
    Decide before go-live.

11. **Secrets:** replace every `CHANGE_ME`. Keep
    `elasticsearch_master_password` at its documented literal while
    `db_fast_path: true`. Never commit the filled file.

---

## Phase 2 — Deploy

```bash
cd local-setup/ansible
./deploy.sh <tenant>                 # SKIP_LINT=1 ./deploy.sh <tenant> if yamllint blocks on cosmetics
# second terminal — live progress:
tail -f /opt/digit/digit-stack-up.<tenant>.progress
```

- The preflight gate refuses configurations that have destroyed data
  before. Read its message; do not reach for `SKIP_PREFLIGHT=1`.
- First bring-up ≈ 10–40 min (image pulls + builds).
- Success check: `https://<domain>/digit-ui/` serves the login page,
  `https://<domain>/configurator/` serves the Studio,
  `docker ps` shows the stack healthy.
- ⚠ After success, edit the yml: `db_fast_path: false`.

---

## Phase 3 — Novu bootstrap (two deploys by design)

1. Open `https://<domain>/novu/`, sign up (first user = org owner), copy
   the API key.
2. Paste into host_vars: `novu_api_key` (+ `twilio_*` if WhatsApp).
3. `./deploy.sh <tenant>` again — the bootstrap creates integrations and
   seeds TemplateBinding records.
4. In the Novu dashboard add the **email (SMTP) integration** — the sender
   identity (cms-pilot uses a Gmail sender). Without it EMAIL rows log as
   sent to Novu but nothing is delivered.

---

## Phase 4 — Onboard IGE from the XLSX set

**Verify the workbooks first** (lessons from verifying the IGE set):

- [ ] Boundary: single root, every `parentCode` resolves, `boundaryType`
      values match the host_vars taxonomy strings exactly.
- [ ] Departments/Designations: no duplicate codes; designation
      `department` comma-lists only reference existing departments.
- [ ] ComplaintType: `department` column — decide explicitly: filled = the
      type auto-routes; empty = the screening officer routes manually
      (IGE'a single-authority convention). Don't leave it empty by
      accident. `slaHours` filled on every row.
- [ ] Employees: unique `employeeCode`/`userName`; mobiles match
      `^8[0-9]{8}$`; departments/designations/jurisdictions all exist;
      ⚠ **fill `emailId`** at least for supervisors/case managers/screening
      — the notification matrix silently skips employees without email.
- [ ] Tenant Info + Branding workbook present (tenant name, logo, city
      module) — the wizard needs it as file 1 of 4.
- [ ] GeoJSON feature `code` properties match Boundary xlsx codes.

**Run the wizard:** Studio (`https://<domain>/configurator/`, Onboarding
mode, ADMIN + the deploy's admin password) → city setup wizard → feed the
workbooks in order: Tenant/Branding → Boundary → Common+Complaint Masters
→ Employees. Import the geojson for map shapes.

- ⚠ If the boundary tree renders empty afterwards, it is the known
  childless-leaf fix: re-fetch with `includeChildren=true`
  (see `fix_boundary_paths`).
- Wizard-created employees get the `egov_hrms_default_password` — plan a
  rotation.

---

## Phase 5 — Post-onboard configuration (every item bit cms-pilot)

1. **Notification matrix** — the DDH seed only carries a partial rule set.
   Seed the full matrix (14 `RAINMAKER-PGR.NotificationRouting` rules + 11
   `RAINMAKER-PGR.NotificationTemplate` rows): complete list, authoring
   gotchas and a new-env guide live on **CCSD-2169**. Key gotchas:
   - `toState` = the applicationStatus (`AWAITINGINFORMATION`), not the
     state name (`INFOFROMCITIZEN`);
   - REJECT has two flavours (`REJECTED` and `CLOSEDAFTERREJECTION`) —
     both need rows;
   - every routing row needs a matching template
     (`audience.action.toState.channel.locale`) or the send is a SILENT
     skip; template locale key = `pgr.notification.default.locale`
     (en_IN) even for Portuguese content;
   - use `assigneeOnly: true` for assignment-type events or every role
     holder in the tenant is mailed.
2. **Filestore formats** — verify each advertised extension uploads. ⚠ The
   docx map entry must carry BOTH MIMEs:
   `docx:{'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-tika-ooxml'}`
   (cms-pilot had only the tika alias → every real browser DOCX upload
   400'd). Changing filestore env requires
   `docker compose ... up -d --force-recreate egov-filestore` — a plain
   restart does not reload env.
3. **StateInfo.languages** — add `pt_PT` so the language dropdown shows
   Portuguese as selected.
4. **Localization cache** — after ANY loc seeding/upsert:
   `POST /localization/messages/cache-bust` (or
   `docker exec digit-redis redis-cli DEL computedMessages messages`),
   and hard-refresh the browser (client caches loc ~24 h).
5. **Kong `/user` route** — verify citizen profile/user-preference
   endpoints respond (a missing route silently broke profile saves on
   pilot).

---

## Phase 6 — Smoke test (≈30 min)

1. Fresh incognito → `https://<domain>/digit-ui/citizen` boots in
   **Portuguese** without toggling.
2. Citizen registers with a +258 number → OTP arrives WITH country code.
3. File a complaint; upload one of each: JPG, PDF, **DOCX**, MP4.
4. Full workflow round: screening → supervisor → case manager → resolve →
   citizen reopen → rate.
   - Reopen must land on the **Supervisor** from history;
   - Send-back (Reassign) must land on the **Screening Officer**;
   - Rating must succeed (the FE retries without assignee while the
     backend terminal-RATE gap is open).
5. Studio → **Notification Logs**: one SENT row per transition, each to
   exactly the intended recipient; verify one real inbox.
6. Employee sidebar, dashboard card (needs a role from
   `dss.DashboardConfig` allowedRoles), map shapes, complaint timeline.

Reference runs for comparison: complaints P-2026-000110/111 on cms-pilot
(2026-08-11) — full dispatch-log traces on CCSD-2169.

---

## Known open items to inherit knowingly

| Item | State |
|---|---|
| Backend rejects assignee on terminal RATE | FE retry keeps citizens unblocked; Case-Manager id persists only after the backend change (CCSD-2169 ask #2) |
| COMMENT notification resolves to the wrong employee when the transition has no assignee | pgr-services follow-up (CCSD-2169 ask #3) |
| Audio uploads (mp3/wav) | rejected server-side by design; accepts/hints already aligned (CCSD-2082) |
| Notification matrix not in DDH seed yet | seed manually per Phase 5.1 until CCSD-2169 ask #1 lands |
