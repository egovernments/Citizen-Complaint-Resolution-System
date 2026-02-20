# Fully Remote Development Setup

All services run on a shared remote server. Developers edit code that triggers rebuilds of downstream services (PGR, digit-ui) on the remote. Since these are the most downstream services (nothing depends on them), rebuilds don't disrupt core infrastructure.

## Architecture

```
Developer's Machine                Remote Server
┌────────────────────────┐        ┌──────────────────────────────────┐
│                        │        │                                  │
│ VS Code Remote SSH     │──SSH──▶│  Code: ~/code/ccrs/              │
│  (or any SSH editor)   │        │                                  │
│                        │        │  tilt up (runs here)             │
│ Browser ───────────────┼──SSH──▶│  Tilt dashboard :10350           │
│  localhost:10350       │ tunnel │                                  │
│                        │        │  Docker daemon                   │
│ Browser ───────────────┼──SSH──▶│  ┌────────────────────────────┐  │
│  localhost:18000       │ tunnel │  │ postgres  redis  redpanda  │  │
│                        │        │  │ mdms  user  workflow  ...  │  │
│                        │        │  │ pgr-services  digit-ui     │  │
│                        │        │  └────────────────────────────┘  │
│                        │        │                                  │
│ File changes on server │        │  Tilt watches source dirs →      │
│ (via SSH editor)       │        │  rebuilds → redeploys container  │
└────────────────────────┘        └──────────────────────────────────┘
```

## How It Works

1. All Docker containers run on the remote server
2. Developer edits code on the server (via SSH editor or file sync)
3. Tilt (running on the server) watches source directories
4. When PGR Java or UI React source changes, Tilt rebuilds the image and restarts the container
5. Core services (postgres, mdms, user, workflow, etc.) keep running — only downstream services rebuild

## Setup

### 1. On the remote server

```bash
# Clone the CCRS repo
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git ~/code/ccrs
cd ~/code/ccrs/local-setup

# Start everything with Tilt
tilt up

# Or start in headless mode (no terminal UI)
tilt up --stream
```

### 2. Connect from your machine

**Option A: VS Code Remote SSH (recommended)**

1. Install [VS Code Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) extension
2. Connect to the remote server
3. Open `~/code/ccrs` as workspace
4. Edit code — Tilt detects changes and rebuilds automatically

**Option B: Any SSH editor**

```bash
# SSH into the server
ssh dev-server

# Edit with vim, nano, emacs, etc.
vim ~/code/ccrs/backend/pgr-services/src/main/java/...
```

### 3. Access the dashboard and services

Forward ports via SSH:

```bash
# Forward Tilt dashboard + Kong gateway + DIGIT UI
ssh -L 10350:localhost:10350 \
    -L 18000:localhost:18000 \
    -L 18080:localhost:18080 \
    dev-server
```

Or use the convenience script:

```bash
# On the remote server
cd ~/code/ccrs/local-setup
./scripts/remote-dev.sh start

# From your machine
./scripts/remote-dev.sh tunnel dev-server
```

Then open:
- **Tilt dashboard**: http://localhost:10350
- **DIGIT UI**: http://localhost:18000/digit-ui/
- **Kong Gateway**: http://localhost:18000

## Alternative: Local File Sync

If you prefer editing on your local machine with your local editor setup, use file sync to push changes to the remote:

### Using mutagen

```bash
# Install mutagen
brew install mutagen-io/mutagen/mutagen  # macOS
# Or: https://mutagen.io/documentation/introduction/installation

# Start sync session (local → remote)
mutagen sync create \
    ./backend/pgr-services/src \
    dev-server:~/code/ccrs/backend/pgr-services/src \
    --name=pgr-sync

mutagen sync create \
    ./frontend/micro-ui/web/src \
    dev-server:~/code/ccrs/frontend/micro-ui/web/src \
    --name=ui-sync

# Edit locally — files sync to remote in ~1s — Tilt detects and rebuilds
```

### Using rsync (manual or via fswatch)

