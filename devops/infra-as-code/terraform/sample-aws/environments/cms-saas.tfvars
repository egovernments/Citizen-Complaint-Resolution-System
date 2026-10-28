# cms-saas.digit.org (EKS ccrs-prod, AWS 349271159511, ap-south-1).
#
# Every input this deployment was built with, set explicitly so a change to a
# default in variables.tf cannot change production unnoticed. Secrets are not
# here: db_password is in environments/cms-saas.secret.tfvars (git-ignored,
# shared with the team out of band).
#
#   terraform init -reconfigure -backend-config=environments/cms-saas.s3.tfbackend
#   terraform plan -var-file=environments/cms-saas.tfvars -var-file=environments/cms-saas.secret.tfvars

cluster_name       = "ccrs-prod"
kubernetes_version = "1.35"

vpc_cidr_block             = "192.168.0.0/16"
network_availability_zones = ["ap-south-1a", "ap-south-1b"]
# The worker nodes' zone.
availability_zones = ["ap-south-1b"]

architecture   = "x86_64"
instance_types = [] # empty = instance_types_map[architecture]
instance_types_map = {
  x86_64 = ["m5a.xlarge"]
  arm64  = ["t4g.xlarge"]
}
# min 2: raised from the August value of 1 on the cluster since, kept as running.
min_worker_nodes = "2"
# desired applies at creation only: the node group ignores later changes to it
# (the cluster runs 4 as of 2026-10-28).
desired_worker_nodes = "2"
max_worker_nodes     = "4"

db_name           = "ccrsdb"
db_username       = "ccrs"
db_version        = "15.18"
db_instance_class = "db.t3.medium"
# RDS was created unpinned and placed in ap-south-1a, not the workers' zone.
# Changing an instance's zone replaces it, so keep it where it is.
db_availability_zone = "ap-south-1a"

filestore_namespace = "egov"
