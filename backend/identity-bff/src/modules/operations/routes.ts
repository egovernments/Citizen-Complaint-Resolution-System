import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { getPollerReadiness } from "../revocation/poller.js";
import { getReconcileReadiness } from "../sync/reconcile.js";
import { collectReadiness, dependencyProbes, type ReadinessProbes } from "./readiness.js";

export function registerOperationalRoutes(
  app: express.Application,
  probes: () => ReadinessProbes = () => dependencyProbes({ poller: getPollerReadiness, reconcile: getReconcileReadiness }),
): void {
  app.get("/livez", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", asyncRoute(async (_request, response) => {
    const result = await collectReadiness(probes());
    response.setHeader("Cache-Control", "no-store");
    return response.status(result.status === "ready" ? 200 : 503).json(result);
  }));
}
