const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const OUTDIR = path.resolve(__dirname, "build");
const PUBLIC_PATH = "/digit-ui/";

// Plugin: map CDN-loaded globals so require("xlsx") → window.XLSX etc.
const cdnGlobalsPlugin = {
  name: "cdn-globals",
  setup(build) {
    const globals = {
      xlsx: "XLSX",
    };
    for (const [pkg, globalName] of Object.entries(globals)) {
      build.onResolve({ filter: new RegExp("^" + pkg + "$") }, () => ({
        path: pkg,
        namespace: "cdn-global",
      }));
    }
    build.onLoad({ filter: /.*/, namespace: "cdn-global" }, (args) => ({
      contents: `module.exports = window.${globals[args.path]};`,
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
  const start = Date.now();

  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, "src/index.js")],
    bundle: true,
    outdir: OUTDIR,
    publicPath: PUBLIC_PATH,
    splitting: false,
    format: "iife",
    target: ["es2018"],
    minify: true,
    metafile: true,
    treeShaking: true,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    loader: {
      ".js": "jsx",
      ".css": "css",
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".gif": "file",
      ".svg": "file",
    },
    alias: {
      // Resolve all @egovernments packages from LOCAL SOURCE for live editing
      "@egovernments/digit-ui-module-core": path.resolve(
        __dirname,
        "micro-ui-internals/packages/modules/core/src/Module.js"
      ),
      "@egovernments/digit-ui-module-pgr": path.resolve(
        __dirname,
        "micro-ui-internals/packages/modules/pgr/src/Module.js"
      ),
      "@egovernments/digit-ui-libraries": path.resolve(
        __dirname,
        "micro-ui-internals/packages/libraries/src/index.js"
      ),
      "@egovernments/digit-ui-react-components": path.resolve(
        __dirname,
        "micro-ui-internals/packages/react-components/src/index.js"
      ),
      // These don't have local source — resolve from node_modules
      "@egovernments/digit-ui-components": path.resolve(
        __dirname,
        "node_modules/@egovernments/digit-ui-components"
      ),
      "@egovernments/digit-ui-svg-components": path.resolve(
        __dirname,
        "node_modules/@egovernments/digit-ui-svg-components"
      ),
      // Force single instance of shared packages to prevent duplication
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom"),
      "react-redux": path.resolve(__dirname, "node_modules/react-redux"),
      "react-query": path.resolve(__dirname, "node_modules/react-query"),
    },
    nodePaths: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(__dirname, "micro-ui-internals/node_modules"),
    ],
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
      global: "window",
    },
    plugins: [cdnGlobalsPlugin, svgPlugin],
    logLevel: "info",
  });

  // --- Inject bundles into index.html ---
  const html = fs.readFileSync(
    path.resolve(__dirname, "public/index.html"),
    "utf-8"
  );

  const outputs = Object.keys(result.metafile.outputs);
  // Entry chunks (not internal chunks)
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

  fs.writeFileSync(path.resolve(OUTDIR, "index.html"), injected);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nesbuild done in ${elapsed}s`);

  // Print size summary
  const analyze = await esbuild.analyzeMetafile(result.metafile, {
    verbose: false,
  });
  console.log(analyze);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
