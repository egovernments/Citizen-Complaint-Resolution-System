#!/usr/bin/env python3
"""Config edits for secure-filestore.sh (VAPT #223: insecure file storage).

    secure_filestore_patch.py kong    <kong.yml>
    secure_filestore_patch.py compose <docker-compose.egov-digit.yaml>
    secure_filestore_patch.py nginx   <site.conf> [--with-zone]
    secure_filestore_patch.py check   <kind> <file>     # report only, never writes

Every edit is anchored on exact text and is idempotent: a file that already
has the change is reported as "already" and left alone. If an anchor is
missing the file is NOT written and the exit code is 3, so the caller can stop
before anything half-applied reaches a running service.

Exit codes: 0 changed (or would change, for check), 10 already done,
3 file doesn't look as expected, 2 usage.
"""
import re
import sys

MARK = "VAPT #223"

# ── Kong ─────────────────────────────────────────────────────────────────────
FS_AUTH_OPTIONAL = (
    '          ["/filestore/v1/file"]=true, ["/filestore/v1/files"]=true, ["/filestore/v1/files/url"]=true,\n'
    '          ["/filestore/v1/files/id"]=true, ["/filestore/v1/files/tag"]=true,\n'
)
FS_AUTH_OPTIONAL_NEW = (
    "          -- /filestore/v1/{file,files,files/url,files/id,files/tag} REMOVED from\n"
    "          -- auth-optional (VAPT #223: insecure file storage). Anyone holding a\n"
    "          -- fileStoreId could download a complaint attachment without logging\n"
    "          -- in. They now need a valid token on every method, incl. multipart\n"
    "          -- uploads, but are not action-RBAC'd. Pictures shown before login\n"
    "          -- (landing page) come from the bucket's public pgr-landing/ prefix.\n"
)

# Variant A: gateways that already enforce non-POST requests (bgrm lineage).
A_RBAC_OLD = '              or p == "/user/_search"\n        end\n'
A_RBAC_NEW = (
    '              or p == "/user/_search"\n'
    "              -- Filestore (VAPT #223): a token is required, but no per-role\n"
    "              -- action check: /files/id has no accesscontrol actions and\n"
    "              -- upload/url are mapped to only some roles, so RBAC would 403\n"
    "              -- admins. A per-file ownership check is a filestore change.\n"
    '              or p == "/filestore/v1/file" or p == "/filestore/v1/files"\n'
    '              or p == "/filestore/v1/files/url" or p == "/filestore/v1/files/id"\n'
    '              or p == "/filestore/v1/files/tag"\n'
    "        end\n"
)
# Multipart detection: the first #223 version (GATE_LOOSE) matched loosely and
# on every path. Servers patched with it are re-patched to GATE_FIXED, which
# matches the exact media type on the filestore upload paths only.
GATE_LOOSE = (
    '        local ctype = kong.request.get_header("content-type")\n'
    '        local is_multipart = type(ctype) == "string" and ctype:lower():find("multipart/form-data", 1, true) ~= nil\n'
    '        if kong.request.get_method() ~= "POST" or is_multipart then\n'
)
GATE_FIXED = (
    '        local ctype = kong.request.get_header("content-type")\n'
    '        -- Exact media type (the part before any ";" parameters), never a\n'
    '        -- substring, and only on the filestore upload paths. Every other POST,\n'
    '        -- whatever its Content-Type, goes through the JSON branch below, which\n'
    '        -- replaces RequestInfo.userInfo with the user resolved from the token.\n'
    '        local mtype = type(ctype) == "string" and ctype:lower():match("^%s*([^;%s]+)") or nil\n'
    '        local upath = kong.request.get_path()\n'
    '        local is_upload = mtype == "multipart/form-data"\n'
    '          and (upath == "/filestore/v1/files" or upath == "/filestore/v1/file")\n'
    '        if kong.request.get_method() ~= "POST" or is_upload then\n'
)
A_GATE_OLD = (
    '        if kong.request.get_method() ~= "POST" then\n'
    "          if not is_protected then return end          -- auth-optional GETs (boundary, filestore dl, ...) pass\n"
    '          local hdr = kong.request.get_header("auth-token")\n'
    "          local q = kong.request.get_query()\n"
    '          local qtok = q and q["access_token"]\n'
    '          local ntoken = (type(hdr) == "string" and hdr ~= "" and hdr)\n'
    '                      or (type(qtok) == "string" and qtok ~= "" and qtok) or nil\n'
)
A_GATE_NEW = (
    "        -- Multipart POSTs (filestore uploads, VAPT #223) take the same header\n"
    "        -- route: they have no JSON body to carry RequestInfo.authToken.\n"
    "        -- `Authorization: Bearer` is honoured too (digit-ui-v2, configurator, MCP).\n"
    + GATE_FIXED
    + (
    "          if not is_protected then return end          -- auth-optional GETs (boundary, localization, ...) pass\n"
    '          local hdr = kong.request.get_header("auth-token")\n'
    '          local authz = kong.request.get_header("authorization")\n'
    '          local btok = type(authz) == "string" and authz:match("^[Bb]earer%s+(%S+)%s*$") or nil\n'
    "          local q = kong.request.get_query()\n"
    '          local qtok = q and q["access_token"]\n'
    '          local ntoken = (type(hdr) == "string" and hdr ~= "" and hdr)\n'
    "                      or btok\n"
    '                      or (type(qtok) == "string" and qtok ~= "" and qtok) or nil\n'
))

