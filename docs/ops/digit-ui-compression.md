# digit-ui: gzip + cache-control (perf) — deploy runbook

The digit-ui SPA ships as a single non-code-split bundle (`index.js`, ~7–8 MB)
plus ~1.5 MB of CSS, served **uncompressed** with **no `Cache-Control`**. Cold
loads (fresh WebView / new device) pull the whole thing raw over the wire.

This change adds, **scoped to the `/digit-ui` location only** (never to any
Kong/API route):

- **gzip** for JS/CSS/JSON/SVG → the bundle ships ~3–4× smaller
  (measured local: 7.2 MB → 2.1 MB).
- **`Cache-Control: no-cache`** → the browser revalidates with its `ETag` and
  gets a cheap `304` when unchanged, instead of heuristically serving a stale
  bundle after a redeploy. (Not `immutable`/long-max-age — the filename is not
  content-hashed, so long caching would strand users on an old build.)

Pure nginx config change: **no bundle rebuild, no app redeploy, reversible with
a reload.** `sub_filter` (globalConfigs.js injection) runs before gzip, so the
config injection the SPA depends on is unaffected.

## Which file, per serving mode

There are two ways a box serves `/digit-ui`; check yours first:

```bash
sudo grep -RnE "location .*/digit-ui|alias|proxy_pass" /etc/nginx/ | grep -i digit-ui
```

- **Disk-serve (ansible static/vendored mode — pilot & prod):** the host nginx
  serves the bundle directly (`location /digit-ui/ { alias /opt/digit-ui-esbuild/build/; }`).
  Source of truth: `local-setup/ansible/templates/nginx-site.conf.j2` — this PR
  puts the `gzip`/`add_header` **inside that location**. gzip compresses the
  on-disk file directly; no proxy trick needed.
- **Proxy-to-container (local compose / some boxes):** the host nginx
  `proxy_pass`es `/digit-ui` to the digit-ui container. In that case the host
  must fetch identity from the container and gzip at the edge:
  add `proxy_set_header Accept-Encoding "";` alongside the `gzip` block in the
  host's `/digit-ui/` location. (The container-side config —
  `local-setup/nginx/digit-ui.conf` / the `playbook-deploy.yml` block — also
  carries gzip in this PR, but with a proxy in front the edge directive is what
  reaches the client.)

## Deploy — ansible-managed box (recommended)

Use `deploy.sh` — it regenerates the inventory (`inventory/hosts.yml`, which is
NOT checked in) from `inventory/host_vars/` and then runs the playbook. The
host-nginx render tasks carry a `nginx` tag, so a surgical reload is:

```bash
# 1. pull the merged change onto wherever you run ansible from:
cd <repo> && git pull

# 2. re-render just the host nginx site config + reload, for one host:
cd local-setup/ansible
./deploy.sh <host> --tags nginx
#   deploy.sh → ansible-playbook -i inventory/hosts.yml --limit <host> \
#               playbook-deploy.yml --tags nginx
#   the tagged tasks render templates/nginx-site.conf.j2 and notify the
#   `Reload nginx` handler (which runs `nginx -t` then reloads).
```

> ⚠️ **`nginx_preserve_vhost` hosts skip this.** On any host with
> `nginx_preserve_vhost: true` in its `host_vars` (hand-crafted vhost — e.g.
> Bomet), the render task is `when: not nginx_preserve_vhost`, so ansible will
> report `ok=0 changed=0` and touch nothing. Confirm with
> `grep -r nginx_preserve_vhost local-setup/ansible/inventory/host_vars/<host>.yml`;
> if it's set, use the **manual** path below.

## Deploy — manual (if the box's nginx isn't ansible-rendered)

```bash
# find the live host config that serves /digit-ui
sudo grep -Rl "digit-ui" /etc/nginx/
# back it up
sudo cp /etc/nginx/sites-available/<file> /root/<file>.$(date +%F).bak
# inside `location /digit-ui/ { ... }` add:
#   gzip on;
#   gzip_vary on;
#   gzip_min_length 1024;
#   gzip_comp_level 5;
#   gzip_types text/css application/javascript text/javascript application/json image/svg+xml;
#   add_header Cache-Control "no-cache" always;
# (proxy mode only) also add:  proxy_set_header Accept-Encoding "";
sudo nginx -t && sudo systemctl reload nginx      # or: sudo docker exec <nginx> nginx -s reload
```

> ⚠️ **`add_header` does not merge across scopes.** When a block declares its
> own `add_header`, nginx **replaces** the entire inherited set for that block
> rather than adding to it. If this box sets security headers at `server`/`http`
> scope (e.g. `X-Frame-Options`, CSP, HSTS, `X-Content-Type-Options`), dropping
> `add_header Cache-Control` into `location /digit-ui/ {}` silently strips **all**
> of them for that location — and `nginx -t` gives no warning. Re-declare any
> such outer-level headers inside the block alongside `Cache-Control`. (The
> repo's own `nginx-site.conf.j2` sets no server-scope headers, so
> ansible-rendered boxes are unaffected — this only bites hand-configured hosts.)

## Verify

```bash
# gzip + revalidation on the bundle:
curl -sI -H 'Accept-Encoding: gzip' http://<host>/digit-ui/index.js \
  | grep -iE 'content-encoding|cache-control'
#   → content-encoding: gzip   +   cache-control: no-cache

# bytes actually transferred (should be ~2 MB, not ~7 MB):
curl -s -H 'Accept-Encoding: gzip' http://<host>/digit-ui/index.js -o /dev/null -w '%{size_download}\n'

# app still boots — globalConfigs injection intact:
curl -s http://<host>/digit-ui/index.html | grep -c globalConfigs.js      # → ≥1

# 304 on second load:
ET=$(curl -sI http://<host>/digit-ui/index.js | awk '/[Ee]-?[Tt]ag/{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ET" http://<host>/digit-ui/index.js  # → 304
```

Then hard-refresh the UI in a browser (Ctrl+Shift+R) and confirm it loads.

## Rollback

```bash
sudo cp /root/<file>.<date>.bak /etc/nginx/sites-available/<file>
sudo nginx -t && sudo systemctl reload nginx
```

No rebuild involved either way.

## Notes / prod specifics

- **mctd prod is HTTP-only** (HTTPS broken) — use `http://digit.mctd.gov.mz` in
  the verify curls.
- This is the safe, high-impact slice. The structural follow-up (esbuild
  content-hashing `entryNames: '[name]-[hash]'` + `immutable` on hashed files,
  and eventually code-splitting) is a separate, build-level change that needs a
  full browser regression pass — do **not** switch this location to
  `immutable`/long-max-age until filenames are hashed.
