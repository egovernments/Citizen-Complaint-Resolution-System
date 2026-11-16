# Load-Test Runs

Version 2.20 complaint-lifecycle performance measurements on the Bomet
single-machine deployment. Each lifecycle runs create → assign → resolve → search
through the complaint API stack.

| Run | Deployment | Start with |
|---|---|---|
| [15–16 November 2026](ansible/README.md) | Existing single-machine Docker Compose stack on Bomet, 16 logical CPUs and approximately 30.6 GiB RAM | [Executive Summary](ansible/executive-summary.md) |

The document layout follows [2.12 performance results](../../2.12/performance/README.md):

- `README.md` — scope, headline results, and reading order
- `executive-summary.md` — key numbers and implications
- `findings.md` — methodology, results, failures, and comparison limits
- `recommendations-transition-plan.md` — interpretation and follow-up priorities

The `ansible/` folder groups the single-machine campaign consistently with 2.12;
the test campaign itself did not provision or redeploy the stack with Ansible.
No Kubernetes campaign, constrained CPU matrix, burst ladder, arrival-rate test,
or dashboard benchmark is claimed by these results. The reusable harness remains
under [`performance/`](../../../../performance/).
