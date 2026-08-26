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

- **`InfraLifecycle`** — the EC2/EKS/RDS/S3/KMS/ELB/etc. actions on `*`. This
  includes `elasticloadbalancing:DescribeLoadBalancers` + `DeleteLoadBalancer`
  (required to remove the ingress ELB on teardown — without them the VPC cannot
  be destroyed) and the KMS actions for the optional customer-managed CMK.
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
# remove the LB services (ingress-nginx and any others) while the cluster is alive
kubectl delete svc -A --field-selector spec.type=LoadBalancer
# confirm the ELB is gone before proceeding (needs elasticloadbalancing:Describe*)
aws elb describe-load-balancers --region <region> \
  --query 'LoadBalancerDescriptions[].LoadBalancerName'
# only then:
terraform destroy
```

`deploy-iam-policy.json` includes `elasticloadbalancing:DescribeLoadBalancers` +
`DeleteLoadBalancer` so the deploy identity can detect and clean up an ELB that
was orphaned anyway. Without those, a least-privileged deploy user cannot remove
the orphan and the VPC teardown cannot complete.

## Documentation

Refer to our [Core Infrastructure Documentation](https://core.digit.org/guides/installation-guide/infrastructure-setup/aws/3.-provision-infrastructure) to deploy the infrastructure end-to-end.
