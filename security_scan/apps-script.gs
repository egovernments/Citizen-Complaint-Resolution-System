/**
 * DIGIT Security Scan — upload endpoint (Drive store + gh-pages publisher).
 *
 * Deploy as a Web App (Execute as: Me · Who has access: Anyone). The scanner POSTs one run;
 * this script (a) stores run.json + Excel on your Drive, and (b) publishes the run to the
 * repo's gh-pages dashboard via the GitHub Contents API. The GitHub write token lives ONLY in
 * this script's Script Properties, so it is never exposed to runners or committed to a repo.
 *
 * Script Properties (Project Settings → Script properties):
 *   SHARED_TOKEN   the value runners pass as SECSCAN_TOKEN (must match)
 *   GH_TOKEN       a fine-grained PAT with Contents: read+write on the CMS repos
 *
 * POST body: { token, repo:"owner/name", branch, base:"Name - datetime",
 *              folders:[...], runJsonBase64, xlsxBase64 }
 */

// =============================== CONFIG ======================================
// Set these two here, OR leave the PASTE_… placeholders and put them in
// Project Settings → Script properties (keys: SHARED_TOKEN, GH_TOKEN) instead.
var SHARED_TOKEN = "PASTE_SHARED_TOKEN_HERE";       // runners pass this as SECSCAN_TOKEN
var GH_TOKEN     = "PASTE_GITHUB_FINE_GRAINED_PAT"; // fine-grained PAT, Contents: read+write

var DRIVE_ROOT = "CMS-Security-Scan";
var PAGES_DIR  = "security_scan";                 // gh-pages path that serves the dashboard
var GH_BRANCH  = "gh-pages";
var INDEX_RAW  = "https://raw.githubusercontent.com/%REPO%/master/security_scan/dashboard-index.html";

// Domains allowed to open the exported audit workbook (with the link, view-only). The owner's
// own domain is shared via DriveApp; any EXTRA domains are added via the Drive API and require
// the owner's Workspace admin to trust/allowlist them for external sharing (see SETUP.md).
var EXTRA_SHARE_DOMAINS = ["egov.global"];

function _props(){ return PropertiesService.getScriptProperties(); }
function _cfg(codeVal, propKey){
  var v = (codeVal || "").trim();
  if (v && v.indexOf("PASTE_") !== 0) return v;          // use the in-code value if set
  return (_props().getProperty(propKey) || "").trim();    // else fall back to Script Properties
}
function _sharedToken(){ return _cfg(SHARED_TOKEN, "SHARED_TOKEN"); }
function _ghToken(){ return _cfg(GH_TOKEN, "GH_TOKEN"); }
function _json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet(){ return _json({ ok:true, service:"cms-security-scan" }); }

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    var need = _sharedToken();
    if (need && b.token !== need) return _json({ ok:false, error:"unauthorized" });

    // ---- 1) Drive: store run.json + Excel ----
    var folders = (b.folders && b.folders.length) ? b.folders : [DRIVE_ROOT];
    var folder = _folderPath(folders);
    var jsonFile = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b.runJsonBase64),
                        "application/json", b.base + ".json"));
    var xlsxUrl = "";
    if (b.xlsxBase64) {
      var xf = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b.xlsxBase64),
                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b.base + ".xlsx"));
      // The dashboard's "Export audit" link points here. Share it with the owner's domain plus
      // EXTRA_SHARE_DOMAINS (view-only, with the link) so the full audit stays internal to the
      // trusted orgs even though the dashboard is public.
      _shareAudit(xf);
      xlsxUrl = xf.getUrl();
    }

    // ---- 2) gh-pages: publish run + update manifest ----
    var pages = { ok:false };
    try { pages = _publishToPages(b, xlsxUrl); }
    catch (err) { pages = { ok:false, error:String(err) }; }

    return _json({ ok:true, driveJsonUrl:jsonFile.getUrl(), driveXlsxUrl:xlsxUrl,
                   pagesOk:pages.ok, pagesUrl:pages.url || "", pagesError:pages.error || "" });
  } catch (err) { return _json({ ok:false, error:String(err) }); }
}

