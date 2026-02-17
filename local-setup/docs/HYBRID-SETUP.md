# Hybrid Development Setup

> **Note**: For most teams, the [fully remote setup](./REMOTE-DEV-SETUP.md) is simpler — all services on one server, edit via SSH, Tilt rebuilds automatically. Use this hybrid setup when you need local hot reload with sub-second feedback.

Run DIGIT core services on a shared remote server while developing individual services locally with hot reload.

## Architecture

```
Shared Remote Server                    Developer's Machine
┌─────────────────────────┐            ┌─────────────────────────┐
│ docker compose           │            │ tilt up                  │
│                         │            │                         │
│ postgres      :15432   ─┼────────────┼─► pgr-services (mvn)    │
│ redis         :16379   ─┼────────────┼─► digit-ui (yarn)       │
│ redpanda      :19092   ─┼────────────┤                         │
│ mdms          :18094   ─┼────────────┤  Only the services      │
│ user          :18107   ─┼────────────┤  you're working on      │
│ workflow      :18109    │            │  run locally.           │
│ localization  :18096    │            │                         │
│ idgen         :18088    │            │  Everything else is     │
│ enc           :11234    │            │  on the remote.         │
│ accesscontrol :18090    │            │                         │
│ persister     :18091    │            │  Tilt dashboard shows   │
│ filestore     :18084    │            │  only YOUR services +   │
│ hrms          :18092    │            │  remote health links.   │
│ kong          :18000    │            │                         │
│ ...                     │            │                         │
└─────────────────────────┘            └─────────────────────────┘
```

## Setup

### 1. Start core services on the remote server

```bash
ssh dev-server

cd local-setup
docker compose -f docker-compose.yml -f docker-compose.core.yml up -d

# Verify
docker compose ps
```

This starts all infrastructure and core services, but skips PGR, digit-ui, and Jupyter (they have `profiles: [local-dev]` in the override).

### 2. Configure your local environment

```bash
cd local-setup

# Copy templates
cp Tiltfile.hybrid.example Tiltfile
cp .env.hybrid.example .env.hybrid

# Set the remote server address
# Use IP, hostname, or Tailscale address
export DIGIT_REMOTE=192.168.1.100   # or add to .env.hybrid
```

### 3. Choose which services to develop locally

Edit your `Tiltfile` and uncomment the services you're working on:

```python
# Example: Working on PGR
local_resource('pgr-services',
    serve_cmd='cd ' + CCRS_PATH + '/backend/pgr-services && mvn spring-boot:run -DskipTests',
    serve_env=REMOTE_ENV | {
        'SERVER_PORT': '8080',
        'SPRING_KAFKA_CONSUMER_GROUP_ID': 'egov-pgr-services-' + os.getenv('USER', 'dev'),
    },
    ...
)
```

### 4. Start developing

```bash
tilt up
# Dashboard at http://localhost:10350
```

## Networking

Local services connect to the remote via exposed ports. All DIGIT services expose their ports (18000-range) in `docker-compose.yml`.

| Requirement | How it works |
|---|---|
| Local PGR → Remote MDMS | `EGOV_MDMS_HOST=http://REMOTE:18094` |
| Local PGR → Remote Postgres | `SPRING_DATASOURCE_URL=jdbc:postgresql://REMOTE:15432/egov` |
| Local PGR → Remote Kafka | `KAFKA_BOOTSTRAP_SERVERS=REMOTE:19092` |
| Remote Kong → Local PGR | Not automatic (see Kong Routing below) |

### Network options

**Direct IP** (simplest): If both machines are on the same network, use the server's IP.

**SSH tunnels**: Forward specific ports if the server isn't directly reachable.
```bash
ssh -L 15432:localhost:15432 \
    -L 18094:localhost:18094 \
    -L 18107:localhost:18107 \
    -L 18088:localhost:18088 \
    -L 19092:localhost:19092 \
    -L 16379:localhost:16379 \
    dev-server
```
Then set `DIGIT_REMOTE=localhost`.

**Tailscale/WireGuard** (recommended): Both machines on the same mesh. No tunnels, bidirectional, works through NAT.

## Kong Routing

By default, Kong on the remote routes to remote services (e.g. `pgr-services:8080`). If you want requests through Kong to hit your local PGR:

**Option A**: Hit your local service directly (skip Kong).
```bash
curl http://localhost:8080/pgr-services/v2/request/_create ...
```

**Option B**: Update Kong routes on the remote to point to your machine.
```bash
# On the remote, update kong.yml to point PGR upstream to your IP
# Then: docker compose restart kong
```

**Option C**: Run Kong locally too, with routes pointing to your local services + remote core.

For most development, Option A is simplest.

## Multi-Developer Considerations

### Kafka consumer groups

If two developers both run PGR locally, they'd compete for the same Kafka consumer group. The Tiltfile template appends `$USER` to the group ID to avoid this:

```python
'SPRING_KAFKA_CONSUMER_GROUP_ID': 'egov-pgr-services-' + os.getenv('USER', 'dev'),
```

### Shared database

All developers share the same Postgres instance. For most dev work this is fine. If you need isolation:

- Use different tenant IDs for testing (e.g., `pg.citya` vs `pg.cityb`)
- Or run Postgres locally too (add it to your Tiltfile)

### Port conflicts

If two developers run the same service locally, there's no port conflict since they're on different machines. Each developer only runs services on their own laptop.

## Quick Reference

```bash
# Start remote (on the server)
docker compose -f docker-compose.yml -f docker-compose.core.yml up -d

# Stop remote
docker compose down

# Start local dev (on your laptop)
export DIGIT_REMOTE=<server-ip>
tilt up

# Check remote health
curl http://$DIGIT_REMOTE:18094/mdms-v2/health

# View remote logs
ssh dev-server 'cd local-setup && docker compose logs -f egov-user'
```
