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

The identity that runs `terraform apply`/`destroy` creates and destroys a VPC,
EKS, RDS, S3, IAM roles, and the cluster's load balancer. The policy covering the
full lifecycle is checked in at
[`deploy-iam-policy.json`](./deploy-iam-policy.json); attach it to the deploy
user/role before the first apply. It is intentionally structured for a
least-privilege review:

- **`InfraLifecycle`** — the EC2/EKS/RDS/KMS/etc. actions on `*`, including the
  KMS actions for the optional customer-managed CMK. It intentionally carries
  **no** `elasticloadbalancing` permissions: the cluster's ELB is created and
  destroyed by Kubernetes, so it is removed by deleting the `LoadBalancer`
  Service before `terraform destroy` (see the Teardown section), not by the
  deploy identity.
- **`ScopedIamWrites`** — the privilege-escalation-sensitive IAM write actions
  (`CreateUser`, `CreateRole`, `AttachUserPolicy`, `PassRole`, …) are **NOT** on
  `*`. They are scoped by ARN to only the resources this module creates
  (`user/*-filestore-user`, `role/*-cluster-*`, `role/*-eks-node-group-*`,
  `role/ebs-csi-driver-*`, the two module policies, and the EKS OIDC provider).
  So the deploy identity cannot create an arbitrary IAM user/role and attach
  admin to it. IAM read (`Get*`/`List*`) stays broad.
- **`ScopedS3BucketMgmt` / `ScopedS3Objects`** — S3 write/delete is scoped to the
  deployment's own buckets (`*-assets-bucket`, `*-filestore-bucket`) and, for
  objects only, the terraform state bucket (`*-tfstate-*/*`, which the S3 backend
  must write). So it cannot create or delete arbitrary buckets or objects. S3
  read (`Get*`/`ListBucket`) stays broad.

If a future change to the module introduces a differently-named IAM resource, the
apply will fail with an IAM `AccessDenied` and the corresponding ARN pattern in
`ScopedIamWrites` needs widening — that is the intended trade-off for not holding
`iam:*` on `*`.

**EKS secrets encryption is off by default** (`create_kms_key = false`,
`encryption_config = null` on the `eks` module); etcd is still encrypted at rest
with the EKS AWS-managed key. The KMS actions in the policy are only exercised if
you opt into a customer CMK by dropping those two lines.

## Teardown — delete Kubernetes LoadBalancers FIRST

**Before `terraform destroy`, delete every Kubernetes `Service` of type
`LoadBalancer` and wait for the cloud ELB to disappear.** The in-cluster ingress
controller creates its ELB through the AWS cloud controller — terraform does not
manage it. If you destroy the cluster while that Service still exists, the ELB is
orphaned and its ENIs stay attached in the public subnets, which blocks subnet +
Internet Gateway deletion and hangs the destroy on `DependencyViolation`.

```bash
# delete the LB services (ingress-nginx and any others) while the cluster is
# alive; the controller then deletes the cloud ELB for you. --wait blocks until
# the Service (and its ELB) are actually gone.
kubectl delete svc -A --field-selector spec.type=LoadBalancer --wait=true
# confirm none remain (via kubectl — no cloud LB permission needed)
kubectl get svc -A --field-selector spec.type=LoadBalancer
# only then:
terraform destroy
```

Because the ELB is removed by the cluster (not the deploy identity), the deploy
policy needs **no** `elasticloadbalancing` permissions — it stays purely
terraform-scoped. If you skip this step and destroy the cluster first, the ELB is
orphaned and its ENIs block subnet + IGW deletion; recovering then requires
someone with `elasticloadbalancing:DeleteLoadBalancer` to delete it manually.

## Documentation

Refer to our [Core Infrastructure Documentation](https://core.digit.org/guides/installation-guide/infrastructure-setup/aws/3.-provision-infrastructure) to deploy the infrastructure end-to-end.

## cms-saas.digit.org

The production cms-saas cluster (EKS `ccrs-prod`, AWS account 349271159511) is
managed from this directory with the files in `environments/`:

| File | In git | What |
|---|---|---|
| `cms-saas.tfvars` | yes | every input the deployment runs with |
| `cms-saas.s3.tfbackend` | yes | state bucket, key and lock table; overrides `main.tf`'s `REPLACE_ME` |
| `cms-saas.remote-state.backend.tf` | yes | backend of the `remote-state/` stack (the state bucket itself) |
| `cms-saas.secret.tfvars` | **no** | `db_password` (the RDS master password), shared within the team out of band |

```bash
terraform init -reconfigure -backend-config=environments/cms-saas.s3.tfbackend
terraform plan -var-file=environments/cms-saas.tfvars -var-file=environments/cms-saas.secret.tfvars
```

Both stacks keep their state in `s3://ccrs-prod-tfstate-349271159511`:
`terraform-setup/terraform.tfstate` (this stack) and
`remote-state/terraform.tfstate` (the bucket and lock table). To work on the
latter:

```bash
cp environments/cms-saas.remote-state.backend.tf remote-state/backend_override.tf   # git-ignored
cd remote-state && terraform init -reconfigure
terraform plan -var=bucket_name=ccrs-prod-tfstate-349271159511
```

**Before an apply, read the plan.** As of 2026-10-28 it reports no create or
destroy, and four in-place updates that are not input drift: the EKS module
tracks the newest node AMI release and `vpc-cni` add-on, so an apply rolls the
worker nodes onto the new AMI and upgrades the add-on, and the EBS CSI
driver's IAM documents show as known after apply.