function _publishToPages(b, xlsxUrl) {
  var ghTok = _ghToken();
  if (!ghTok) return { ok:false, error:"GH_TOKEN not set" };
  var repo = b.repo;                                   // owner/name
  var run  = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b.runJsonBase64)).getDataAsString());
  var m = run.meta || {}, s = run.summary || {};
  var safe = (b.base || ("run-" + Date.now())).replace(/[^A-Za-z0-9._-]+/g, "-");

  // Per-module gh-pages namespace: ansible runs -> security_scan/ansible/, source-code
  // runs -> security_scan/code/. Each subdir is a self-contained dashboard (app + data).
  var isCode = (b.kind === "source-code") || (m.kind === "source-code");
  var sub    = isCode ? "code" : "ansible";
  var base   = PAGES_DIR + "/" + sub;
  var dataPath = base + "/data/" + safe + ".json";

  // 2a) write the run json (b.runJsonBase64 is already base64 of the file bytes)
  _ghPut(repo, dataPath, ghTok, b.runJsonBase64, "security_scan: add " + safe + " (" + sub + ")");

  // 2b) seed this module's dashboard app once (same template for every module)
  if (!_ghGet(repo, base + "/index.html", ghTok)) {
    try {
      var html = UrlFetchApp.fetch(INDEX_RAW.replace("%REPO%", repo), { muteHttpExceptions:true }).getContentText("UTF-8");
      if (html && html.indexOf("<html") >= 0)
        // encode the bytes as UTF-8 so non-ASCII glyphs (dashes, arrows, emoji) survive the seed
        _ghPut(repo, base + "/index.html", ghTok, Utilities.base64Encode(html, Utilities.Charset.UTF_8), "security_scan: seed " + sub + " dashboard");
    } catch (e) {}
  }
  // 2b') seed the root redirect once: /security_scan/ -> /security_scan/ansible/
  if (!_ghGet(repo, PAGES_DIR + "/index.html", ghTok)) {
    var redir = '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="refresh" content="0; url=ansible/"><link rel="canonical" href="ansible/">'
      + '<title>Security Dashboard</title></head><body><a href="ansible/">Security Dashboard</a></body></html>';
    _ghPut(repo, PAGES_DIR + "/index.html", ghTok, Utilities.base64Encode(redir), "security_scan: root redirect -> ansible");
  }

  // 2c) read-modify-write the module's manifest.json (retry on race). The entry shape adapts:
  // the dashboard's run selector + trend read occurrences / typesBySeverity for BOTH modules.
  var entry = {
    file: "data/" + safe + ".json", label: b.base, repo: repo, runner: (b.base.split(" - ")[0] || ""),
    branch: b.branch || m.branch || "", ts: m.ts || "", date: m.date || "", shaShort: m.shaShort || "", pr: null,
    occurrences: isCode ? (s.cveAll || s.cve || 0) : (s.occurrences || 0),
    types:       isCode ? (s.cve || 0)            : (s.types || 0),
    occBySeverity:   isCode ? (s.bySeverity || {}) : (s.occBySeverity || {}),
    typesBySeverity: isCode ? (s.bySeverity || {}) : (s.typesBySeverity || {}),
    xlsxUrl: xlsxUrl
  };
  var mpath = base + "/manifest.json";
  for (var attempt = 0; attempt < 4; attempt++) {
    var cur = _ghGet(repo, mpath, ghTok);
    var manifest = { runs: [] }, sha = null;
    if (cur) { sha = cur.sha; try { manifest = JSON.parse(cur.text); } catch (e) { manifest = { runs: [] }; } }
    manifest.runs = (manifest.runs || []).filter(function (r) { return r.label !== entry.label; });
    manifest.runs.unshift(entry);
    manifest.runs.sort(function (a, c) { return (c.ts || "") < (a.ts || "") ? -1 : 1; });
    var res = _ghPut(repo, mpath, ghTok, Utilities.base64Encode(JSON.stringify(manifest, null, 1)),
                     "security_scan: manifest " + safe + " (" + sub + ")", sha, true);
    if (res.code < 300) return { ok:true, url:"https://" + repo.split("/")[0].toLowerCase() +
                                 ".github.io/" + repo.split("/")[1] + "/" + PAGES_DIR + "/" + sub + "/" };
    if (res.code !== 409) return { ok:false, error:"manifest PUT " + res.code + " " + res.body.slice(0,120) };
    Utilities.sleep(400 + attempt * 300);             // 409 conflict -> re-read and retry
  }
  return { ok:false, error:"manifest conflict after retries" };
}