```bash
# One-shot sync
rsync -avz --delete \
    ./backend/pgr-services/src/ \
    dev-server:~/code/ccrs/backend/pgr-services/src/

# Auto-sync on file changes (macOS)
fswatch -o ./backend/pgr-services/src | while read; do
    rsync -avz --delete \
        ./backend/pgr-services/src/ \
        dev-server:~/code/ccrs/backend/pgr-services/src/
done
```

## Alternative: DOCKER_HOST over SSH

Tilt can run locally while managing containers on the remote Docker daemon:

```bash
# Set Docker to use remote daemon
export DOCKER_HOST=ssh://user@dev-server

# Run Tilt locally — builds and containers execute on remote
cd local-setup
tilt up
```

**Caveat**: Docker Compose volume mounts (like `./db/seed.sql:/docker-entrypoint-initdb.d/seed.sql`) reference paths on the Docker host (remote server). The repo must be cloned at the same path on the remote, or use `docker context` with path mapping.

For most setups, the SSH editor or file sync approach is simpler.

## What Rebuilds and What Doesn't

| Service | Rebuilds on code change? | Why |
|---------|--------------------------|-----|
| pgr-services | Yes | Developer works on PGR Java code |
| digit-ui | Yes | Developer works on React UI code |
| postgres, redis, redpanda | No | Infrastructure — always running |
| mdms, user, workflow, idgen, etc. | No | Core services — stable, no local source |
| kong | No | Gateway config — rarely changes |

PGR and digit-ui are the most downstream services — nothing else depends on them, so rebuilding is safe and non-disruptive.

## Multi-Developer on One Server

### Git worktrees (recommended)

Each developer works in their own worktree:

```bash
# Developer A
cd ~/code/ccrs
git worktree add ../ccrs-alice feature/alice-pgr-changes

# Developer B
git worktree add ../ccrs-bob feature/bob-ui-changes
```

Only one Tilt instance manages Docker Compose at a time. Developers coordinate who "owns" the Tilt session, or use separate compose projects:

```bash
# Developer A
cd ~/code/ccrs-alice/local-setup
COMPOSE_PROJECT_NAME=digit-alice tilt up

# Developer B
cd ~/code/ccrs-bob/local-setup
COMPOSE_PROJECT_NAME=digit-bob tilt up
```

**Note**: Separate compose projects mean separate sets of ALL containers (including core services), which uses more memory. For a small team, sharing one set of core services and coordinating on downstream rebuilds is more practical.

### Shared core, separate downstream

For teams that need isolation on downstream services only:

1. Start core services once:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.core.yml up -d
   ```

2. Each developer runs their downstream services using the [hybrid setup](./HYBRID-SETUP.md):
   ```bash
   cp Tiltfile.hybrid.example Tiltfile.local
   export DIGIT_REMOTE=localhost  # since everything is on the same server
   tilt up -f Tiltfile.local
   ```

## Port Forwarding Reference

Forward these ports to access services from your machine:

| Port | Service | Required? |
|------|---------|-----------|
| 10350 | Tilt dashboard | Yes |
| 18000 | Kong gateway (API + UI) | Yes |
| 18080 | DIGIT UI (direct) | Optional |
| 18094 | MDMS | Optional |
| 18107 | User service | Optional |
| 15432 | Postgres | Optional (for DB tools) |

```bash
# All-in-one tunnel
ssh -L 10350:localhost:10350 \
    -L 18000:localhost:18000 \
    -L 18080:localhost:18080 \
    -L 15432:localhost:15432 \
    -N dev-server
```

## Quick Reference

```bash
# === On the remote server ===

# Start everything
cd ~/code/ccrs/local-setup && tilt up

# Start headless (for background use)
tilt up --stream --host 0.0.0.0 &

# Check service health
./scripts/health-check.sh

# View Tilt logs
tilt logs pgr-services

# Restart a specific service
tilt trigger pgr-services

# Stop everything
tilt down

# === From your machine ===

# SSH with port forwarding
ssh -L 10350:localhost:10350 -L 18000:localhost:18000 dev-server

# Open dashboard
open http://localhost:10350

# Open DIGIT UI
open http://localhost:18000/digit-ui/
```
