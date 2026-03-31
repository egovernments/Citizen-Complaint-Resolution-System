terraform {
  backend "s3" {
    bucket = <terraform_state_bucket_name>
    key    = "terraform-setup/terraform.tfstate"
    region = "ap-south-1"
    # The below line is optional depending on whether you are using DynamoDB for state locking and consistency
    dynamodb_table = <terraform_state_bucket_name>
    # The below line is optional if your S3 bucket is encrypted
    encrypt = true
  }
  required_providers {
    kubernetes = {
      source = "hashicorp/kubernetes"
      version = "2.37.1"
    }
  }
}

locals {
  az_to_find           = var.availability_zones[0]
  az_index_in_network  = index(var.network_availability_zones, local.az_to_find)
  ami_type_map = {
    x86_64 = "AL2023_x86_64_STANDARD"
    arm64  = "AL2023_ARM_64_STANDARD"
  }

  # Use user-specified instance_types if provided, else choose from map
  selected_instance_types = length(var.instance_types) > 0 ? var.instance_types : var.instance_types_map[var.architecture]
}

resource "aws_iam_user" "filestore_user" {
  name = "${var.cluster_name}-filestore-user"

  tags = {
    "KubernetesCluster" = var.cluster_name
    "Name"              = var.cluster_name
  }
}

resource "aws_iam_access_key" "filestore_key" {
  user    = aws_iam_user.filestore_user.name
}

resource "kubernetes_namespace" "namespace" {
  metadata {
    name = var.filestore_namespace
  }
}

resource "kubernetes_secret" "egov-filestore" {
  depends_on  = [kubernetes_namespace.namespace]
  metadata {
    name      = "egov-filestore"
    namespace = var.filestore_namespace  # Change this as needed
  }

  data = {
    awssecretkey = aws_iam_access_key.filestore_key.secret
    awskey       = aws_iam_access_key.filestore_key.id
  }

  type = "Opaque"
}

resource "aws_s3_bucket" "assets_bucket" {
  bucket = "${var.cluster_name}-assets-bucket"

  tags = {
    "KubernetesCluster" = var.cluster_name
    "Name"              = var.cluster_name
  }
}

