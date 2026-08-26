# EKS v1.33 Upgrade - Summary of Changes

As part of the **EKS upgrade to Kubernetes v1.33**, the following updates and enhancements were implemented.

---

## AMI Upgrade
- Node group AMI upgraded from Bottlerocket  → AmazonLinux2023 (AL2023) for improved:
    - Performance
    - Container-optimized operations

## Steps to Migrate from EKS v1.32 to v1.33

1. Update the Kubernetes version in the `variables.tf` file.

    ```hcl
    variable "kubernetes_version" {
    description = "Kubernetes version"
    default     = "1.33"
    }

2. Later, Run the below commands:
    ```hcl
    terrafotm init
    terraform plan
    terraform apply

## Deploy IAM policy

The identity that runs `terraform apply`/`destroy` needs a broad set of
permissions — it creates and destroys a VPC, EKS, RDS, S3, IAM roles, and the
cluster's load balancers. The complete policy covering the **entire create +
destroy lifecycle** is checked in at
[`deploy-iam-policy.json`](./deploy-iam-policy.json); create it once as a managed
policy and attach it to the deploy user/role before the first apply. It fits in a
single managed policy (well under the 6144-char limit), so it is a one-time
attach — nothing to add piecemeal later.

It deliberately includes a few actions that the DEFAULT deploy does not exercise,
so you never have to come back for them:

- **`elasticloadbalancing:*` (describe/delete)** — to clean up the ingress ELB on
  teardown (see the Teardown section).
- **KMS key administration** (`kms:DescribeKey`, `PutKeyPolicy`, `CreateGrant`,
  `ScheduleKeyDeletion`, …) — only used if you opt into a customer-managed CMK.
  **EKS secrets encryption is off by default** (`create_kms_key = false`,
  `encryption_config = null` on the `eks` module); etcd is still encrypted at
  rest with the EKS AWS-managed key. To use a customer CMK, just drop those two
  lines — the policy already grants what that path needs.

## Teardown — delete Kubernetes LoadBalancers FIRST

**Before `terraform destroy`, delete every Kubernetes `Service` of type
`LoadBalancer` and wait for the cloud ELB to disappear.** The in-cluster ingress
controller creates its ELB through the AWS cloud controller — terraform does not
manage it. If you destroy the cluster while that Service still exists, the ELB is
orphaned and its ENIs stay attached in the public subnets, which blocks subnet +
Internet Gateway deletion and hangs the destroy on `DependencyViolation`.

```bash
# remove the LB services (ingress-nginx and any others) while the cluster is alive
kubectl delete svc -A --field-selector spec.type=LoadBalancer
# confirm the ELB is gone before proceeding (needs elasticloadbalancing:Describe*)
aws elb describe-load-balancers --region <region> \
  --query 'LoadBalancerDescriptions[].LoadBalancerName'
# only then:
terraform destroy
```

`deploy-iam-policy.json` includes `elasticloadbalancing:Describe*` +
`DeleteLoadBalancer` so the deploy identity can detect and clean up an ELB that
was orphaned anyway. Without those, a least-privileged deploy user cannot remove
the orphan and the VPC teardown cannot complete.

## Documentation

Refer to our [Core Infrastructure Documentation](https://core.digit.org/guides/installation-guide/infrastructure-setup/aws/3.-provision-infrastructure) to deploy the infrastructure end-to-end.
