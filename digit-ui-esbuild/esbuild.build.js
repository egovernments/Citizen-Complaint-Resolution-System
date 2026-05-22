const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const PUBLIC_PATH = "/digit-ui/";

// Compile v2 Tailwind stylesheet (single output, minified) before esbuild builds.
// Output lands at public/vendor/tailwind.css and gets copied into build/ by the
// public-asset copy step further down.
function buildTailwind() {
  const TW_INPUT = path.resolve(__dirname, "packages/digit-ui-components-v2/src/theme/tailwind.css");
  const TW_OUTPUT = path.resolve(__dirname, "public/vendor/tailwind.css");
  const TW_BIN = path.resolve(__dirname, "node_modules/.bin/tailwindcss");
  if (!fs.existsSync(TW_BIN)) {
    console.error("✗ tailwindcss binary not found — run `npm install` first.");
    process.exit(1);
  }
  const result = spawnSync(TW_BIN, ["-i", TW_INPUT, "-o", TW_OUTPUT, "--minify"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("✗ Tailwind build failed.");
    process.exit(result.status || 1);
  }
}

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

async function build() {
  buildTailwind();
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, "src/index.js")],
    bundle: true,
    outdir: path.resolve(__dirname, "build"),
    publicPath: PUBLIC_PATH,
    splitting: false,
    format: "iife",
    target: ["es2018"],
    minify: true,
    sourcemap: false,
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
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom"),
      "react-redux": path.resolve(__dirname, "node_modules/react-redux"),
      "react-query": path.resolve(__dirname, "node_modules/react-query"),
    },
    nodePaths: [path.resolve(__dirname, "node_modules")],
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
      global: "window",
    },
    plugins: [cdnGlobalsPlugin, svgPlugin],
    logLevel: "info",
  });

  // Generate index.html
  generateHTML(result);

  // Copy public assets to build (recursively — excludes the source index.html,
  // which is regenerated above, and walks subdirs like public/vendor/).
  function copyRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      // Skip vendor-pipeline regeneration artifacts (upstream snapshots) —
      // they live alongside the transformed output for local diffing but
      // shouldn't ship to production. Matches <name>.original.css for any
      // source in scripts/vendor-digit-ui-css.js's SOURCES array.
      if (entry.name.endsWith(".original.css")) continue;
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) copyRecursive(s, d);
      else if (entry.isFile()) fs.copyFileSync(s, d);
    }
  }

  const publicDir = path.resolve(__dirname, "public");
  const buildDir = path.resolve(__dirname, "build");
  for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
    if (entry.name === "index.html") continue; // already generated
    const src = path.join(publicDir, entry.name);
    const dest = path.join(buildDir, entry.name);
    if (entry.isDirectory()) copyRecursive(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }

  console.log("\nBuild complete! Output in build/");
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

  const injected = html
    .replace("</head>", `${linkTags}\n</head>`)
    .replace("</body>", `${scriptTags}\n</body>`);

  fs.mkdirSync(path.resolve(__dirname, "build"), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, "build/index.html"), injected);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
