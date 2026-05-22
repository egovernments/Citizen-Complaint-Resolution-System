// Tiny Express app exposing the Novu Bridge endpoint.
// Novu's API calls POST /novu (the route this server registers via
// `serve()`) at trigger time to render workflow steps.

import express from 'express';
import { serve } from '@novu/framework/express';
import { ALL_WORKFLOWS } from './workflows.js';

const PORT = process.env.PORT || 3000;
const NOVU_SECRET_KEY = process.env.NOVU_SECRET_KEY;

if (!NOVU_SECRET_KEY) {
  // Bridge auth happens via this key — Novu's API signs the request,
  // the framework verifies. Without it the bridge accepts unsigned
  // requests, which is fine for the in-cluster compose case but a
  // foot-gun on a publicly-exposed endpoint.
  console.warn('NOVU_SECRET_KEY not set — bridge will accept unsigned requests');
}

const app = express();

app.use(express.json());

// Healthcheck for compose/k8s probes.
app.get('/health', (_req, res) => res.json({ status: 'ok', workflowCount: ALL_WORKFLOWS.length }));

// The Bridge endpoint. Mount at /novu — that's the default Novu API
// expects when it calls back into the bridge. Path can be overridden
// at workflow-create time via the `bridgeUrl` parameter.
app.use(
  '/novu',
  serve({
    workflows: ALL_WORKFLOWS,
    // STRICT_AUTH=false drops signature verification for in-cluster
    // calls. Flip to true (the default) when exposing the bridge
    // publicly.
    strictAuthentication: process.env.STRICT_AUTH !== 'false',
  }),
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[novu-bridge-endpoint] listening on :${PORT}, workflows: ${ALL_WORKFLOWS.length}`);
  for (const w of ALL_WORKFLOWS) {
    console.log(`  - ${w.id}`);
  }
});
