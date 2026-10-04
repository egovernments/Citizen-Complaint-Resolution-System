import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { errorBody, errorStatus, type HttpErrorCode } from "../../contract/error-codes.js";
import { config } from "../../infrastructure/config.js";
import { asyncRoute } from "../../app/async-route.js";
import { currentSession } from "../sessions/current-session.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { OnboardingError } from "./errors.js";
import type { OnboardingPrimitives } from "./primitives.js";

const PREFIX = "/internal/identity/v1";
const READS = new Set(["/sessions/_introspect", "/identifiers/_check"]);
const MUTATIONS = new Set(["/organizations/_ensure", "/organizations/_lifecycle", "/memberships/_ensure", "/bindings/_ensure"]);

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Called by the common internal auth middleware before operator auth. */
export function onboardingAuthorization(req: express.Request, res: express.Response): boolean | undefined {
  const path = req.path.toLowerCase().replace(/\/$/, "");
  if (!READS.has(path) && !MUTATIONS.has(path)) return undefined;
  const tokens = [config.identityOnboardingToken,
    ...(READS.has(path) ? [config.identitySessionIntrospectionToken] : [])].filter(Boolean);
  if (!tokens.length) {
    res.status(503).json(errorBody("CONTROL_PLANE_NOT_CONFIGURED", "Onboarding is not configured"));
    return false;
  }
  const header = req.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !tokens.some((token) => sameSecret(supplied, token))) {
    res.status(401).json(errorBody("WORKLOAD_UNAUTHORIZED", "Invalid workload credential"));
    return false;
  }
  return true;
}

export interface Identifier { type: string; value: string }
export interface FounderIdentity {
  subject: string; email?: string; emailVerified: boolean; name?: string; preferredUsername?: string;
}
export interface OnboardingRouteDependencies {
  primitives: Pick<OnboardingPrimitives, "ensure" | "lifecycle" | "membership" | "binding">;
  identity(subject: string): Promise<FounderIdentity | null>;
  identifiers(identifiers: Identifier[]): Promise<Array<Identifier & { available: boolean }>>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new OnboardingError("INVALID_REQUEST", `${field} is required`);
  return value.trim();
}
function attempt(body: Record<string, unknown>) {
  const operationId = string(body.operationId, "operationId");
  if (!Number.isSafeInteger(body.restartNo) || (body.restartNo as number) < 0) {
    throw new OnboardingError("INVALID_REQUEST", "restartNo must be a non-negative integer");
  }
  return { operationId, restartNo: body.restartNo as number };
}
function founder(body: Record<string, unknown>) {
  return { ...attempt(body), subject: string(body.subject, "subject"), tenantId: string(body.tenantId, "tenantId") };
}
function identifiers(body: Record<string, unknown>): Identifier[] {
  const items = body.identifiers === undefined ? [body] : body.identifiers;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new OnboardingError("INVALID_REQUEST", "identifiers must contain 1 to 20 items");
  }
  return items.map((item) => {
    const type = string(item?.type, "type").toUpperCase();
    const value = string(item?.value, "value");
    if (!["ORGANIZATION_NAME", "ORGANIZATION_ALIAS", "URL_SLUG", "ACCOUNT_CODE", "TENANT_ID"].includes(type)) {
      throw new OnboardingError("INVALID_REQUEST", "Unsupported identifier type");
    }
    return { type, value };
  });
}

function sendError(error: unknown, res: express.Response) {
  let code: HttpErrorCode = "IDENTITY_UNAVAILABLE";
  let message = "The identity service is unavailable";
  if (error instanceof OnboardingError) { code = error.code; message = error.message; }
  else if (error instanceof DigitUnavailableError) { code = "DIGIT_UNAVAILABLE"; message = error.message; }
  else if (error && typeof error === "object" && "code" in error &&
    ["BINDING_CONFLICT", "DIGIT_ACCOUNT_LINKED_ELSEWHERE", "DIGIT_ACCOUNT_NOT_FOUND", "BINDING_BUSY", "IDENTITY_BUSY", "DIGIT_UNAVAILABLE"].includes(String(error.code))) {
    code = error.code as HttpErrorCode;
    message = error instanceof Error ? error.message : message;
  }
  if (code === "IDENTITY_BUSY" || code === "BINDING_BUSY") res.setHeader("Retry-After", "1");
  return res.status(errorStatus(code)).json(errorBody(code, message));
}

/** Registration is separate so contract tests exercise real routes with controlled dependency failures. */
export function registerOnboardingRoutes(app: express.Application, dependencies: OnboardingRouteDependencies): void {
  const route = (path: string, handler: (req: express.Request) => Promise<unknown>) => {
    app.post(`${PREFIX}${path}`, asyncRoute(async (req, res) => {
      try { return res.json(await handler(req)); }
      catch (error) { return sendError(error, res); }
    }));
  };
  route("/sessions/_introspect", async (req) => {
    const current = await currentSession(req.headers.cookie, "configurator");
    if (!current) throw new OnboardingError("SESSION_REQUIRED", "A configurator session is required");
    const identity = await dependencies.identity(current.session.claims.sub);
    if (!identity) throw new OnboardingError("SESSION_REQUIRED", "The founder identity is unavailable");
    return { active: true, identity: { issuer: config.keycloakIssuer, ...identity } };
  });
  route("/identifiers/_check", async (req) => {
    const body = req.body ?? {};
    const results = await dependencies.identifiers(identifiers(body));
    return body.identifiers === undefined ? results[0] : { results };
  });
  route("/organizations/_ensure", async (req) => {
    const body = req.body ?? {};
    const slug = string(body.slug, "slug").toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) throw new OnboardingError("INVALID_REQUEST", "slug is invalid");
    return dependencies.primitives.ensure({ ...attempt(body), tenantId: string(body.tenantId, "tenantId"), slug, name: string(body.name, "name") });
  });
  route("/organizations/_lifecycle", async (req) => {
    const body = req.body ?? {};
    if (body.state !== "ACTIVE" && body.state !== "FAILED") throw new OnboardingError("INVALID_REQUEST", "state must be ACTIVE or FAILED");
    return dependencies.primitives.lifecycle({ ...attempt(body), state: body.state });
  });
  route("/memberships/_ensure", async (req) => dependencies.primitives.membership(founder(req.body ?? {})));
  route("/bindings/_ensure", async (req) => dependencies.primitives.binding({ ...founder(req.body ?? {}), digitUuid: string(req.body?.digitUuid, "digitUuid") }));
}
