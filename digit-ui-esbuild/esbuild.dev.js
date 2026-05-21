const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

const PORT = parseInt(process.env.PORT || "18080", 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "18000", 10);
const PROXY_KC_PORT = parseInt(process.env.PROXY_KC_PORT || "18200", 10);
const GLOBAL_CONFIGS = process.env.GLOBAL_CONFIGS || ""; // path to server-specific globalConfigs.js
const PUBLIC_PATH = "/digit-ui/";
const HOST = "0.0.0.0";

// Vercel-style timestamped logger: [HH:MM:SS.mmm] prefix on every line
const ts = () => {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}]`;
};
const log = (...args) => console.log(ts(), ...args);
const logErr = (...args) => console.error(ts(), ...args);

// Plugin: map CDN-loaded globals so require("xlsx") -> window.XLSX etc.
const cdnGlobalsPlugin = {
  name: "cdn-globals",
  setup(build) {
    // Match xlsx, xlsx/dist/xlsx.full.min, etc.
    build.onResolve({ filter: /^xlsx(\/.*)?$/ }, () => ({
      path: "xlsx",
      namespace: "cdn-global",
    }));
    build.onLoad({ filter: /.*/, namespace: "cdn-global" }, () => ({
      contents: `module.exports = window.XLSX;`,
      loader: "js",
    }));
  },
};

// Plugin: handle CRA-style SVG imports (import { ReactComponent } from './file.svg')
const svgPlugin = {
  name: "svg-component",
  setup(build) {
    build.onLoad({ filter: /\.svg$/ }, async (args) => {
      const svg = fs.readFileSync(args.path, "utf-8");
      const escaped = svg.replace(/`/g, "\\`").replace(/\$/g, "\\$");
      return {
        contents: `
          import React from 'react';
          var svgContent = \`${escaped}\`;
          export var ReactComponent = function(props) {
            return React.createElement('span', Object.assign({}, props, {
              dangerouslySetInnerHTML: { __html: svgContent }
            }));
          };
          export default "data:image/svg+xml," + encodeURIComponent(svgContent);
        `,
        loader: "jsx",
      };
    });
  },
};

// Warnings from upstream digit-ui-components we can't fix here — silence them.
const SUPPRESSED_WARNING_IDS = new Set(["duplicate-object-key", "direct-eval"]);

