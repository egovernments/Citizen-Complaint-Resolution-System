# Load-Test Runs

Two complaint-lifecycle campaigns cover the supported deployment modes, and a
targeted dashboard read-path follow-up covers stored-data scaling on the Ansible
deployment. Lifecycle iterations run create → assign → resolve → search through
the full stack. Each deployment folder carries the same four core documents.

| Run | Deployment | Start with |
|---|---|---|
| [28 August 2026](ansible/README.md) | **Ansible / Docker Compose** — one 16 vCPU / 30 GB host running the full 59-container stack | [Capacity Planning](ansible/recommendations-transition-plan.md) |
| [2–3 September 2026 dashboard read-path follow-up](ansible/dashboard-scaling-02-09-26.md) | **Ansible / Docker Compose** — the same Bomet host, with 20K–500K deterministic complaint fixtures | [Dashboard Scaling](ansible/dashboard-scaling-02-09-26.md) |
| [1 September 2026](k8s/README.md) | **Kubernetes** — AWS EKS, 4 × m5a.xlarge, one replica per service, no CPU limits | [Capacity Planning](k8s/recommendations-transition-plan.md) |

In each folder:

- `README.md` — the headline numbers and what to read first
- `executive-summary.md` — key numbers, the capacity table, where the limit is
- `findings.md` — methodology, degradation curve, deployment configuration, known limits
- `recommendations-transition-plan.md` — business sizing: complaints per day, test users
  versus real people, what to fix first

The Ansible folder also carries `dashboard-scaling-02-09-26.md`, a targeted
dashboard read-path campaign across 20K–500K stored complaints and 2–200 VUs.

The k6 harness, the March 2026 baseline campaign and its methodology live under
[`performance/`](../../../performance/); its documentation site is
[`performance/docs/`](../../../performance/docs/).
