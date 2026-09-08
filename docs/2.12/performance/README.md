# Load-Test Runs

Two load-test campaigns against live DIGIT PGR deployments, one per supported deployment
mode. Every test iteration runs one complete complaint lifecycle — create → assign →
resolve → search — through the full stack. Each folder carries the same four documents.

| Run | Deployment | Start with |
|---|---|---|
| [28 August 2026](ansible/README.md) | **Ansible / Docker Compose** — one 16 vCPU / 30 GB host running the full 59-container stack | [Capacity Planning](ansible/recommendations-transition-plan.md) |
| [1 September 2026](k8s/README.md) | **Kubernetes** — AWS EKS, 4 × m5a.xlarge, one replica per service, no CPU limits | [Capacity Planning](k8s/recommendations-transition-plan.md) |

In each folder:

- `README.md` — the headline numbers and what to read first
- `executive-summary.md` — key numbers, the capacity table, where the limit is
- `findings.md` — methodology, degradation curve, deployment configuration, known limits
- `recommendations-transition-plan.md` — business sizing: complaints per day, test users
  versus real people, what to fix first

The k6 harness, the March 2026 baseline campaign and its methodology live under
[`performance/`](../../../performance/); its documentation site is
[`performance/docs/`](../../../performance/docs/).