// Live-reload: inject a tiny EventSource client that listens for rebuild events.
// Also prints Vercel-style timestamped build logs with rebuild duration.
const liveReloadPlugin = {
  name: "live-reload",
  setup(build) {
    let startedAt = 0;
    let firstBuild = true;
    build.onStart(() => {
      startedAt = Date.now();
      if (!firstBuild) log("○ Rebuilding…");
    });
    build.onEnd(async (result) => {
      const ms = Date.now() - startedAt;
      const errors = result.errors;
      const warnings = result.warnings.filter((w) => !SUPPRESSED_WARNING_IDS.has(w.id));

      if (warnings.length) {
        const formatted = await esbuild.formatMessages(warnings, {
          kind: "warning",
          color: true,
          terminalWidth: process.stdout.columns || 100,
        });
        for (const line of formatted) process.stderr.write(line);
      }
      if (errors.length) {
        const formatted = await esbuild.formatMessages(errors, {
          kind: "error",
          color: true,
          terminalWidth: process.stdout.columns || 100,
        });
        for (const line of formatted) process.stderr.write(line);
      }

      if (errors.length === 0) {
        log(
          `✓ ${firstBuild ? "Compiled" : "Rebuilt"} in ${ms}ms` +
            (warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? "s" : ""})` : "")
        );
        clients.forEach((res) => res.write("data: reload\n\n"));
      } else {
        logErr(`✗ Build failed in ${ms}ms — ${errors.length} error${errors.length > 1 ? "s" : ""}`);
      }
      firstBuild = false;
    });
  },
};

const clients = new Set();

// Missing localization key tracking
const seenMissingKeys = new Set();
const missingKeysLog = path.resolve(__dirname, "missing-keys.log");

// Tailwind co-process. Compiles `packages/digit-ui-components-v2/src/theme/tailwind.css`
// → `public/vendor/tailwind.css` (which `public/index.html` <link>s in).
//
// We do an initial synchronous compile so the first page load already has the
// stylesheet, then spawn --watch as a child process for subsequent edits. esbuild
// stays the single dev entry point, so naipepea's `node esbuild.dev.js` tmux command
// keeps working unchanged.
function startTailwind() {
  const TW_INPUT = path.resolve(__dirname, "packages/digit-ui-components-v2/src/theme/tailwind.css");
  const TW_OUTPUT = path.resolve(__dirname, "public/vendor/tailwind.css");
  const TW_BIN = path.resolve(__dirname, "node_modules/.bin/tailwindcss");
  if (!fs.existsSync(TW_BIN)) {
    log(
      "\x1b[33m⚠ tailwindcss binary not found at",
      TW_BIN,
      "— v2 styles will not compile. Run `npm install`.\x1b[0m"
    );
    return;
  }
  // Initial compile — block until done so the first request gets fresh CSS.
  const initial = spawnSync(TW_BIN, ["-i", TW_INPUT, "-o", TW_OUTPUT], { stdio: "pipe" });
  if (initial.status !== 0) {
    log("\x1b[31m✗ Initial Tailwind compile failed\x1b[0m", initial.stderr?.toString());
  } else {
    log("\x1b[36m◐ Tailwind compiled (initial)\x1b[0m");
  }
  // Watcher. tailwindcss exits if stdin is closed, so use a writable but
  // disconnected pipe (we never write to it; tailwind will keep the watcher
  // alive on its own fs.watch loop).
  const tw = spawn(TW_BIN, ["-i", TW_INPUT, "-o", TW_OUTPUT, "--watch"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const tag = "\x1b[36m[tw]\x1b[0m";
  tw.stdout.on("data", (d) => process.stderr.write(`${tag} ${d}`));
  tw.stderr.on("data", (d) => process.stderr.write(`${tag} ${d}`));
  tw.on("exit", (code) => log(`${tag} exited (${code})`));
  // Don't leak the child if esbuild dies.
  const cleanup = () => { try { tw.kill(); } catch (_) {} };
  process.once("SIGINT", () => { cleanup(); process.exit(0); });
  process.once("SIGTERM", () => { cleanup(); process.exit(0); });
  process.once("exit", cleanup);
}

async function start() {
  startTailwind();
  // Build context with watch mode
  const ctx = await esbuild.context({
    entryPoints: [path.resolve(__dirname, "src/index.js")],
    bundle: true,
    outdir: path.resolve(__dirname, "build"),
    publicPath: PUBLIC_PATH,
    splitting: false,
    format: "iife",
    target: ["es2018"],
    minify: false,
    sourcemap: true,
    metafile: true,
    treeShaking: true,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    loader: {
      ".js": "jsx",
      ".ts": "ts",
      ".tsx": "tsx",
      ".css": "css",
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".gif": "file",
      ".svg": "file",
    },
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
    alias: {
      // Resolve ALL @egovernments packages from local packages/ source
      "@egovernments/digit-ui-module-core": path.resolve(
        __dirname,
        "packages/modules/core/src/Module.js"
      ),
      // CCRS PGR from products/ overrides upstream packages/modules/pgr
      "@egovernments/digit-ui-module-pgr": path.resolve(
        __dirname,
        "products/pgr/src/Module.js"
      ),
      "@egovernments/digit-ui-module-hrms": path.resolve(
        __dirname,
        "packages/modules/hrms/src/Module.js"
      ),
      "@egovernments/digit-ui-module-utilities": path.resolve(
        __dirname,
        "packages/modules/utilities/src/Module.js"
      ),
      "@egovernments/digit-ui-module-workbench": path.resolve(
        __dirname,
        "packages/modules/workbench/src/Module.js"
      ),
      "@egovernments/digit-ui-module-common": path.resolve(
        __dirname,
        "packages/modules/common/src/Module.js"
      ),
      "@egovernments/digit-ui-libraries": path.resolve(
        __dirname,
        "packages/libraries/src/index.js"
      ),
      "@egovernments/digit-ui-react-components": path.resolve(
        __dirname,
        "packages/react-components/src/index.js"
      ),
      "@egovernments/digit-ui-components": path.resolve(
        __dirname,
        "packages/digit-ui-components/src/index.js"
      ),
      "@egovernments/digit-ui-components-v2": path.resolve(
        __dirname,
        "packages/digit-ui-components-v2/src/index.ts"
      ),
      "@egovernments/digit-ui-svg-components": path.resolve(
        __dirname,
        "packages/svg-components/src/index.js"
      ),
      // Force single instance of shared packages
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom"),
      "react-redux": path.resolve(__dirname, "node_modules/react-redux"),
      "react-query": path.resolve(__dirname, "node_modules/react-query"),
    },
    nodePaths: [path.resolve(__dirname, "node_modules")],
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
      global: "window",
    },
    plugins: [cdnGlobalsPlugin, svgPlugin, liveReloadPlugin],
    logLevel: "silent",
  });

  // Initial build
  const result = await ctx.rebuild();

  // Generate index.html from public/index.html with injected bundles
  generateHTML(result);

  // Watch for file changes
  await ctx.watch();
  log("◐ Watching for changes…");

  // Serve static files + live-reload SSE endpoint + API proxy
  const buildDir = path.resolve(__dirname, "build");
  const publicDir = path.resolve(__dirname, "public");

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // SSE endpoint for live reload
    if (pathname === "/digit-ui/__esbuild_live_reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // POST /digit-ui/__missing_keys — log missing localization keys
    if (pathname === "/digit-ui/__missing_keys" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { keys, page } = JSON.parse(body);
          if (Array.isArray(keys)) {
            keys.forEach((k) => {
              if (!seenMissingKeys.has(k)) {
                seenMissingKeys.add(k);
                const line = `${new Date().toISOString()}\t${k}\t${page || "-"}`;
                log(`\x1b[33m⚠ MISSING KEY\x1b[0m ${k} \x1b[90m← ${page || "-"}\x1b[0m`);
                fs.appendFileSync(missingKeysLog, line + "\n");
              }
            });
          }
        } catch (e) {
          logErr("Bad __missing_keys payload:", e.message);
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    // Serve globalConfigs.js — prefer GLOBAL_CONFIGS env var, fall back to public/
    if (pathname === "/digit-ui/globalConfigs.js") {
      const gcPath = (GLOBAL_CONFIGS && fs.existsSync(GLOBAL_CONFIGS))
        ? GLOBAL_CONFIGS
        : path.resolve(__dirname, "public/globalConfigs.js");
      if (fs.existsSync(gcPath)) {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(fs.readFileSync(gcPath));
      } else {
        res.writeHead(404);
        res.end("globalConfigs.js not found");
      }
      return;
    }

    // Serve vendored assets (e.g. the transformed digit-ui-css) from public/vendor/
    if (pathname.startsWith("/digit-ui/vendor/")) {
      const subPath = pathname.slice("/digit-ui/vendor/".length);
      const vendorPath = path.resolve(__dirname, "public/vendor", subPath);
      if (fs.existsSync(vendorPath) && fs.statSync(vendorPath).isFile()) {
        const ext = path.extname(vendorPath);
        const ct = ext === ".css" ? "text/css" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-cache" });
        res.end(fs.readFileSync(vendorPath));
        return;
      }
      res.writeHead(404);
      res.end("vendor asset not found");
      return;
    }

    // Proxy all non-static requests to Kong or Keycloak, with logging.
    const kcPrefixes = ["/realms/", "/token-exchange/", "/register", "/check-email"];
    const isKc = kcPrefixes.some((p) => pathname.startsWith(p));

    // Everything that isn't a /digit-ui/ asset goes to the backend
    if (!pathname.startsWith("/digit-ui")) {
      const target = isKc ? PROXY_KC_PORT : PROXY_PORT;
      const apiStart = Date.now();
      // Extract page from Referer header (e.g. /digit-ui/employee/hrms/inbox → hrms/inbox)
      const referer = req.headers.referer || "";
      const page = referer.replace(/^https?:\/\/[^/]+/, "").replace(/^\/digit-ui\//, "").replace(/\?.*$/, "") || "-";
      const proxyReq = http.request(
        {
          hostname: "127.0.0.1",
          port: target,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: req.headers.host },
        },
        (proxyRes) => {
          const ms = Date.now() - apiStart;
          const status = proxyRes.statusCode;
          const color = status < 400 ? "\x1b[32m" : "\x1b[31m";
          log(`${color}${req.method}\x1b[0m ${status} ${pathname} \x1b[90m${ms}ms ← ${page}\x1b[0m`);
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on("error", (err) => {
        logErr(`Proxy error: ${err.message}`);
        res.writeHead(502);
        res.end("Bad Gateway");
      });
      req.pipe(proxyReq);
      return;
    }

    // Static file serving from build dir (strip /digit-ui/ prefix)
    let filePath;
    if (pathname.startsWith("/digit-ui/")) {
      const subPath = pathname.slice("/digit-ui/".length);
      filePath = path.join(buildDir, subPath);
    } else if (pathname === "/digit-ui" || pathname === "/") {
      filePath = path.join(buildDir, "index.html");
    } else {
      filePath = path.join(buildDir, pathname);
    }

    // Try to serve the file
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
      };
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(fs.readFileSync(filePath));
      return;
    }

    // SPA fallback: serve index.html for any unmatched /digit-ui/* route
    if (pathname.startsWith("/digit-ui")) {
      const indexPath = path.join(buildDir, "index.html");
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
        res.end(fs.readFileSync(indexPath));
        return;
      }
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(PORT, HOST, () => {
    log(`▲ Ready — http://${HOST}:${PORT}/digit-ui/`);
    log(`  API proxy → 127.0.0.1:${PROXY_PORT} (Kong) / 127.0.0.1:${PROXY_KC_PORT} (Keycloak)`);
    log(`  Live reload enabled — editing any source file triggers rebuild + refresh`);
  });
}

function generateHTML(result) {
  const html = fs.readFileSync(
    path.resolve(__dirname, "public/index.html"),
    "utf-8"
  );

  const outputs = Object.keys(result.metafile.outputs);
  const entryJS = outputs
    .filter((f) => f.endsWith(".js") && result.metafile.outputs[f].entryPoint)
    .map((f) => path.basename(f));
  const cssFiles = outputs
    .filter((f) => f.endsWith(".css"))
    .map((f) => path.basename(f));

  const scriptTags = entryJS
    .map((f) => `  <script src="${PUBLIC_PATH}${f}"></script>`)
    .join("\n");
  const linkTags = cssFiles
    .map((f) => `  <link rel="stylesheet" href="${PUBLIC_PATH}${f}">`)
    .join("\n");

  // Inject live-reload client script — always active since this is a dev server.
  const liveReloadScript = `
  <script>
    (function() {
      var source = new EventSource('/digit-ui/__esbuild_live_reload');
      source.onmessage = function() { window.location.reload(); };
      source.onerror = function() { source.close(); };
    })();
  </script>`;

  // Inject missing-key collector — batches unique missing i18n keys and sends to dev server every 5s.
  const missingKeyScript = `
  <script>
    window.__digitMissingKeys = (function() {
      var seen = {};
      var pending = [];
      setInterval(function() {
        if (!pending.length) return;
        var batch = pending.splice(0);
        fetch('/digit-ui/__missing_keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: batch, page: location.pathname, ts: Date.now() }),
        }).catch(function() {});
      }, 5000);
      return function(key) {
        if (seen[key]) return;
        seen[key] = 1;
        pending.push(key);
      };
    })();
  </script>`;

  const injected = html
    .replace("</head>", `${linkTags}\n</head>`)
    .replace("</body>", `${scriptTags}\n${liveReloadScript}\n${missingKeyScript}\n</body>`);

  fs.mkdirSync(path.resolve(__dirname, "build"), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, "build/index.html"), injected);
}

start().catch((err) => {
  logErr("✗ Fatal:", err);
  process.exit(1);
});