# Variant B: older gateways that let every non-POST request through unchecked
# (`if method ~= "POST" then return end`). A dedicated filestore gate is put in
# front of that line; other GETs keep their current behaviour.
B_OLD = '        if kong.request.get_method() ~= "POST" then return end\n'
B_NEW = (
    "        -- Filestore gate (VAPT #223). This gateway lets non-POST requests\n"
    "        -- through unchecked (line below), and uploads are multipart with no\n"
    "        -- JSON body token, so filestore needs its own check: a valid token\n"
    "        -- from the auth-token header, `Authorization: Bearer` or ?access_token,\n"
    "        -- verified against egov-user. No per-role action check.\n"
    "        local function is_filestore(p)\n"
    '          return p == "/filestore/v1/file" or p == "/filestore/v1/files"\n'
    '              or p == "/filestore/v1/files/url" or p == "/filestore/v1/files/id"\n'
    '              or p == "/filestore/v1/files/tag"\n'
    "        end\n"
    "        if is_filestore(uri) then\n"
    '          local fs_ctype = kong.request.get_header("content-type")\n'
    '          local fs_json = kong.request.get_method() == "POST" and type(fs_ctype) == "string"\n'
    '                          and fs_ctype:lower():find("json", 1, true) ~= nil\n'
    "          if not fs_json then\n"
    '            local hdr = kong.request.get_header("auth-token")\n'
    '            local authz = kong.request.get_header("authorization")\n'
    '            local btok = type(authz) == "string" and authz:match("^[Bb]earer%s+(%S+)%s*$") or nil\n'
    "            local q = kong.request.get_query()\n"
    '            local qtok = q and q["access_token"]\n'
    '            local ntoken = (type(hdr) == "string" and hdr ~= "" and hdr) or btok\n'
    '                        or (type(qtok) == "string" and qtok ~= "" and qtok) or nil\n'
    "            local function fs_exit(status, code, desc)\n"
    "              return kong.response.exit(status, cjson.encode({ ResponseInfo = cjson.null,\n"
    "                Errors = {{ code = code, message = code, description = desc }} }),\n"
    '                { ["Content-Type"] = "application/json" })\n'
    "            end\n"
    '            if not ntoken then return fs_exit(401, "InvalidAccessTokenException", "Authentication required for the request") end\n'
    "            local fc = http.new(); fc:set_timeout(5000)\n"
    '            local fr = fc:request_uri("http://egov-user-proxy:8107/user/_details?access_token=" .. ngx.escape_uri(ntoken),\n'
    '              { method = "POST", headers = { ["Content-Type"] = "application/json" } })\n'
    "            if fr and fr.status == 200 then\n"
    "              local okd, u = pcall(cjson.decode, fr.body)\n"
    '              if okd and type(u) == "table" and (u["uuid"] or u["userName"]) then return end\n'
    "            elseif fr and (fr.status == 401 or fr.status == 403\n"
    '                           or (fr.body and fr.body:find("InvalidAccessTokenException", 1, true))) then\n'
    '              return fs_exit(401, "InvalidAccessTokenException", "Invalid access token or access token expired for the request")\n'
    "            end\n"
    '            return fs_exit(503, "AuthServiceUnavailable", "Could not verify authentication for the request; please retry")\n'
    "          end\n"
    "        end\n"
    + B_OLD
)


def patch_kong(s):
    if GATE_LOOSE in s:
        return s.replace(GATE_LOOSE, GATE_FIXED, 1), "changed (multipart gate tightened: exact media type, filestore uploads only)"
    if MARK in s:
        return s, "already"
    if FS_AUTH_OPTIONAL not in s:
        return None, "filestore entries not found in AUTH_OPTIONAL"
    s = s.replace(FS_AUTH_OPTIONAL, FS_AUTH_OPTIONAL_NEW, 1)
    if A_GATE_OLD in s and A_RBAC_OLD in s:
        s = s.replace(A_GATE_OLD, A_GATE_NEW, 1).replace(A_RBAC_OLD, A_RBAC_NEW, 1)
        return s, "changed (gateway enforces non-POST: filestore made login-only, RBAC-exempt)"
    if s.count(B_OLD) == 1:
        s = s.replace(B_OLD, B_NEW, 1)
        return s, "changed (older gateway: dedicated filestore login gate added)"
    return None, "pre-function shape not recognised (neither known gateway version)"


