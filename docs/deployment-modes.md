# CCRS Deployment Modes — Approach Documentation

**Status:** Accepted (Sprint Goal 2) · **Last updated:** 2026-05-29

CCRS ships as one product (`egovernments/CCRS` monorepo, `develop`) but must deploy to
a range of targets: a developer laptop, a single demo box, and a high-availability
production cluster. The same service images and configuration model (tenant config,
MDMS, boundaries, branding) feed every mode; the orchestrator and backbone wiring
underneath differ (see the A↔C drift note in Open Questions).

## Pick a mode

| Mode | Substrate | Use for | HA | Source |
|------|-----------|---------|----|--------|
| **A. Ansible + Compose** | Single VM, Docker Compose | Dev, demos, pilots, CI | No | `local-setup/ansible/` |
| **B. Local Kubernetes** | kind / k3d / single-node k8s | Developing the k8s path | No | `local-setup/k8s/` + `Tiltfile.k8s` |
| **C. Helm + Rancher/RKE2** | Multi-node K8s cluster | Production SaaS | **Capable** | `devops/deploy-as-code/charts/` + `devops/infra-as-code/terraform/` |

Everything non-production runs on **Mode A** (fastest, most reproducible bring-up).
Paying tenants run on **Mode C**. **Mode B** exists only to develop and validate the
k8s manifests without a cloud cluster.

## Mode A — Ansible + Docker Compose (single node)

**Entry point:** `local-setup/ansible/deploy.sh <tenant>`

An Ansible playbook (`playbook-deploy.yml`) converges a single host: renders
`digit.env`, `globalConfigs.js`, and the nginx site from `templates/`, brings up the
Docker Compose stack (~36 containers — Postgres, Redpanda, Redis, MinIO, Kong, all
core-services, PGR, configurator, digit-ui behind a host nginx), runs DB migrations, and
bootstraps the tenant.

- **Strengths:** blank VM → green in ~5 min; idempotent re-converge (what the nightly
  bomet redeploy relies on); per-tenant values in one file (`inventory/host_vars/<tenant>.yml`);
  no cluster to operate; Mac- and Linux-capable.
- **Limits:** no HA (single host, one Postgres, no failover); vertical scaling only;
  stateful data on local volumes with operator-managed backup (note the bomet
  anonymous-volume hazard — `down -v` destroys everything).

Runs today on bomet (dev, nightly), naipepea (demo), maputo. CI uses it for E2E validation.

## Mode B — Local Kubernetes (dev cluster)

**Entry point:** `Tiltfile.k8s` + manifests in `local-setup/k8s/`

Plain manifests grouped as `infrastructure/` (postgres, redis, redpanda, minio,
pgbouncer), `core-services/`, and `app-services/` (kong, pgr-services, digit-ui), with
Tilt live-reloading into a local cluster. This is the development harness for the k8s
path — not a tenant target.

- **Strengths:** validates k8s wiring (probes, service DNS, config maps) without cloud
  spend; fast inner loop via Tilt.
- **Limits:** single-node, no real load; uses raw manifests rather than the production
  Helm charts, so it's representative of Mode C, not identical (see open questions).

## Mode C — Helm + Rancher/RKE2 (production HA)

**Charts:** `devops/deploy-as-code/charts/` · **Infra:** `devops/infra-as-code/terraform/`
(AWS/Azure/GCP samples + node-pool modules) and `infra-as-code/ansible/` (`haconfig.cfg`)

The production substrate, following DIGIT on-premise / RKE2 guidance:

- **Cluster:** HA RKE2 managed by Rancher (≥3 control-plane nodes for etcd quorum +
  worker nodes). Cloud clusters (EKS/AKS/GKE) provisioned via the Terraform samples.
- **Charts:** organised by tier — `backbone-services` (Postgres, Kafka, Redis,
  Elasticsearch/Kibana), `core-services`, `urban` (PGR/CCRS, digit-ui, boundary-mgmt,
  default-data-handler), `common-services`, `monitoring`, `analytics`.
