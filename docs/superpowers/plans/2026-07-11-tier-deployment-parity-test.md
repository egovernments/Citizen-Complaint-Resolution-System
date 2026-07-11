# 3-Tier Deployment Parity Test — End-to-End Plan

> **For agentic workers:** this is an infra/ops runbook (not code+TDD). Execute phase-by-phase; each phase ends with a **GATE** that must pass before proceeding. AWS (Tier 3) is entered LAST and only after Tiers 1–2 pass, to minimize paid runtime.

**Goal:** deploy the **same "latest" code** (develop + the un-merged parity PRs) three ways — Ansible/Compose → k3s → AWS EKS — run the **same Playwright integration suite** against each, and confirm the **results match**. Differences = real stack divergences to investigate.

**Why 3 tiers:** rehearse the entire flow on free/cheap tiers (compose + k3s, both on this host) so the paid EKS tier runs only for a short, fully-rehearsed window.

## Guiding principles

1. **Parity by construction** — same integration branch, same test suite, same seeded data on every tier; the *deployment stack* is the only variable.
2. **Clean surface / no bias** — every tier starts from a **clean, minimal base** seeded with the **identical** team-provided configurator data (nothing pre-loaded on one tier the others lack — in particular **do not** rely on the compose fast-path dump's pre-onboarded extras). **Snapshot the seeded baseline; restore it before every test cycle** so test-created data can't bias a re-run or the cross-tier comparison. Tests create run-scoped/unique data.
3. **Cost minimization** — EKS is last, entered only when proven; teardown is pre-written; `terraform destroy` runs immediately after the run.

## Global constraints / facts

- Repo root: `/home/ubuntu/projects/egov-devops/Citizen-Complaint-Resolution-System`. AWS: user `cms-one-click`, account `349271159511`, region **`ap-south-1`**.
- Existing 8 EKS clusters are **off-limits** — provision everything fresh, uniquely prefixed `parity-test-*`.
- Integration branch = `develop` + these 7 open PR branches:
  `fix/egov-location-boundary-migration` (#1098), `fix/egov-user-event-service-host-namespace` (#1099), `fix/pgr-search-citizen-scoping` (#1100), `fix/otp-real-enablement` (#1102), `fix/kong-rbac-phase3` (#1128 — git-stacked, already contains #1101/#1104/#1105), `feat/item10-db-migration-parity` (#1142), `chore/disable-unused-audit-service` (#1157). (#1103 already in develop.)
- **Images needing a rebuild from the integration branch** (source-changing PRs): `digit-ui` (#1098 frontend) and `pgr-services` (#1100 backend). All other PRs are config/YAML → stock `egovio` images are fine. Rebuilt images go to a **throwaway ECR**; charts/compose pins are overridden for just those two.
- Test suite: `tests/integration-tests/` (Playwright), runner `runner/run-cycle.sh`, configured per-target via env (`BASE_URL`, `DIGIT_TENANT`, `ROOT_TENANT`, `SERVICE_CODE`, `LOCALITY_CODE`, employee users). Deployment-agnostic — point `BASE_URL` at each tier.

## ⛔ Execution gates (resolve before the noted phase)

- **G1 — Configurator seed data** (team still to share): the exact complaint types / `SERVICE_CODE`, `LOCALITY_CODE`, departments, employees (`PGR_LME`, `GRO`, city-admin) the tests require. **Gates every test run (Phases 2–4).** Capture it as a repeatable onboarding script so all tiers get identical data.
- **G2 — IAM permissions** for `cms-one-click` to create ECR + EKS/RDS/VPC/S3/IAM. A `terraform plan` (Phase 4a) reveals gaps at zero cost. **Gates Tier 3.**

> ⚠ **Before executing, read the [Gap-review addenda](#gap-review-addenda-2026-07-11) at the bottom** — it adds required steps to Phases 1–4 (esp. **N1: the configurator is compose-only and must be served on k3s/EKS**, or ~half the suite + the seed can't run there) and flags the one **open unknown (U1: a truly clean pre-onboarding compose base is unsolved / item #10 territory)**.

---

## Phase 0 — Integration branch (once)

- [ ] **0.1** Fetch + branch off latest develop:
  ```bash
  git fetch origin develop
  git checkout -b integration/parity-test origin/develop
  ```
- [ ] **0.2** Merge the 7 PR branches (order: config-light first, big ones last):
  ```bash
  for b in origin/fix/egov-user-event-service-host-namespace \
           origin/fix/egov-location-boundary-migration \
           origin/fix/pgr-search-citizen-scoping \
           origin/fix/otp-real-enablement \
           origin/chore/disable-unused-audit-service \
           origin/fix/kong-rbac-phase3 \
           origin/feat/item10-db-migration-parity; do
    git merge --no-edit "$b" || { echo "CONFLICT in $b — resolve, git add, git commit"; break; }
  done
  ```
- [ ] **0.3** Resolve any conflicts (likely spots: `local-setup/kong/kong.yml`, `env.yaml`, compose files). Commit.
- **GATE 0:** `git log --oneline origin/develop..HEAD` shows all 7; repo builds/parses (run the two CI checks: `check-flyway-dump-alignment.py`, `check-gateway-whitelist-parity.py` — both green). Push the branch (so CI + the ECR build can reference it).

## Phase 1 — Shared assets (once)

### 1a. Throwaway ECR + integration-branch images
- [ ] **1.1** Create ECR repos (cheap — storage only):
  ```bash
  ACCOUNT=349271159511; REGION=ap-south-1
  for r in parity-test/digit-ui parity-test/pgr-services; do
    aws ecr create-repository --repository-name "$r" --region $REGION >/dev/null || true
  done
  aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
  ```
- [ ] **1.2** Build the two changed images from the integration branch and push:
  - `digit-ui` — build per `build/build-config.yml` / the digit-ui-esbuild bundle build; tag `…/parity-test/digit-ui:integration`.
  - `pgr-services` — Maven build → docker build; tag `…/parity-test/pgr-services:integration`.
  ```bash
  ECR=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com
  # (exact build commands per each service's Dockerfile / build-config.yml)
  docker build -t $ECR/parity-test/digit-ui:integration <digit-ui build ctx> && docker push $ECR/parity-test/digit-ui:integration
  docker build -t $ECR/parity-test/pgr-services:integration <pgr build ctx> && docker push $ECR/parity-test/pgr-services:integration
  ```
- **GATE 1a:** `aws ecr list-images` shows both `:integration` tags.

### 1b. Test harness + per-tier env
- [ ] **1.3** `cd tests/integration-tests && npm ci && npx playwright install chromium`.
- [ ] **1.4** Create three env files — `deploy/compose.env`, `deploy/k3s.env`, `deploy/eks.env` — identical except `BASE_URL`. Fill tenant / `SERVICE_CODE` / `LOCALITY_CODE` / employee users from **G1** (team data).
- [ ] **1.5** `npm run test:list` — confirms specs parse (no deployment needed).

### 1c. Onboarding script (clean-surface enabler)
- [ ] **1.6** Write **one** idempotent onboarding script that seeds a *clean* deployment with exactly the G1 data via the configurator/API (complaint types, departments, designations, employees, boundary localities). Used identically on all three tiers → guarantees identical fixtures.
- **GATE 1:** onboarding script runnable; env files complete; harness parses.

---

## Phase 2 — Tier 1: Ansible / Compose (this host)

- [ ] **2.1 Clean base (no-bias):** deploy compose from the integration branch **without** relying on the pre-seeded fast-path extras — use a **minimal dump** (schema + base masters only) *or* slow-path (Flyway builds schema), so the starting surface matches a fresh k3s/EKS. `cd local-setup/ansible && ./deploy.sh <tenant>` with the appropriate `host_vars`.
- [ ] **2.2** Point compose images for `digit-ui` + `pgr-services` at the ECR `:integration` tags (env overrides).
- [ ] **2.3 Seed:** run the Phase-1c onboarding script → identical G1 data.
- [ ] **2.4 Snapshot baseline:** `pg_dump` the seeded DB (or `docker commit`/volume snapshot) → `baseline-compose.sql`. This is the restore point for each cycle.
- [ ] **2.5 Run tests:** `BASE_URL=<compose Kong URL>`; `set -a; source deploy/compose.env; set +a && ./runner/run-cycle.sh` (or `npx playwright test`). Record pass/fail + the HTML report.
- [ ] **2.6 (if re-running)** restore `baseline-compose.sql` before each cycle.
- **GATE 2:** suite runs to completion; results captured. Record the pass/fail vector as the **reference**. Investigate any failure now (cheap) before replicating.
- [ ] **2.7 Tear down** to free the host for k3s: `docker compose … down -v`.

## Phase 3 — Tier 2: k3s (same host)

- [ ] **3.1** Install k3s + tooling: `curl -sfL https://get.k3s.io | sh -`; `kubectl`, `helm`, `helmfile` (+ the `helm-diff`/`helm-secrets` plugins the helmfile uses).
- [ ] **3.2 In-cluster data services (no AWS):** in `devops/deploy-as-code/charts/backbone-services/backboneservices-helmfile.yaml` set `postgresql`, `minio`, `kafka-kraft` → `installed: true`. Ingress: install `ingress-nginx` (k3s ships Traefik — either use it or disable Traefik and install ingress-nginx to match the chart assumptions).
- [ ] **3.3** Override the two service images to the ECR `:integration` tags (chart values / `env.yaml`); create an ECR imagePullSecret in the namespace.
- [ ] **3.4 Deploy:** `cd devops/deploy-as-code && helmfile -f digit-helmfile.yaml apply`. Clean base by construction (fresh cluster + fresh in-cluster DB).
- [ ] **3.5 Seed:** run the *same* Phase-1c onboarding script against the k3s ingress URL → identical G1 data.
- [ ] **3.6 Snapshot baseline:** dump the in-cluster postgres → `baseline-k3s.sql`.
- [ ] **3.7 Run tests:** `BASE_URL=<k3s ingress URL>`; `source deploy/k3s.env`; `./runner/run-cycle.sh`. Record results.
- **GATE 3:** suite completes; **compare pass/fail vector to Tier 1**. Any divergence here is a real compose-vs-K8s finding — investigate at zero AWS cost. **Do NOT proceed to EKS until Tier 2 matches Tier 1 (or divergences are understood/accepted).**
- [ ] **3.8 Tear down** k3s (`/usr/local/bin/k3s-uninstall.sh`) to free the host.

## Phase 4 — Tier 3: AWS EKS (last; minimize runtime)

> Everything below is billable. Have Phases 2–3 green first. Work fast and destroy immediately after.

### 4a. Provision (parameterized, isolated)
- [ ] **4.1** Review `devops/infra-as-code/terraform/sample-aws` vars; **set a unique prefix `parity-test`** on cluster/VPC/RDS/bucket names so nothing collides with the 8 existing clusters.
- [ ] **4.2** `terraform init && terraform plan` — **this also validates G2 (IAM perms) at $0**. Fix perms/naming before apply.
- [ ] **4.3** `terraform apply` → EKS + RDS + S3 + VPC + `gp3` StorageClass. Record every created resource (for teardown).
- [ ] **4.4** `aws eks update-kubeconfig --region ap-south-1 --name parity-test-<cluster>`; `kubectl get nodes` healthy.

### 4b. Deploy + test (mirror of Tier 2, minus in-cluster data)
- [ ] **4.5** Backbone charts `installed:false` (real RDS/S3); wire RDS/S3 endpoints + secrets (SOPS). Override the two images → ECR `:integration`.
- [ ] **4.6** `helmfile -f digit-helmfile.yaml apply`; wait healthy.
- [ ] **4.7 Seed:** same Phase-1c onboarding script → identical G1 data. Snapshot → `baseline-eks.sql`.
- [ ] **4.8 Run tests:** `BASE_URL=<EKS ingress URL>`; `source deploy/eks.env`; `./runner/run-cycle.sh`. Record results.
- **GATE 4:** suite completes; results captured.

### 4c. Teardown (immediately — ORDER MATTERS for cost)
- [ ] **4.9** **`helmfile destroy` FIRST — do NOT skip.** K8s Services (`type=LoadBalancer`) and PVCs create **ELBs + EBS volumes that terraform does NOT track**; if you jump straight to `terraform destroy`, those survive and keep billing. So: `helmfile -f digit-helmfile.yaml destroy`, then `kubectl get svc -A | grep LoadBalancer` and `kubectl get pvc -A` → confirm none remain (delete leftovers).
- [ ] **4.10** `terraform destroy` → `terraform state list` empty.
- [ ] **4.11** **Manual stray-resource sweep** (the usual orphans that keep billing): in the AWS console/CLI check for lingering **ELB/NLB, EBS volumes, NAT gateways, Elastic IPs, RDS instances + RDS snapshots** tagged `parity-test`. `aws ec2 describe-volumes --filters Name=status,Values=available` etc.
- [ ] **4.12** Delete the throwaway ECR repos (`aws ecr delete-repository --force`).

---

## Phase 5 — Compare & report

- [ ] **5.1** Put the three pass/fail vectors side by side (the runner's dashboard/HTML reports per tier).
- [ ] **5.2** "Match" = identical pass/fail across all three. For any test that differs across tiers, capture: which tier, the failure, and the suspected stack cause (gateway? data? in-cluster-vs-RDS? image?).
- [ ] **5.3** Write up findings (feeds the parity tracker). Note that consistent failures across *all* tiers are test/data issues, not parity gaps; **divergences between tiers** are the real signal.

## Cost controls (EKS)

- EKS is entered only after Gate 3. A pre-written `terraform destroy` is ready before `apply`. Time-box the Tier-3 window; keep the deploy+seed+test steps scripted so nothing is improvised while billing. Verify teardown left nothing (EBS volumes, ELBs, NAT gateways, RDS, snapshots are the usual stragglers).

## Gap-review addenda (2026-07-11)

Extra required steps surfaced by reviewing the plan. Split into: **NEW** (execution
mechanics the parity analysis never exercised — must add), **KNOWN** (already
established in the parity work / tracker — just apply, don't re-derive), and the
one **OPEN UNKNOWN**.

### NEW — must be added to the phases

- **N1 · Configurator serving on k8s (Phases 1 + 3 + 4) — the biggest gap.** The Playwright suite drives the **configurator UI** (`tests/admin/departments|complaints|users`, `tests/specs/configurator/*`) *and* the seed is "onboard on configurator." The configurator is **compose-only — it is NOT in the k8s helmfile.** So: **build the configurator `dist` once** (Phase 1, e.g. `npx vite build --base=/configurator/` from a `digit-configurator` clone) and on **k3s/EKS serve it behind ingress-nginx** (a tiny nginx Deployment + Ingress at `/configurator/`, mirroring how compose/host-nginx serves it). Without this, ~half the suite + the seed cannot run on k3s/EKS.
- **N2 · EKS teardown ordering** — handled inline in Phase 4c (helmfile destroy before terraform destroy; stray-resource sweep).
- **N3 · k3s ingress exposure (Phase 3.2)** — k3s ships **Traefik**; charts assume **ingress-nginx** → install k3s with `--disable traefik`, install ingress-nginx, expose via klipper-lb/nodePort; set `BASE_URL=http://<host-ip>:<port>` (or an `/etc/hosts` alias). No public DNS.
- **N4 · EKS BASE_URL / TLS (Phase 4.8)** — a fresh cluster yields an **ELB hostname over http**, but the suite defaults to `https://…digit.org`. Run with `BASE_URL=http://<elb-hostname>` and confirm the specs tolerate http + a non-`digit.org` host (check any hardcoded host/https assumptions), or attach a quick cert-manager self-signed cert. Avoid needing real DNS.
- **N5 · Resource sizing on k3s (Phase 3)** — elasticsearch + kafka + postgres + minio + ~24 services on one host is heavy. Verify host RAM ≥ what the compose stack used; add swap/limits; ES needs `sysctl -w vm.max_map_count=262144`.
- **N6 · ECR token expiry** — the ECR `docker login` token lasts ~12h; re-run `aws ecr get-login-password | docker login …` if a tier's build/pull spans longer.
- **N7 · Concrete build commands** — Phase 1.2 placeholders must be filled from `build/build-config.yml` + each service's Dockerfile; the **digit-ui esbuild bundle build is finicky** (see [[digit-ui-onhost-build-fails-ubuntu]] — use the bundle-image path, not on-host). Tag images with the integration-branch commit SHA for fidelity.

### KNOWN — apply the established handling (cite the tracker, don't re-solve)

- **K1 · RBAC enforce alignment (Phase 2)** — the integration Kong ships **audit-mode** (`ENFORCE_UNAUTH`/`ENFORCE_RBAC=false`) while the k8s Spring gateway **enforces**; that asymmetry would bias auth-gated tests. For an unbiased run, **set compose Kong to ENFORCE** so all tiers enforce identically. *(tracker item #5 — the toggles exist by design.)*
- **K2 · digit-ui for compose (Phase 2)** — #1098 is a frontend change; compose serves digit-ui from a **bundle image** → rebuild the bundle from the integration branch for compose (in addition to the ECR image for k8s). *(see [[digit-ui-onhost-build-fails-ubuntu]].)*
- **K3 · Secrets** — k3s: plain values (no KMS). EKS: SOPS/AWS-KMS as the helmfile expects. *(tracker "Secrets model" row.)*
- **K4 · Seed must traverse both gateways** — the onboarding script hits Kong (compose) vs Spring gw (k8s); keep it gateway-agnostic (auth + path classification differ). *(tracker items #4/#5.)*

### OPEN UNKNOWN

- **U1 · Truly clean pre-onboarding base for compose (Phase 2.1)** — the fast-path dump is a **post-onboarding** snapshot; slow-path hits the **DDH onboarding bugs (#1090, parked)**. So a genuinely clean, identically-seeded compose base is **not currently solved** (it's exactly item #10's unresolved half). **Decision required at execution:** (i) accept compose starts from the dump and enforce no-bias by having the suite touch only freshly-onboarded fixtures (partial), or (ii) build a minimal pre-onboarding dump. This is the one real unknown — resolve before trusting Tier-1 as the reference vector.

## Gates (unchanged)

- **G1 — Configurator seed data** (team-pending): the exact complaint types/`SERVICE_CODE`, `LOCALITY_CODE`, departments, employees the tests need. Critical path for every run.
- **G2 — IAM permissions** for `cms-one-click` (ECR + EKS/RDS/VPC/S3/IAM) — a `terraform plan` reveals gaps at $0.