# ── Compose ──────────────────────────────────────────────────────────────────
MC_OLD = re.compile(r"^(?P<ind>[ \t]+)(?P<mc>mc(?: --config-dir \S+)?) anonymous set download (?P<alias>\w+)/egov-rainmaker;\n", re.M)
POLICY = ('{\\"Version\\":\\"2012-10-17\\",\\"Statement\\":[{\\"Effect\\":\\"Allow\\",\\"Principal\\":{\\"AWS\\":[\\"*\\"]},'
          '\\"Action\\":[\\"s3:GetObject\\"],\\"Resource\\":[\\"arn:aws:s3:::egov-rainmaker/*/pgr-landing/*\\"]}]}')


def patch_compose(s):
    notes = []
    m = MC_OLD.search(s)
    if m:
        ind, mc, alias = m.group("ind"), m.group("mc"), m.group("alias")
        new = (f"{ind}{mc} anonymous set none {alias}/egov-rainmaker;  # {MARK}: private bucket\n"
               f"{ind}echo '{POLICY}' > /tmp/public-landing.json;\n"
               f"{ind}{mc} anonymous set-json /tmp/public-landing.json {alias}/egov-rainmaker;\n")
        s = s[:m.start()] + new + s[m.end():]
        notes.append("minio-init: bucket private, pgr-landing/ public")
    elif "anonymous set none" in s and "egov-rainmaker" in s:
        notes.append("minio-init: already private")
    else:
        return None, "minio-init `anonymous set download` line not found"

    if "PRESIGNED_URL_EXPIRY_TIME_IN_SECS" in s:
        notes.append("filestore link expiry: already set")
    else:
        # Insert after MINIO_URL inside the egov-filestore service block only.
        blk_start = s.find("\n  egov-filestore:\n")
        if blk_start < 0:
            return None, "egov-filestore service not found"
        nxt = re.compile(r"^  [A-Za-z0-9_.-]+:\n", re.M).search(s, blk_start + 2 + len("  egov-filestore:\n"))
        blk_end = nxt.start() if nxt else len(s)
        blk = s[blk_start:blk_end]
        mm = re.search(r"^(?P<ind>[ \t]+)MINIO_URL: .*\n", blk, re.M)
        if not mm:
            return None, "MINIO_URL not found in egov-filestore environment"
        line = f"{mm.group('ind')}PRESIGNED_URL_EXPIRY_TIME_IN_SECS: ${{FILESTORE_URL_EXPIRY_SECS:-3600}}  # {MARK}: 1 h, not 24 h\n"
        blk = blk[:mm.end()] + line + blk[mm.end():]
        s = s[:blk_start] + blk + s[blk_end:]
        notes.append("filestore link expiry: 1 hour")
    changed = any("already" not in n for n in notes)
    return s, ("changed (" if changed else "already (") + "; ".join(notes) + ")"


# ── nginx ────────────────────────────────────────────────────────────────────
ZONE = (
    f"# Upload rate limit ({MARK}): per client IP, POST only; reads are not counted.\n"
    "map $request_method $digit_filestore_upload_key {\n"
    "  POST    $binary_remote_addr;\n"
    '  default "";\n'
    "}\n"
    "limit_req_zone $digit_filestore_upload_key zone=digit_filestore_upload:10m rate=30r/m;\n\n"
)
ROOT_DENY = (
    f"  # Bucket roots answer an S3 listing; keep it closed ({MARK}).\n"
    "  location ~ ^/file-store/?([^/]+/?)?$ {\n"
    "    return 403;\n"
    "  }\n"
)
FS_LOC = re.compile(r"^(?P<ind>[ \t]*)location /file-store/ \{\n", re.M)
FILESTORE_LOC = re.compile(r"^(?P<ind>[ \t]*)location /filestore/ \{\n", re.M)


def patch_nginx(s, with_zone):
    if MARK in s:
        return s, "already"
    if not FS_LOC.search(s) or not FILESTORE_LOC.search(s):
        return None, "no `location /file-store/` + `location /filestore/` pair"
    s = FS_LOC.sub(lambda m: ROOT_DENY + m.group(0), s)
    s = FILESTORE_LOC.sub(lambda m: m.group(0) + f"{m.group('ind')}    limit_req zone=digit_filestore_upload burst=20 nodelay;\n"
                                     f"{m.group('ind')}    limit_req_status 429;\n", s)
    if with_zone:
        s = ZONE + s
    return s, "changed (bucket-root listing denied; upload rate limit" + (" + zone" if with_zone else "") + ")"


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    check = argv[1] == "check"
    if check:
        argv = argv[1:]
    kind, path = argv[1], argv[2]
    s = open(path, encoding="utf-8").read()
    if kind == "kong":
        new, msg = patch_kong(s)
    elif kind == "compose":
        new, msg = patch_compose(s)
    elif kind == "nginx":
        new, msg = patch_nginx(s, "--with-zone" in argv)
    else:
        print(__doc__)
        return 2
    print(msg)
    if new is None:
        return 3
    if new == s or msg.startswith("already"):
        return 10
    if not check:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
