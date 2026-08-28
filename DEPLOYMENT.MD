# Deployment Process

## Hardware Requirements

1. CPU - 8vCPU+
2. Ram - 32GB+
3. Free Disk - 100GB+
4. OS - Ubuntu 22.04+

## Clone the repository (ideally a tagged release)

```bash
git clone --branch v2.12-beta --depth 1 \
  https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System
```

## Install Pre-requisites

```bash
cd local-setup/scripts
./install-prereqs.sh
```

## Configure Ansible Variables


### Create a copy of default variables file

```bash
cd ../ansible                 # local-setup/ansible
cp inventory/host_vars/quickstart.yml.example inventory/host_vars/mycity.yml
```

### Update the variables listed below for deployment (rest are best defaults)

 Setting | What it is | Example |
|---|---|---|
| `state_root` | Your top-level tenant: the country or state. Lowercase, no dots. Creating it is what the deploy does. | `kenya` |
| `state_tenant_id` | The tenant the browser apps authenticate against. Keep it the same as `state_root`. | `kenya` |
| `tenant_id` | Your **city** tenant, where complaints actually live. Must start with `<state_root>.` | `kenya.nairobi` |
| `boot_tenant` | Default tenant for the citizen app. Same as `tenant_id` is right. | `kenya.nairobi` |
| `ui_state_tenant_id` | The tenant the app lands on after login. Point at the **city**. | `kenya.nairobi` |
| `login_tenant_allowlist` | Which tenants appear in the login screen's City dropdown. List both. | `[kenya, kenya.nairobi]` |
| `map_center` | Where the complaint map opens. **Required — the deploy fails without it.** | `{lat: -1.2864, lng: 36.8172}` |
| `pgr_boundary_highest_level`<br>`pgr_boundary_lowest_level`<br>`boundary_type` | What your administrative areas are called, largest first. These are labels on the complaint form, so use the words your staff use. | `County`, `Ward`, `Ward` |
| `core_mobile_configs` | Your country's phone-number rule. Get this wrong and every citizen signup is rejected. | `+254` / `^0?[17][0-9]{8}$` |
| `core_postal_configs` | Your country's postcode rule. | `^[0-9]{5}$` |
| `secrets_path` | Where this deployment's secrets are filed inside the secret store. Just a path. | `kv/digit/mycity` |
| `ansible_host` | IP of the machine, if deploying on a remote machine. Remove `ansible_connection: local` line in this case | |
| `domain` | If needs to be deployed on a domain name vs localhost. Also, set `tls_enabled:true` in this case | | 
| `bootstrap_user` | Admin Username (defaults to ADMIN) | | 
| `bootstrap_password` | Admin Password (defaults to eGov@123) | |


## Start Deployment

```bash
./deploy.sh mycity (name of vars file)
```

It takes around 60 minutes, use `tail -f /opt/digit/digit-stack-up.mycity.progress` to view logs

## Accessing Services


| What | URL (local deployment) | Login Details |
|---|---|---|
| Employee app | http://localhost/digit-ui/employee | Admin Username, Admin Password |
| Citizen app | http://localhost/digit-ui/citizen | Mobile Number with OTP (default otp 123456 if unchanged) |
| Configurator | http://localhost/configurator/ | Admin Username, Admin Password, State Tenant ID |
| Health dashboard | http://localhost/status/ | |
| Dashboards (Grafana) | http://localhost/grafana/ | Username - admin, for password use `sudo docker exec -e BAO_TOKEN="$(sudo jq -r .root_token /opt/digit/.openbao/init.json)" openbao bao kv get -field=grafana_admin_password kv/digit/mycity` |

Use domain name instead of localhost, if used one during configuration.

---

# Kubernetes Deployment (AWS)

The steps above run everything on a single machine — great for a demo or a small
city. For a bigger, always-on deployment that can grow with demand, DIGIT can run
on Amazon's managed Kubernetes (EKS). This path sets up the cloud infrastructure
for you and then installs DIGIT onto it.

It's more involved than the single-machine path, so it assumes you're comfortable
with an AWS account and a terminal.

## What you'll need

- An AWS account, and permission to create things in it. There's a ready-made
  permissions file at
  `devops/infra-as-code/terraform/sample-aws/deploy-iam-policy.json` — hand it to
  your AWS admin to attach to your user once, and it covers everything from
  creating the setup to tearing it down.
- A few command-line tools installed: `terraform`, the `aws` CLI, `kubectl`,
  `helm`, and `helmfile`.

> **One thing to watch: tool versions.** Use **Helm 3** and **Helmfile 0.x**. The
> newest Helm (4) and Helmfile (1.x) changed things these charts depend on and
> will fail. If you hit a strange error right at the start, this is almost always
> why.

## Step 1 — Create the cloud infrastructure

This sets up the whole environment: the network, the Kubernetes cluster, a
Postgres database, and the file storage. It's two quick parts.

**First, give Terraform a place to keep its notes.** Terraform records what it
builds (its "state") in an S3 bucket, with a small table alongside it so two
people can't run it at the same time. A helper creates both — you just pick a name:

