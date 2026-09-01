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

## Enabling Notifications

See [this](docs/novu-notifications/README.md) to enable notifications.
