# Setup

How to set up the test environment from scratch.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) | v0.50+ | Load test runner |
| [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/) | 2.14+ | Remote machine provisioning |
| Python 3 | 3.10+ | CPU profile script, result collection |
| SSH key | - | Access to test machines (`keys/docker-compose.pem`) |

## Clone the Repository

The repository uses a git submodule for the CCRS platform code. Clone with:

```bash
git clone --recurse-submodules https://github.com/<org>/digit-load-tests.git
cd digit-load-tests
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init
```

## Provision Remote Machines

### AWS Instance Specs

| Role | Instance Type | vCPUs | RAM | Disk | Purpose |
|------|--------------|-------|-----|------|---------|
| Dev | c5.2xlarge (or similar) | 8 | 16 GB | 100 GB gp3 | Smaller machine for baseline |
| Prod | c5.4xlarge (or similar) | 16 | 32 GB | 100 GB gp3 | Larger machine for scale tests |

### Security Groups

Open these ports from the control machine's IP:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH (Ansible + tunnels) |
| 18000 | TCP | Kong API gateway (optional — can use SSH tunnel instead) |

### Run the Setup Playbook

Copy the example inventory and fill in your machine IPs:

```bash
cp ansible/inventory.ini.example ansible/inventory.ini
```

Edit `ansible/inventory.ini` — replace `<DEV_IP>` and `<PROD_IP>` with your machine IPs. Place your SSH key at `keys/docker-compose.pem`. Both files are gitignored.

Run the playbook:

```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook-setup.yml
```

This will:
1. Install Docker Engine and Compose plugin
2. Copy the Docker Compose stack to `/opt/digit/`
3. Pull all container images
4. Start the DIGIT stack
5. Wait for Kong health check (up to 10 minutes)
6. Create 100 citizen test users (`LoadTestCitizen_1` through `LoadTestCitizen_100`)

To use pre-built local images instead of pulling from registries:

```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook-setup.yml -e local_images=true
```

This copies `digit-local-images.tar.gz` to the target and loads it with `docker load`.

## Configure k6 Environment

Copy the example config and fill in your machine IPs:

```bash
cp k6/config/environments.js.example k6/config/environments.js
```

Edit `k6/config/environments.js`:

```javascript
export const ENVS = {
  dev: {
    baseUrl: 'http://<DEV_IP>:18000',
    tenant: 'statea.citya',
    stateTenant: 'statea',
    username: __ENV.DIGIT_USERNAME || 'ADMIN',
    password: __ENV.DIGIT_PASSWORD || 'eGov@123',
  },
  prod: {
    baseUrl: 'http://<PROD_IP>:18000',
    tenant: 'statea.citya',
    stateTenant: 'statea',
    username: __ENV.DIGIT_USERNAME || 'ADMIN',
    password: __ENV.DIGIT_PASSWORD || 'eGov@123',
  },
};
```

### SSH Tunnel Alternative

If your control machine can't reach port 18000 directly, use SSH tunnels:

```bash
# Terminal 1: dev tunnel
ssh -i keys/docker-compose.pem -L 28001:localhost:18000 -N ubuntu@<DEV_IP>

# Terminal 2: prod tunnel
ssh -i keys/docker-compose.pem -L 28002:localhost:18000 -N ubuntu@<PROD_IP>
```

Then set `baseUrl` to `http://localhost:28001` (dev) or `http://localhost:28002` (prod).

## Database Preparation

For testing at scale (>10K records), apply these SQL indexes to prevent performance degradation. Connect to Postgres on the target machine:

```bash
ssh -i keys/docker-compose.pem ubuntu@<TARGET_IP>
docker exec -it docker-postgres psql -U egov -d egov
```

Run all six statements:

```sql
-- 1. Missing FK index on address table (200x improvement)
CREATE INDEX idx_eg_pgr_address_v2_parentid
  ON eg_pgr_address_v2 (parentid);

-- 2. Composite index for workflow tenant+businessservice queries
CREATE INDEX idx_eg_wf_pi_v2_tenant_bsvc
  ON eg_wf_processinstance_v2 (tenantid, businessservice, lastmodifiedtime DESC);

-- 3. Composite index for workflow tenant+businessid lookups
CREATE INDEX idx_wf_pi_tenant_bizid_time
  ON eg_wf_processinstance_v2 (tenantid, businessid, lastmodifiedtime DESC);

-- 4. GIN trigram index for LIKE ANY workaround (32x improvement)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_wf_pi_bizid_trgm
  ON eg_wf_processinstance_v2 USING gin (businessid gin_trgm_ops);

-- 5. Disable JIT for OLTP workloads (4.3x improvement)
ALTER SYSTEM SET jit = off;
SELECT pg_reload_conf();

-- 6. Enable slow query logging (for monitoring)
ALTER SYSTEM SET log_min_duration_statement = 100;
SELECT pg_reload_conf();
```

See [findings.md](findings.md) for the full explanation of each fix.

### Docker Log Rotation

Configure log rotation before long-running tests to prevent disk-full:

```bash
ssh -i keys/docker-compose.pem ubuntu@<TARGET_IP>
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
EOF
sudo systemctl restart docker
```

Existing containers keep their old log settings — only newly created containers pick up the new config. To apply to all containers, recreate them:

```bash
cd /opt/digit-ccrs
docker compose -f docker-compose.deploy.yaml down
docker compose -f docker-compose.deploy.yaml up -d
```

## Verify Setup

Run a smoke test to confirm everything works:

```bash
./scripts/run-test.sh dev baseline smoke
```

Expected output:
- 1 iteration completes
- `transaction_success` rate = 100%
- No HTTP errors
- Results saved to `results/<timestamp>_dev_baseline_smoke/`

If the smoke test fails:
1. Check Kong is healthy: `curl http://<DEV_IP>:18000/user/health`
2. Check containers are running: `ssh ubuntu@<DEV_IP> "docker compose -f /opt/digit-ccrs/docker-compose.deploy.yaml ps"`
3. Check k6 can reach the target: the error message will indicate connection refused vs auth failure vs API error
