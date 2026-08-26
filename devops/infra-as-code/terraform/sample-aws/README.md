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

The identity that runs `terraform apply` needs a broad set of permissions —
it creates a VPC, EKS, RDS, S3, IAM roles, and (by default) a customer-managed
**KMS key for EKS secrets encryption**. The complete policy is checked in at
[`deploy-iam-policy.json`](./deploy-iam-policy.json); attach it to the deploy
user/role before the first apply.

Note the KMS actions specifically: the module's default
`cluster_encryption_config` provisions a CMK, so the policy must include
`kms:CreateKey`, `DescribeKey`, `PutKeyPolicy`, `EnableKeyRotation`,
`CreateGrant`, and `ScheduleKeyDeletion` (for destroy). Omitting these fails the
apply mid-way with an AccessDenied on the KMS key. If you deliberately run
without a CMK, set `create_kms_key = false` + `encryption_config = null` on the
`eks` module instead (etcd is still encrypted at rest with an AWS-managed key).

## Documentation

Refer to our [Core Infrastructure Documentation](https://core.digit.org/guides/installation-guide/infrastructure-setup/aws/3.-provision-infrastructure) to deploy the infrastructure end-to-end.
