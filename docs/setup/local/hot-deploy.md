# Hot deployment guide

Once `ansible/deploy.sh <tenant>` (or `docker compose up -d`) has stood up the
local-setup stack, you don't need to re-run the playbook or `docker compose
build` every time you tweak a line of code. The three app-layer pieces of
this repo can each be rebuilt and pushed into the *already-running*
containers directly:

| Service | Runs as | Hot-swap mechanism |
|---|---|---|
| `backend/pgr-services` | container `digit-pgr-services-1` | rebuild jar → `docker cp` into container → `docker restart` |
| `digit-ui-esbuild` | container `digit-ui` (nginx) | rebuild bundle → `tar` pipe into container's docroot (no restart) |
| `configurator` | host nginx (or bind-mounted container on macOS) | rebuild SPA → sync `dist/` to the nginx docroot → `nginx -s reload` |

None of these touch the image registry or the compose/playbook definitions —
they only replace files inside the container/docroot that's already up. A
full `docker compose up -d --build` or ansible re-run is still the right tool
when you change a Dockerfile, add a new service, or need a clean-slate
rebuild.

## The one-liner: `hot-deploy.sh`

```bash
cd local-setup
./scripts/hot-deploy.sh backend         # after editing backend/pgr-services/**
./scripts/hot-deploy.sh frontend        # after editing digit-ui-esbuild/** (e.g. products/pgr/**)
./scripts/hot-deploy.sh configurator    # after editing configurator/**
./scripts/hot-deploy.sh all             # all three, in sequence
```
**If you encounter any permission issues while running the above commands, execute them with sudo.**

Each target does exactly the same steps a developer would otherwise do by
hand (see below), plus a health check at the end so you know whether the
change actually landed. Run it from anywhere — it resolves paths relative to
the repo root, not your cwd.

If the target container isn't running, the script fails fast with a message
telling you to bring the stack up first — hot-swap only makes sense against
an already-deployed environment.

### Config knobs

- `CONFIGURATOR_WWW_DIR` — override the nginx docroot for `configurator`.
  Defaults to `/var/www/configurator` (Linux host nginx). On macOS/OrbStack
  deploys the playbook bind-mounts a different path per
  `local-setup/ansible/inventory/group_vars/all.yml` (`configurator_www_dir`)
  — check that file's value for your tenant and export it before running the
  script, e.g. `CONFIGURATOR_WWW_DIR=/path/from/host_vars ./scripts/hot-deploy.sh configurator`.
- `SKIP_SUBPKGS=1` — skip rebuilding `configurator/packages/{data-provider,digit-datagrid}`
  before the SPA build. The script rebuilds them by default because they're
  consumed via `file:` deps and a stale `dist/` there silently bundles old code.

## What each target does under the hood

### `backend` — pgr-services

```bash
mvn -f backend/pgr-services/pom.xml clean package -DskipTests
docker cp backend/pgr-services/target/pgr-services-*.jar digit-pgr-services-1:/app/app.jar
docker restart digit-pgr-services-1
```

`digit-pgr-services-1` runs a prebuilt registry image, not a repo Dockerfile
build — the container itself never changes, only the jar inside `/app`.
`clean package` (not just `package`) avoids leaving two jars in `target/`,
which would make `docker cp`'s glob ambiguous. Tests are skipped for
dev-loop speed; run `mvn test` separately before you consider the change done.

Restart is required here because the JVM has the old jar's bytecode loaded —
there's no live class reload.

### `frontend` — digit-ui-esbuild

```bash
(cd digit-ui-esbuild && node esbuild.build.js)
tar -czf - -C digit-ui-esbuild/build . | docker exec -i digit-ui tar -xzf - -C /usr/share/nginx/html
```

`digit-ui` serves a **flat** static layout (`index.html`, `index.js`,
`vendor/`, `globalConfigs.js` directly under `/usr/share/nginx/html`, no
`digit-ui/` subfolder). The esbuild script always builds every module —
there's no per-app flag — so this rebuilds everything under
`digit-ui-esbuild/products/*` in one pass. The tar pipe replaces the whole
docroot atomically-ish in one shot; nginx serves static files directly, so no
restart is needed.

### `configurator` — DIGIT Studio

```bash
(cd configurator/packages/data-provider && npm run build)   # + digit-datagrid
(cd configurator && npx vite build --base=/configurator/)
sudo cp -r configurator/dist/. /var/www/configurator/ && sudo nginx -s reload
```

Two gotchas the script exists specifically to avoid:

1. **Don't run the root `npm run build`.** That script is `tsc -b && vite
   build`, and the project-wide typecheck has pre-existing errors unrelated
   to most changes — it'll block a build that would otherwise work. The
   script calls `vite build` directly, same as the ansible build path
   (`local-setup/ansible/files/configurator-build.sh`).
2. **Sync the whole `dist/` directory, never individual files.** Vite
   content-hashes filenames on every build, so `index.html` from one build
   paired with assets from a previous copy will 404.

If the docroot isn't writable and there's no `sudo` (e.g. inside a sandboxed
agent), the script falls back to a throwaway `alpine` container mounting the
docroot to do the copy as root.

**Root-owned leftovers.** The initial ansible deploy runs the configurator
build as root, so `configurator/node_modules/.vite-temp/` and files under
`$CONFIGURATOR_WWW_DIR/assets/` can end up root-owned even though the
top-level directories are user-writable. The script detects this by trying a
plain `rm`+`cp` first and falling back to `sudo` (then to the container
fallback) on failure.

That auto-fallback only works with **passwordless** sudo (`sudo -n`). If your
account needs a password for sudo, the non-interactive `sudo -n true` check
inside the script fails silently and it drops straight to the Docker
container fallback — which itself can fail if Docker isn't set up to run
without sudo on your box. In that case you'll see raw `EACCES`/`Permission
denied` errors instead of a clean fallback message. The fix is simply to
re-run the configurator step with sudo yourself, preserving your PATH so it
still finds your Node/npm (important if Node is managed by nvm under your
home directory, since sudo normally resets PATH to a root-only one):

```bash
sudo -E env "PATH=$PATH" ./scripts/hot-deploy.sh configurator
```

This will prompt for your password once, then run the whole build-and-sync
as root, which has permission to touch the pre-existing root-owned files.
It's safe to do every time if you'd rather not depend on passwordless sudo —
the script's own `rm`+`cp` attempt is just a fast path.

## When hot-deploy isn't enough

Fall back to the full path if:
- The container itself isn't running (`docker compose up -d <service>` first).
- You changed a Dockerfile, `docker-compose*.yml`, or added a new service —
  hot-deploy only replaces app code inside an existing container.
- You changed Kong routes, MDMS seed data, or anything ansible provisions
  once at deploy time (roles, `host_vars`) — re-run `ansible/deploy.sh <tenant>`.
- You need to verify CI-equivalent behavior — hot-deploy is a dev-loop
  shortcut, not a substitute for `local-setup/scripts/smoke-test.sh` /
  `health-check.sh` before merging.

## Equivalent Claude Code skills

If you're driving changes through Claude Code rather than the terminal, the
same three procedures are available as skills and are picked automatically
after you edit the relevant code and ask to see it live:
`redeploy-pgr-backend`, `redeploy-pgr-frontend`, `redeploy-configurator`
(`.claude/skills/`). `hot-deploy.sh` is the terminal-native version of the
same steps, for when you're iterating by hand.
