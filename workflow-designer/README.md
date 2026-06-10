# workflow-designer

Lives at `workflow-designer/` in the CCRS monorepo. Forked from `workflow.egov.theflywheel.in/designer/`. Vanilla React 18 SPA for editing DIGIT workflow state machines (PGR / Trade License / Property Tax etc). Renders a graph of states + action pills, auto-layout via dagre, JSON inspector, and a `postMessage` bridge so it can be embedded in an iframe inside the configurator (see `configurator/src/components/widgets/DesignerIframe.tsx`) and load/save workflows from a parent page.

In production the built `dist/` is dropped at `/var/www/.../designer/` on each tenant host and served by nginx alongside `/configurator/`. See `docs/escalation-feature-bomet.md` for the live deployment.

## Develop

```bash
npm install
npm run dev          # esbuild --watch → dist/
```

Then serve `dist/` over any static server (e.g. `python3 -m http.server -d dist 8000`).

## Build

```bash
npm run build        # one-shot, minified, sourcemap
```

Output: `dist/{index.html, designer.js, styles.css}`. Drop into any `/designer/` path on a domain.

## postMessage bridge

When the designer detects it's running inside an iframe (`window.parent !== window`), it:

1. Posts `{ type: 'designer-ready', version: '0.1.0' }` to the parent on mount.
2. Listens for `{ type: 'load-workflow', workflow, layout }` from any whitelisted origin and replaces the in-memory state.
3. Exposes a Save button on the topbar that posts `{ type: 'save-workflow', workflow, layout }` back to the parent.

Allowed parent origins are baked in via `src/postmessage-bridge.js` (`bometfeedbackhub.digit.org`, `naipepea.digit.org`, `localhost`). Edit the list there or pass `extraOrigins` to `initBridge`.

## Test

```bash
npm test             # node --test on tests/
```