resource "aws_s3_bucket_public_access_block" "assets_bucket_access" {
  bucket = aws_s3_bucket.assets_bucket.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "assets_bucket_policy" {
  depends_on = [aws_s3_bucket_public_access_block.assets_bucket_access]
  bucket = aws_s3_bucket.assets_bucket.id
  policy = data.aws_iam_policy_document.assets_bucket_policy.json
}

data "aws_iam_policy_document" "assets_bucket_policy" {
  depends_on = [aws_s3_bucket_public_access_block.assets_bucket_access]
  statement {
    sid           = "PublicReadGetObject"
    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = [
      "s3:GetObject",
    ]

    resources = [
      "${aws_s3_bucket.assets_bucket.arn}/*",
    ]
  }
}

resource "aws_s3_bucket" "filestore_bucket" {
  bucket = "${var.cluster_name}-filestore-bucket"

  tags = {
    "KubernetesCluster" = var.cluster_name
    "Name"              = var.cluster_name
  }
}

resource "aws_s3_bucket_public_access_block" "filestore_bucket_access" {
  bucket = aws_s3_bucket.filestore_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "filestore_bucket_policy" {
  depends_on = [aws_s3_bucket_public_access_block.filestore_bucket_access]
  bucket = aws_s3_bucket.filestore_bucket.id
  policy = data.aws_iam_policy_document.filestore_bucket_policy.json
}

data "aws_iam_policy_document" "filestore_bucket_policy" {
  depends_on = [aws_s3_bucket_public_access_block.filestore_bucket_access]
  statement {
    sid           = "PublicReadGetObject"
    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = [
      "s3:GetObject",
    ]

    resources = [
      "${aws_s3_bucket.filestore_bucket.arn}/*",
    ]
  }
}

resource "aws_iam_policy" "filestore_policy" {
  name        = "${var.cluster_name}-filestore_policy"  # Replace with your desired policy name
  description = "Filestore Policy for S3 access"
  policy = jsonencode({
    "Version" = "2012-10-17"
    "Statement" = [
      {
        "Effect" = "Allow"
        "Action" = [
          "s3:GetBucketLocation",
          "s3:ListAllMyBuckets"
        ]
        "Resource" = "arn:aws:s3:::*"
      },
      {
        "Effect" = "Allow"
        "Action" = [
          "s3:*"
        ]
        "Resource" = "${aws_s3_bucket.filestore_bucket.arn}" # Allow access to the bucket
      },
      {
        "Effect" = "Allow"
        "Action" = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        "Resource" = "${aws_s3_bucket.filestore_bucket.arn}/*" # Allow access to objects in the bucket
      }
    ]
  })
}

resource "aws_iam_user_policy_attachment" "filestore_attachment" {
  user       = "${aws_iam_user.filestore_user.name}"  # Reference the IAM user
  policy_arn = "${aws_iam_policy.filestore_policy.arn}" # Reference the policy
}

module "network" {
  source             = "../modules/kubernetes/aws/network"
  vpc_cidr_block     = "${var.vpc_cidr_block}"
  cluster_name       = "${var.cluster_name}"
  availability_zones = "${var.network_availability_zones}"
}

# PostGres DB
module "db" {
  source                        = "../modules/db/aws"
  subnet_ids                    = "${module.network.private_subnets}"
  vpc_security_group_ids        = ["${module.network.rds_db_sg_id}"]
  availability_zone             = "${element(var.availability_zones, 0)}"
  instance_class                = var.db_instance_class  ## postgres db instance type
  engine_version                = var.db_version   ## postgres version
  storage_type                  = "gp3"
  storage_gb                    = "20"     ## postgres disk size
  backup_retention_days         = "7"
  administrator_login           = "${var.db_username}"
  administrator_login_password  = "${var.db_password}"
  identifier                    = "${var.cluster_name}-db"
  db_name                       = "${var.db_name}"
  environment                   = "${var.cluster_name}"
}

data "aws_caller_identity" "current" {}

module "eks" {
  source          = "terraform-aws-modules/eks/aws"
  version         = "~> 21.0"
  name    = var.cluster_name
  kubernetes_version = var.kubernetes_version
  vpc_id          = module.network.vpc_id
  enable_cluster_creator_admin_permissions = true
  endpoint_public_access  = true
  endpoint_private_access = true
  authentication_mode = "API_AND_CONFIG_MAP"
  create_cloudwatch_log_group = false
  subnet_ids      = concat(module.network.private_subnets, module.network.public_subnets)
  node_security_group_additional_rules = {
    ingress_self_ephemeral = {
      description = "Node to node communication"
      protocol    = "-1"
      from_port   = 0
      to_port     = 0
      type        = "ingress"
      self        = true
    }
  }
  addons = {
    vpc-cni = {
      most_recent              = true
      before_compute           = true
      configuration_values = jsonencode({
        env = {
          # Reference docs https://docs.aws.amazon.com/eks/latest/userguide/cni-increase-ip-addresses.html
          ENABLE_PREFIX_DELEGATION           = "true"
        }
      })
    }
  }
  compute_config = {
    enabled    = false
  }
  tags = {
    "KubernetesCluster" = var.cluster_name
    "Name"              = var.cluster_name
  }
}

module "eks_managed_node_group" {
  source = "terraform-aws-modules/eks/aws//modules/eks-managed-node-group"
  version         = "~> 21.0"
  name            = "${var.cluster_name}-spot"
  ami_type        = local.ami_type_map[var.architecture]
  cluster_name    = var.cluster_name
  kubernetes_version = var.kubernetes_version
  subnet_ids      = [module.network.private_subnets[local.az_index_in_network]]
  vpc_security_group_ids  = [module.eks.node_security_group_id]
  cluster_service_cidr = module.eks.cluster_service_cidr
  use_custom_launch_template = true
  launch_template_name = "${var.cluster_name}-lt"
  block_device_mappings = {
    xvda = {
      device_name = "/dev/xvda"
      ebs = {
        volume_size           = 100
        volume_type           = "gp3"
        delete_on_termination = true
      }
    }
  }
  min_size     = var.min_worker_nodes
  max_size     = var.max_worker_nodes
  desired_size = var.desired_worker_nodes
  instance_types = local.selected_instance_types
  ebs_optimized  = "true"
  iam_role_additional_policies = {
    CSI_DRIVER_POLICY = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
    AmazonSSMManagedInstanceCore = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
    SQS_POLICY                   = "arn:aws:iam::aws:policy/AmazonSQSFullAccess"
  }
  update_config = {
    "max_unavailable_percentage": 10
  }
  labels = {
    Environment = var.cluster_name
  }
  tags = {
    "KubernetesCluster" = var.cluster_name
    "Name"              = var.cluster_name
  }
}

module "ebs_csi_driver_irsa" {
  depends_on = [module.eks]
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.20"
  role_name_prefix = "ebs-csi-driver-"
  attach_ebs_csi_policy = true
  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
  tags = {
    "KubernetesCluster" = var.cluster_name
    "Name"              = var.cluster_name
  }
}

resource "aws_security_group_rule" "rds_db_ingress_workers" {
  description              = "Allow node groups to communicate with RDS database"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = module.network.rds_db_sg_id
  source_security_group_id = module.eks.node_security_group_id
  type                     = "ingress"
}

# Fetching EKS Cluster Data after its creation
data "aws_eks_cluster" "cluster" {
  depends_on = [module.eks_managed_node_group]
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "cluster" {
  depends_on = [module.eks_managed_node_group]
  name = var.cluster_name
}

data "aws_iam_openid_connect_provider" "oidc_arn" {
  depends_on = [module.eks_managed_node_group]
  url = data.aws_eks_cluster.cluster.identity.0.oidc.0.issuer
}

resource "aws_eks_addon" "kube_proxy" {
  depends_on = [module.eks_managed_node_group]
  cluster_name      = var.cluster_name
  addon_name        = "kube-proxy"
  resolve_conflicts_on_create = "OVERWRITE"
}

resource "aws_eks_addon" "core_dns" {
  depends_on = [module.eks_managed_node_group]
  cluster_name      = var.cluster_name
  addon_name        = "coredns"
  resolve_conflicts_on_create = "OVERWRITE"
}

resource "aws_eks_addon" "aws_ebs_csi_driver" {
  depends_on = [module.eks_managed_node_group]
  cluster_name      = var.cluster_name
  addon_name        = "aws-ebs-csi-driver"
  service_account_role_arn = module.ebs_csi_driver_irsa.iam_role_arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}


provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    args        = ["eks", "get-token", "--cluster-name", var.cluster_name]
    command     = "aws"
  }
}

resource "kubernetes_storage_class" "ebs_csi_encrypted_gp3_storage_class" {
  metadata {
    name = "gp3"
    annotations = {
      "storageclass.kubernetes.io/is-default-class" : "true"
    }
  }

  storage_provisioner    = "ebs.csi.aws.com"
  reclaim_policy         = "Delete"
  allow_volume_expansion = true
  volume_binding_mode    = "Immediate"
  parameters = {
    fsType    = "ext4"
    encrypted = true
    type      = "gp3"
  }
}