- **Environments:** `charts/environments/env.yaml` + `env-secrets.yaml` hold the
  per-environment (cluster) overrides — db-host, domain, state tenant id. This
  parameterises one deployment environment, not individual DIGIT tenants.

**HA is available but not default.** The platform *can* run HA; the shipped chart values
do not. The Postgres chart defaults to `architecture: standalone` and most services to
`replicas: 1`, so a production HA setup must explicitly enable: `architecture:
replication` (primary + read replica statefulsets — note this is read-scaling/standby,
not automatic failover unless paired with a failover mechanism), `replicas > 1` with
anti-affinity/PDBs for stateless services, ≥3 RKE2 control-plane nodes for etcd quorum,
and shared storage (NFS or object store) for the filestore.

- **Strengths (when configured for HA):** horizontal scale, rolling deploys, self-healing,
  optional autoscaling; built-in monitoring/analytics tiers (Prometheus, Kibana).
- **Costs:** a cluster to run, upgrade, secure, and observe; slower inner loop (chart
  values + Helm release); requires infra provisioned first.

**Reference docs**
- On-prem RKE2 HA: `docs.digit.org/.../infrastructure-setup/sdc/create-infrastructure-on-premise`
- CCRS v2.10 production setup: `docs.digit.org/complaints-management/complaints-resolution-v2.10/deploy/setup/production-setup/setup-infrastructure/on-premise`
- NFS server on Rancher: `.../on-premise/deploy-network-file-system-nfs-server`
- Cloud (Terraform): `.../infrastructure-setup/azure/3.-infra-as-code-terraform`

## Ansible vs Kubernetes

| Dimension | Ansible + Compose (A) | Helm + RKE2 (C) |
|-----------|----------------------|-----------------|
| Time to first green stack | ~5 min | Hours (cluster) → minutes (release) |
| High availability | None | Capable, opt-in (replicas + DB replication must be enabled) |
| Horizontal scale | No (vertical only) | Yes |
| Operational burden | Low (one box) | High (cluster lifecycle) |
| Failover / self-healing | None | Pod & node level |
| Inner-loop speed | Fast | Moderate (Tilt in Mode B) |
| Backup/restore | Operator scripts | Snapshots + replication |
| Cost | One VM | Cluster + storage + ops |

**Decision guide:** pilot or internal environment → **A**. Paying tenant or multi-tenant
scale → **C**. Developing the k8s path → **B**.

## Promotion path: single-node → HA

Because both modes share the same config model, graduating a tenant is a data + config
migration, not a rewrite:

1. Snapshot the Mode-A Postgres and filestore.
2. Provision the cluster (Terraform/Rancher) if needed.
3. Add the tenant's override to `charts/environments/env.yaml` (+ secrets).
4. `helm upgrade --install` the chart set.
5. Restore data into the replicated Postgres; sync filestore to NFS/object store.
6. Validate (logins, PGR lifecycle, branding), then cut DNS over.

## Open questions

- **Tenancy model.** Each city today (bomet, naipepea, maputo) is a *separate
  deployment*, not a logical tenant in one cluster. Is the SaaS target one
  environment-per-customer (current de-facto) or a shared cluster with DIGIT logical
  tenants sharing db/schema/bucket? This decides isolation, blast radius on
  release/rollback, backup granularity, and data residency, and should be stated before
  the first production tenant.
- **A↔C drift.** Modes A and C share images and config intent but not orchestration
  artifacts (and Mode B uses raw manifests, not the prod charts). Should Mode B consume
  the production Helm charts so local == prod? Closing this makes promotion cheaper and
  safer.
- Standardise production on **on-prem RKE2** (data-residency) or **cloud managed k8s**
  (EKS/AKS/GKE via Terraform), or offer both?
- Backup/restore: platform-level guarantee for Mode A pilots vs. the replication +
  snapshot story for Mode C?