```bash
cd devops/infra-as-code/terraform/sample-aws/remote-state
terraform init
terraform apply -var="bucket_name=mycity-tfstate-4821"   # must be globally unique
cd ..
```

Then open `main.tf` and, near the top, replace the two
`<terraform_state_bucket_name>` markers with that same name **in quotes**:

```hcl
    bucket         = "mycity-tfstate-4821"
    dynamodb_table = "mycity-tfstate-4821"
```

> **About the `<...>` markers.** Throughout these files, anything in angle
> brackets is a "fill this in" placeholder. Always replace it with a real value
> **in quotes** — leaving the brackets, or dropping the quotes, is the most
> common cause of a confusing error at this first step.

**Now create everything.** Open `variables.tf` and set these values (again, real
values in quotes):

| In `variables.tf` | What it is | Example |
|---|---|---|
| `cluster_name` | A name for your Kubernetes cluster. | `"mycity"` |
| `db_name` | A name for the database. | `"ccrsdb"` |
| `db_username` | The database's admin username. | `"ccrs"` |
| `db_password` | The database password. It has **no default**, so also add a line `db_password = "…"` in a `terraform.tfvars` file (or Terraform will ask for it each run). | |

The rest of `variables.tf` already has sensible defaults (region, Kubernetes
version, database size, number of servers) — leave them unless you have a reason
to change them. Then:

```bash
terraform init
terraform plan      # shows what it will create
terraform apply     # creates it (takes ~20-30 minutes)
```

When it finishes, connect your terminal to the new cluster:

```bash
aws eks update-kubeconfig --name <your-cluster-name> --region <your-region>
```

## Step 2 — Fill in your deployment details

Two files under `devops/deploy-as-code/charts/environments/` hold your settings.

In **`env.yaml`**, replace the placeholders:

| Setting | What it is | Example |
|---|---|---|
| `domain` | The web address people will use to reach the apps. | `cms.mydomain.com` |
| `db-host` | The address of the database you just created (Terraform prints it at the end). | `mycity-db.xxxx.rds.amazonaws.com` |
| `fixed-bucketname` | The storage bucket for uploaded files (photos on complaints, etc.). | `mycity-filestore` |
| `assets_s3_bucket` | The storage bucket that serves the app's front-end files. | `mycity-assets` |
| `tenant_id` | Your tenant's short name. The bundled sample data uses `pg`; keep that unless you know you need your own. | `pg` |

In **`env-secrets.yaml`**, set your database username and password.

> **A note on secrets.** This file lives in the public code, so it must **not**
> contain real passwords for anything sensitive. For the notification service,
> you create its keys yourself and keep them in the cluster only. Run this once
> before deploying:
>
> ```bash
> kubectl -n backbone create secret generic novu-secrets \
>   --from-literal=jwt-secret=$(openssl rand -hex 24) \
>   --from-literal=store-encryption-key=$(openssl rand -hex 16) \
>   --from-literal=novu-secret-key=$(openssl rand -hex 24)
> ```

## Step 3 — Install DIGIT

DIGIT starts with a ready-made set of sample data (roles, labels, a default
tenant). To load it, open
`charts/backbone-services/backboneservices-helmfile.yaml` and set the `db-seed`
entry to `installed: true`. Then install everything:

```bash
cd devops/deploy-as-code
helmfile -f digit-helmfile.yaml -e env apply
```

The first run takes a while — the services set up their databases and start up
one by one. Watch progress with `kubectl get pods -A`; you're waiting for
everything to reach `Running`. The admin account is created for you in the
background once the user service is ready.

**Want the dashboards too?** Monitoring (Grafana) and the health page (Gatus) are
off by default. To turn them on, un-comment the monitoring line in
`digit-helmfile.yaml`, switch the `monitoring` toggles on in `env.yaml` (including
`gatus`), create a `grafana-admin` secret the same way as above, and run the
install command again.

## Step 4 — Add your city

Open the **Configurator** at `https://<your-domain>/configurator/` and sign in
with the admin user (`ADMIN` / `eGov@123` unless you changed it) and your tenant
name. From there you upload your city and boundary sheets to get it running —
exactly like the single-machine setup.

> Setting up a whole new **country/state** (rather than a city under the sample
> one) needs a few extra setup steps behind the scenes — ask the DIGIT team if
> that's what you need.

## Accessing Services

| What | URL | Login Details |
|---|---|---|
| Employee app | `https://<your-domain>/digit-ui/` | Admin Username, Admin Password |
| Citizen app | `https://<your-domain>/citizen` | Mobile Number with OTP |
| Configurator | `https://<your-domain>/configurator/` | Admin Username, Admin Password, Tenant name |
| Health dashboard | `https://<your-domain>/status/` | |
| Dashboards (Grafana) | `https://<your-domain>/monitoring` | Username `admin`, password from the `grafana-admin` secret |

## Taking it down

When you want to remove everything, there's **one important step first**: delete
the load balancers Kubernetes created, *before* tearing down the infrastructure.
If you skip this, a leftover load balancer keeps the network alive and the
teardown gets stuck.

```bash
kubectl delete svc -A --field-selector spec.type=LoadBalancer
cd devops/infra-as-code/terraform/sample-aws
terraform destroy
```