// -------- GitHub Contents API helpers --------
function _ghHeaders(tok){ return { Authorization:"Bearer " + tok, Accept:"application/vnd.github+json", "User-Agent":"cms-security-scan" }; }
function _ghGet(repo, path, tok) {
  var url = "https://api.github.com/repos/" + repo + "/contents/" + _enc(path) + "?ref=" + GH_BRANCH;
  var r = UrlFetchApp.fetch(url, { method:"get", headers:_ghHeaders(tok), muteHttpExceptions:true });
  if (r.getResponseCode() === 200) {
    var j = JSON.parse(r.getContentText());
    return { sha:j.sha, text: Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\n/g,""))).getDataAsString() };
  }
  return null;
}
function _ghPut(repo, path, tok, contentB64, message, sha, mute) {
  var payload = { message:message, content:contentB64, branch:GH_BRANCH };
  if (sha) payload.sha = sha;
  var r = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/contents/" + _enc(path), {
    method:"put", headers:_ghHeaders(tok), contentType:"application/json",
    payload:JSON.stringify(payload), muteHttpExceptions:true });
  return { code:r.getResponseCode(), body:r.getContentText() };
}
function _enc(path){ return path.split("/").map(encodeURIComponent).join("/"); }

// -------- share a workbook with the owner's domain + EXTRA_SHARE_DOMAINS (view, with link) --------
function _shareAudit(f) {
  // owner's own Workspace domain (simple, always allowed)
  try { f.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  // extra domains via the Drive REST API (needs the domain to be trusted by the Workspace admin)
  var id = f.getId();
  for (var i = 0; i < EXTRA_SHARE_DOMAINS.length; i++) {
    var d = EXTRA_SHARE_DOMAINS[i];
    try {
      var r = UrlFetchApp.fetch(
        "https://www.googleapis.com/drive/v3/files/" + id +
        "/permissions?sendNotificationEmail=false&supportsAllDrives=true",
        { method:"post", contentType:"application/json",
          headers:{ Authorization:"Bearer " + ScriptApp.getOAuthToken() },
          payload: JSON.stringify({ type:"domain", role:"reader", domain:d, allowFileDiscovery:false }),
          muteHttpExceptions:true });
      if (r.getResponseCode() >= 300)
        Logger.log("share " + d + " -> " + r.getResponseCode() + " " + r.getContentText().slice(0,200));
    } catch (e) { Logger.log("share " + d + " failed: " + e); }
  }
}

// -------- Drive folder helper (create-only) --------
function _folderPath(parts) {
  var cur = DriveApp.getRootFolder();
  for (var i = 0; i < parts.length; i++) {
    var it = cur.getFoldersByName(parts[i]);
    cur = it.hasNext() ? it.next() : cur.createFolder(parts[i]);
  }
  return cur;
}

// -------- one-off: make every already-uploaded .xlsx openable via its link --------
// Run this once from the editor to fix workbooks uploaded before the setSharing change.
// New runs are shared automatically by doPost.
function shareExistingPublic() {
  var root = _folderPath([DRIVE_ROOT]);
  var n = 0, failed = 0;
  (function walk(folder) {
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().slice(-5).toLowerCase() !== ".xlsx") continue;
      try { _shareAudit(f); n++; }
      catch (e) { failed++; Logger.log("could not share: " + f.getName() + " — " + e); }
    }
    var subs = folder.getFolders();
    while (subs.hasNext()) walk(subs.next());
  })(root);
  Logger.log("shared " + n + " workbook(s) as anyone-with-link viewer; " + failed + " failed");
  return { shared: n, failed: failed };
}
