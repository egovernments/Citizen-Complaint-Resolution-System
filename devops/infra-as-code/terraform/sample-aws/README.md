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

The identity that runs `terraform apply` needs a broad set of permissions — it
creates a VPC, EKS, RDS, S3, and IAM roles. The complete, minimal policy that is
known to deploy this module is checked in at
[`deploy-iam-policy.json`](./deploy-iam-policy.json); attach it to the deploy
user/role before the first apply.

**EKS secrets encryption is off by default** (`create_kms_key = false`,
`encryption_config = null` on the `eks` module) so the module deploys under a
least-privileged deploy identity. etcd is still encrypted at rest with the EKS
AWS-managed key. To use a **customer-managed CMK** instead, drop those two lines
and additionally grant the deploy identity: `kms:DescribeKey`, `kms:GetKeyPolicy`,
`kms:PutKeyPolicy`, `kms:GetKeyRotationStatus`, `kms:EnableKeyRotation`,
`kms:CreateGrant`, and `kms:ScheduleKeyDeletion` (the last for `destroy`).
Without those, the CMK path fails the apply mid-way with an AccessDenied.

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
