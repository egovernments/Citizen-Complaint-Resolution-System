# Enabling HTTPS on the CMS Server

### Auto-Renewing Let's Encrypt (ACME) TLS with nginx

A step-by-step guide to enabling SSL/HTTPS on the CMS server **after** the Ansible-based application deployment is complete, and keeping the certificate renewing itself automatically.

| | |
|---|---|
| **TLS provider** | Let's Encrypt (free, 90-day certificates, auto-renewed) |
| **Method** | Host nginx TLS termination + Certbot webroot (HTTP-01) challenge |
| **Design** | A standalone HTTPS rule, decoupled from the default HTTP config. All HTTP is redirected to HTTPS, except the ACME challenge. |
| **Applies after** | The application stack has been deployed by Ansible and is reachable over HTTP |

> [!IMPORTANT]
> **Replace the placeholders before you begin.**
> - `<your-domain>` &rarr; your fully qualified domain name (for example `cms.example.org`)
> - `<admin-email>` &rarr; the email that should receive certificate expiry notices
>
> They appear in commands, config files, and file paths throughout this guide.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Step-by-Step Setup](#4-step-by-step-setup)
5. [Automatic Renewal](#5-automatic-renewal)
6. [Final Enabled State](#6-final-enabled-state)
7. [Troubleshooting](#7-troubleshooting)
8. [Operational Notes and Gotchas](#8-operational-notes-and-gotchas)
9. [After Every Application Deploy](#9-after-every-application-ansible-deploy)
- [Appendix A - HTTPS rule (port 443)](#appendix-a--etcnginxsites-availableyour-domain-https--port-443)
- [Appendix B - ACME + redirect rule (port 80)](#appendix-b--etcnginxsites-availableacme-challenge-redirect-http--port-80)
- [Appendix C - Full command sequence (copy-paste)](#appendix-c--full-command-sequence-copy-paste)

---

## 1. Overview

The design has three deliberate properties:

1. **TLS is terminated at the host nginx layer.** Internal application services keep running over plain HTTP on localhost ports. Host nginx accepts HTTPS on the public interface and proxies each request to the correct internal service. Every proxy block forwards `X-Forwarded-Proto $scheme`, so backends know the original request arrived over HTTPS.
2. **The HTTPS rule is a separate, standalone nginx config**, not an edit to the existing default HTTP config. It stays independent, so an application redeploy cannot silently revert it.
3. **All HTTP traffic is force-redirected to HTTPS, except the Let's Encrypt ACME challenge**, which must remain reachable over plain HTTP so the certificate can be issued and renewed.

The certificate is issued and renewed by Certbot using the webroot (HTTP-01) challenge, and nginx reloads automatically on every renewal via a deploy hook.

> [!NOTE]
> The nginx routing logic in this guide (ACME served over HTTP, everything else redirected to HTTPS, decoupled from the default config) was validated on a live nginx instance before publishing. See [Troubleshooting](#7-troubleshooting) for the observed behaviour of each request type.

---

## 2. Architecture

```
                     Internet
                         |
             (DNS: <your-domain> -> server public IP)
                         |
             +-----------v-----------+
             |   Firewall / NSG      |   inbound: TCP 80 + TCP 443
             +-----------+-----------+
                         |
             +-----------v-----------+
             |   Host nginx (systemd)|
             |   :80  ACME + force   |---> ACME challenge served over HTTP
             |        HTTPS redirect |---> everything else  301 -> HTTPS
             |   :443 TLS termination|
             +-----------+-----------+
                         |  (plain HTTP, localhost)
     +-------------------+---------------------------------+
     |         |         |         |         |             |
     v         v         v         v         v             v
   Kong      digit-ui  grafana   novu       MCP          minio
 127.0.0.1  :18080    :13000    :14000    :13101        :19000
  :18000  (all API traffic routes through Kong)
```

**Key points**

- Kong is the API gateway on `127.0.0.1:18000`. It is **not** on ports 80/443; host nginx sits in front of it.
- Host nginx config lives in `/etc/nginx/sites-available/`, enabled via symlinks in `/etc/nginx/sites-enabled/`.
- The two files created in this guide are **hand-maintained and separate** from the Ansible-generated default HTTP config, so they survive application redeploys. Their symlinks must be re-checked after every deploy (see [Section 9](#9-after-every-application-ansible-deploy)).

---

## 3. Prerequisites

Confirm all of the following before starting:

| # | Requirement | How to verify |
|---|-------------|---------------|
| 1 | DNS A record `<your-domain>` points to the server public IP | `dig +short <your-domain>` returns the server IP |
| 2 | Firewall / cloud NSG allows inbound **TCP 80** and **TCP 443** | Cloud console inbound rules |
| 3 | Host nginx installed and running (done by the Ansible deploy) | `systemctl status nginx` |
| 4 | The application stack is deployed and reachable over HTTP | `curl -sI http://<your-domain>/digit-ui/` |

> [!WARNING]
> **Port 80 must stay open permanently.** Let's Encrypt uses it for the initial challenge **and every future renewal**. If port 80 is closed after issuance, renewals will silently fail and the certificate will eventually expire.

---

## 4. Step-by-Step Setup

### Step 1 - Create the standalone ACME + force-HTTPS rule (port 80)

This is a **separate file**, independent of the existing default HTTP application config. It serves the Let's Encrypt validation challenge over plain HTTP and redirects everything else to HTTPS. As the `default_server` for port 80, it catches every HTTP request regardless of hostname, so no HTTP request reaches the application unencrypted.

```bash
sudo vi /etc/nginx/sites-available/acme-challenge-redirect
```

Paste the following:

```nginx
# ---------- HTTP :80 - ACME challenge + force-HTTPS (standalone default server) ----------
# Independent of the default application HTTP config. Handles EVERY http request on
# this host: serves the ACME challenge over HTTP, redirects everything else to HTTPS.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Let's Encrypt HTTP-01 challenge - served from disk, never redirected.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    # Everything else -> HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}
```

> [!NOTE]
> - `^~` gives the ACME location prefix-priority, so challenge requests are served from disk and are never caught by the redirect.
> - `listen 80 default_server` + `server_name _` makes this block handle **all** hostnames, keeping the rule decoupled from the domain and from the default config.
> - Only **one** `default_server` is allowed per port. The Ansible-generated app config on port 80 must **not** also be marked `default_server`, or `nginx -t` fails with `a duplicate default server`.

### Step 2 - Prepare the webroot directory

```bash
sudo mkdir -p /var/www/certbot
```

### Step 3 - Enable ONLY the ACME/redirect rule, then validate and reload

> [!WARNING]
> Do **not** enable the HTTPS (443) file yet. It references a certificate that does not exist, so `nginx -t` will fail until the certificate is issued in Step 5.

```bash
sudo ln -s /etc/nginx/sites-available/acme-challenge-redirect /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Step 4 - Install Certbot

Installed from the distribution package repository (webroot method; the nginx plugin is not used).

```bash
sudo apt update && sudo apt install -y certbot
```

### Step 5 - Issue the certificate (webroot / HTTP-01)

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d <your-domain> \
  --agree-tos --email <admin-email> --no-eff-email \
  --deploy-hook "systemctl reload nginx"
```

Expected output (dates will differ):

```text
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/<your-domain>/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/<your-domain>/privkey.pem
This certificate expires on <date, 90 days out>.
Certbot has set up a scheduled task to automatically renew this certificate in the background.
```

Confirm the certificate files exist:

```bash
sudo ls /etc/letsencrypt/live/<your-domain>/
# expect: fullchain.pem  privkey.pem
```

### Step 6 - Create the standalone HTTPS (443) rule

This is the second **separate file**. It terminates TLS and proxies to the internal services.

```bash
sudo vi /etc/nginx/sites-available/<your-domain>
```

Paste the full configuration from [Appendix A](#appendix-a--etcnginxsites-availableyour-domain-https--port-443).

### Step 7 - Enable the HTTPS rule, validate, reload

```bash
sudo ln -s /etc/nginx/sites-available/<your-domain> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Step 8 - Verify

```bash
# HTTP should redirect to HTTPS (any host, any path except ACME)
curl -sI http://<your-domain>/

# The ACME challenge path must stay on HTTP (200, not a redirect)
curl -s -o /dev/null -w "%{http_code}\n" http://<your-domain>/.well-known/acme-challenge/probe

# HTTPS should serve the application
curl -sI https://<your-domain>/digit-ui/
```

> [!TIP]
> Also open `https://<your-domain>/digit-ui/` in a browser and confirm the padlock shows a valid Let's Encrypt certificate with no mixed-content warnings in the developer console.

---

## 5. Automatic Renewal

Certbot configures renewal automatically at issuance time. **No manual steps are required** for routine operation.

- A systemd timer (`certbot.timer`) runs twice daily and renews any certificate within 30 days of expiry.
- The `--deploy-hook "systemctl reload nginx"` set during issuance makes nginx pick up the renewed certificate automatically.
- Renewal reuses the same webroot / HTTP-01 method, so it requires the ACME/redirect rule to stay enabled and port 80 to stay open.

Verify the renewal path end to end (safe, makes no changes):

```bash
sudo certbot renew --dry-run
```

Expected:

```text
Congratulations, all simulated renewals succeeded:
  /etc/letsencrypt/live/<your-domain>/fullchain.pem (success)
```

Confirm the timer is active:

```bash
systemctl list-timers | grep certbot
```

---

## 6. Final Enabled State

```text
/etc/nginx/sites-enabled/
  acme-challenge-redirect -> ../sites-available/acme-challenge-redirect   # port 80: ACME + force HTTPS
  <your-domain>           -> ../sites-available/<your-domain>             # port 443: TLS + app
  <default http config>   -> ../sites-available/<default http config>     # Ansible-managed; NOT default_server
```

---

## 7. Troubleshooting

The routing was validated on a live nginx instance. Expected behaviour per request type:

| Request | Expected result |
|---------|-----------------|
| `GET http://<your-domain>/.well-known/acme-challenge/<token>` | **200** - served from `/var/www/certbot` (never redirected) |
| `GET http://<your-domain>/anything` | **301** &rarr; `https://<your-domain>/anything` |
| `GET http://<raw-ip>/anything` | **301** &rarr; `https://<raw-ip>/...` (see note below) |
| `GET https://<your-domain>/digit-ui/` | **200** - application served over TLS |

Common issues:

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `nginx -t`: `cannot load certificate ... No such file or directory` | 443 file enabled before the cert exists | Disable the 443 symlink, issue the cert (Step 5), then re-enable |
| `nginx -t`: `a duplicate default server` | Two `default_server` blocks on port 80 | Ensure only the ACME/redirect rule is `default_server`; the Ansible app config must not be |
| `nginx -t`: `conflicting server name` warnings | A `.bak`/backup file left in `sites-enabled/` | Move backups outside `sites-available/` and `sites-enabled/` |
| Certificate renewal fails | Port 80 closed, or ACME rule disabled | Reopen TCP 80 in the NSG; re-enable `acme-challenge-redirect`; run `certbot renew --dry-run` |
| App loads but API/file calls fail on HTTPS | Mixed content (hardcoded `http://` URLs) | See gotcha #5 in [Section 8](#8-operational-notes-and-gotchas) |
| Browser cert error on the raw IP | Certificates cannot validate for a bare IP | Access by domain over HTTPS (this is expected, not a bug) |

---

## 8. Operational Notes and Gotchas

1. **Do not enable the 443 file before the certificate exists.** `nginx -t` fails with `cannot load certificate ...` and refuses to reload. Enable only the port-80 ACME/redirect rule first, issue the certificate, then link the 443 file.

2. **Only one `default_server` per port.** The ACME/redirect rule is the `default_server` on port 80. The Ansible-generated app config must not also be marked `default_server`, or `nginx -t` fails with `a duplicate default server`.

3. **Raw-IP access is intentionally redirected to HTTPS.** Because the redirect rule is the `default_server`, a request to the raw IP over HTTP is 301-redirected to `https://<ip>`, which cannot present a valid certificate (certificates never validate for a bare IP). This is expected: access the service by domain over HTTPS.

4. **Never keep `.bak` files in `sites-enabled/` or `sites-available/`.** nginx includes `sites-enabled/*`, so a stray backup file is loaded as a duplicate server block. Keep backups elsewhere (for example `/etc/nginx/backups/`).

5. **Mixed content.** After enabling HTTPS, click through the application (login, file upload/download). If API or file calls silently fail, check for hardcoded `http://` URLs in the UI runtime config:

   ```bash
   grep -n "http://<your-domain>" /opt/digit/nginx/globalConfigs.js
   ```

   Switch any hardcoded `http://` API base to `https://` (or relative) and redeploy the UI. The `/filestore/` `sub_filter` in Appendix A already handles the MinIO presigned-URL case by using `$scheme` instead of a hardcoded `http://`.

---

## 9. After Every Application (Ansible) Deploy

A full application deploy regenerates the Ansible-managed default HTTP config (a plain `listen 80; server_name ...;` file). The two hand-maintained rules and the certificate under `/etc/letsencrypt/` survive, but you must re-verify the symlinks after each deploy:

```bash
ls -l /etc/nginx/sites-enabled/
# Ensure both <your-domain> (443) and acme-challenge-redirect (80) are still symlinked,
# and that the regenerated default config is NOT marked default_server.
sudo nginx -t && sudo systemctl reload nginx
```

If a symlink is missing, re-create it (see Step 3 and Step 7) and reload.

---

## Appendix A - `/etc/nginx/sites-available/<your-domain>` (HTTPS / port 443)

```nginx
# ---------- HTTPS :443 - TLS termination, routes to internal HTTP services ----------
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name <your-domain>;

    ssl_certificate     /etc/letsencrypt/live/<your-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-domain>/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 25M;

    # --- Configurator SPA ---
    location = /configurator { return 302 /configurator/; }
    location /configurator/ {
        alias /var/www/configurator/;
        try_files $uri $uri/ /configurator/index.html;
    }

    # --- digit-ui-v2 citizen SPA ---
    location /citizen/assets/ {
        alias /var/www/citizen/assets/;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }
    location /citizen {
        alias /var/www/citizen/;
        try_files $uri $uri/ /citizen/index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    # --- Grafana ---
    location /grafana/ {
        proxy_pass http://127.0.0.1:13000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # --- Gatus status page ---
    location /status/ {
        proxy_pass http://127.0.0.1:18889/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Accept-Encoding "";
        sub_filter_once off;
        sub_filter_types text/html application/javascript text/javascript application/json;
        sub_filter 'src="/js/'               'src="/status/js/';
        sub_filter 'href="/css/'             'href="/status/css/';
        sub_filter 'href="/favicon'          'href="/status/favicon';
        sub_filter 'href="/apple-touch-icon' 'href="/status/apple-touch-icon';
        sub_filter 'href="/manifest.json'    'href="/status/manifest.json';
        sub_filter '"/api/v1/'               '"/status/api/v1/';
        sub_filter "'/api/v1/"               "'/status/api/v1/";
        sub_filter 's.p="/"'                 's.p="/status/"';
        sub_filter '("/"),routes:'           '("/status/"),routes:';
        sub_filter "`/api/v1/"               "`/status/api/v1/";
    }
    location = /gatus { return 301 $scheme://$host/status/; }

    # --- DIGIT MCP server (SSE-friendly) ---
    location /mcp {
        proxy_pass http://127.0.0.1:13101;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
    }

    # --- REST shim ---
    location /v1/ {
        proxy_pass http://127.0.0.1:13101;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_http_version 1.1;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # --- Novu dashboard + API + WS ---
    location = /novu { return 302 /novu/; }
    location /novu/ {
        proxy_pass http://127.0.0.1:14000/novu/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
    location /novu-api/ {
        proxy_pass http://127.0.0.1:14002/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_http_version 1.1;
    }
    location /novu-ws/ {
        proxy_pass http://127.0.0.1:14003/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 24h;
    }

    # --- Novu Vite base=/ workaround: root-absolute asset paths ---
    location /assets/ {
        proxy_pass http://127.0.0.1:14000/assets/;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
    }
    location /static/ {
        proxy_pass http://127.0.0.1:14000/static/;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
    }
    location /images/ {
        proxy_pass http://127.0.0.1:14000/images/;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
    }
    location /auth/ {
        proxy_pass http://127.0.0.1:14000;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
    }
    location /env/ {
        proxy_pass http://127.0.0.1:14000;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
    }
    location = /manifest.json {
        proxy_pass http://127.0.0.1:14000/manifest.json;
        proxy_set_header Host $host;
    }
    location = /favicon-gradient.svg {
        proxy_pass http://127.0.0.1:14000/favicon-gradient.svg;
        proxy_set_header Host $host;
    }
    location = /favicon.ico {
        proxy_pass http://127.0.0.1:14000/favicon.ico;
        proxy_set_header Host $host;
    }

    # --- digit-ui (container mode): only /digit-ui/* -> container; all API -> Kong ---
    location = /digit-ui { return 302 /digit-ui/; }
    location /digit-ui/ {
        proxy_pass http://127.0.0.1:18080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }

    # --- filestore: MinIO presigned URL rewrite ---
    location /file-store/ {
        proxy_pass http://127.0.0.1:19000/;
        proxy_set_header Host minio:9000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        client_max_body_size 25M;
        proxy_buffering off;
    }
    location /filestore/ {
        proxy_pass http://127.0.0.1:18000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Accept-Encoding "";
        sub_filter_once off;
        sub_filter_types application/json;
        sub_filter 'http://minio:9000/' '$scheme://$host/file-store/';
        client_max_body_size 25M;
        proxy_buffering off;
    }

    # --- Everything else (ALL API) -> Kong ---
    location / {
        proxy_pass http://127.0.0.1:18000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }
}
```

---

## Appendix B - `/etc/nginx/sites-available/acme-challenge-redirect` (HTTP / port 80)

```nginx
# ---------- HTTP :80 - ACME challenge + force-HTTPS (standalone default server) ----------
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Let's Encrypt HTTP-01 challenge - served from disk, never redirected.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    # Everything else -> HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}
```

---

## Appendix C - Full command sequence (copy-paste)

The complete run, in order. Create the two config files (Appendix A and B) at the `vi` steps.

```bash
# 1. ACME + force-HTTPS rule (paste Appendix B), then webroot
sudo vi /etc/nginx/sites-available/acme-challenge-redirect
sudo mkdir -p /var/www/certbot

# 2. Enable ONLY the ACME/redirect rule
sudo ln -s /etc/nginx/sites-available/acme-challenge-redirect /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 3. Install certbot and issue the certificate
sudo apt update && sudo apt install -y certbot
sudo certbot certonly --webroot -w /var/www/certbot \
  -d <your-domain> \
  --agree-tos --email <admin-email> --no-eff-email \
  --deploy-hook "systemctl reload nginx"

# 4. HTTPS rule (paste Appendix A), then enable it
sudo vi /etc/nginx/sites-available/<your-domain>
sudo ln -s /etc/nginx/sites-available/<your-domain> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 5. Verify
curl -sI http://<your-domain>/
curl -sI https://<your-domain>/digit-ui/
sudo certbot renew --dry-run
```

---

<sub>Document prepared for external partner handover. Certificate authority: Let's Encrypt (certificates are valid for 90 days and renew automatically). Replace `<your-domain>` and `<admin-email>` with your values before use.</sub>
