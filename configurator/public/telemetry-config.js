/*
 * Ops kill switch for the Configurator's own telemetry (PostHog + Sentry).
 *
 * Shipped inside dist, so index.html and this file always deploy together and
 * cannot skew — that is why index.html can reference it with a plain <script
 * src> even though a missing file under /configurator/ would otherwise be served
 * as the SPA shell by nginx try_files.
 *
 * kill: false keeps today's behaviour on every already-deployed environment.
 * Set it to true on the box (/var/www/configurator/telemetry-config.js) to stop
 * this app sending anything; the next deploy rsyncs dist over it, so make it
 * durable with `VITE_CFG_TELEMETRY_KILL=true` at build time instead.
 *
 * Plain ES5 on purpose: public/ is copied byte-for-byte and never transpiled.
 */
window.__CFG_TELEMETRY__ = { kill: false };
