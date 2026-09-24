# Citizen Complaint Resolution System (CCRS)

CCRS is a production-ready citizen grievance redressal platform built on the
DIGIT urban governance stack. It covers the full complaint lifecycle — filing,
routing to the responsible department, resolution, and citizen notification —
and is deployed across cities in Africa and India.

![CCRS architecture](https://github.com/user-attachments/assets/8e421d9c-09fb-4193-bec4-faea3bcb653b)

For a detailed walkthrough, see [docs/HLD.md](docs/HLD.md).

---

## Repository layout

```
├── backend/
│   ├── pgr-services/                   # Core complaint service (Java/Spring Boot)
│   ├── digit-config-service/           # Tenant configuration API
│   ├── digit-user-preferences-service/
│   ├── novu-bridge/ & novu-bridge-endpoint/  # Notification pipeline bridges
│   └── xstate-chatbot/                 # WhatsApp / chatbot integration
│
├── frontend/
│   └── micro-ui/                       # React UI (module-federated DIGIT shell)
│
├── local-setup/                        # Run the stack locally or on a server
│   ├── README.md                       # ← start here
│   ├── docker-compose.yml              # Option A: quick dev stack
│   ├── Tiltfile                        # Option B: dev stack with hot reload + dashboard
│   └── ansible/                        # Option C: full deployment (local or remote server)
│
├── devops/
│   ├── deploy-as-code/                 # Helm charts
│   └── infra-as-code/                  # Terraform (AWS EKS, GCP, Azure)
│
├── docs/                               # Operational and product documentation
├── performance/docs/                   # Load test results and capacity planning
├── configs/                            # DIGIT platform configuration files
├── tests/                              # Integration and Playwright e2e test suites
├── digit-mcp/                          # MCP server for AI-assisted operator tooling
└── utilities/                          # Master data loader
```

---



## Running locally

See `[local-setup/README.md](local-setup/README.md)`. Three options — pick one:


| Option                                                                                 | When to use                                                                    | Min. RAM                       | Min. CPU                          | Tools         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------ | --------------------------------- | ------------- |
| **[A — Docker Compose](local-setup/README.md#option-a-docker-compose)**                | Exploring the API, reproducing bugs, running smoke tests                       | 8 GB to Docker                 | 8 vCPU                            | Docker        |
| **[B — Tilt](local-setup/README.md#option-b-tilt)**                                    | Actively changing PGR Java or UI code; want hot reload and a service dashboard | 8 GB to Docker                 | 8 vCPU                            | Docker + Tilt |
| **[C — Ansible](local-setup/README.md#option-c-ansible--the-whole-stack-one-command)** | Full deployment simulation, onboarding a city, or deploying to a server        | 16 GB (local) / 32 GB (server) | 8 vCPU (local) / 16 vCPU (server) | Ansible       |


---



## Deployment



### Single server — Ansible

The Ansible playbook in `local-setup/ansible/` deploys the full stack to any
Linux server. It installs Docker, configures nginx and TLS, manages secrets via
OpenBao, and sets up monitoring in one command:

```bash
cd local-setup/ansible
./deploy.sh <tenant>
```

See `[local-setup/ansible/README.md](local-setup/ansible/README.md)` for
tenant configuration, secrets rotation, and operational runbooks.

### Kubernetes — Helm + Terraform

Helm charts and Terraform modules live in `devops/`. These are used for
state-wide rollouts, multi-city platforms, and deployments with high-availability
requirements.

### Choosing between them


| Scenario                                               | Starting point                         |
| ------------------------------------------------------ | -------------------------------------- |
| City under 1M population, no formal uptime SLA         | Ansible, single server                 |
| City 1M–5M, or HA required from day one                | Kubernetes, 2–4 nodes                  |
| State-wide rollout (India) or major metro 5M+ (Africa) | Kubernetes — see capacity guides below |


Detailed guidance with complaint volume assumptions by city tier:

- Africa: `[docs/deployment-decision-guide-africa.md](docs/deployment-decision-guide-africa.md)`
- India: `[docs/deployment-decision-guide-india.md](docs/deployment-decision-guide-india.md)`

---



## Documentation

### Installation Guide

| Topic | Location |
|-------|----------|
| Local setup (Docker Compose, Tilt, Ansible) | [local-setup/README.md](local-setup/README.md) |
| Server deployment and tenant configuration | [local-setup/ansible/README.md](local-setup/ansible/README.md) |
| Secrets management (OpenBao) | [local-setup/ansible/runbooks/01-openbao.md](local-setup/ansible/runbooks/01-openbao.md) |
| Notifications setup | [docs/notifications-guide/](docs/notifications-guide/) |
| Deployment sizing — Africa | [docs/deployment-decision-guide-africa.md](docs/deployment-decision-guide-africa.md) |
| Deployment sizing — India | [docs/deployment-decision-guide-india.md](docs/deployment-decision-guide-india.md) |

### Operations & Monitoring Guide

| Topic | Location |
|-------|----------|
| Enabling monitoring | [docs/observability/enabling-monitoring.md](docs/observability/enabling-monitoring.md) |
| Dashboard metrics reference | [docs/observability/dashboard-metrics.md](docs/observability/dashboard-metrics.md) |
| Alerting runbook | [docs/observability/alerting-runbook.md](docs/observability/alerting-runbook.md) |
| L0/L1 operator runbook | [docs/ops/l0-l1-monitoring-guide.md](docs/ops/l0-l1-monitoring-guide.md) |

### Developer Guide

| Topic | Location |
|-------|----------|
| High-level design | [docs/HLD.md](docs/HLD.md) |
| PGR data model and ERDs | [docs/pgr/](docs/pgr/) |
| Performance benchmarks and capacity planning | [performance/docs/executive-summary.md](performance/docs/executive-summary.md) |


---



## Contributing

Code owners are defined in `[CODEOWNERS](CODEOWNERS)`. All contributors are
expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Pull requests should target `master`. CI runs Postman smoke tests and Playwright
end-to-end tests on every PR — check the Actions tab for results.

## License

[MIT](LICENSE)