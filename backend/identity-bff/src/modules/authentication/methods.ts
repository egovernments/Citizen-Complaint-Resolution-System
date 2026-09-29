import { config } from "../../infrastructure/config.js";
import {
  enabledIdentityProviders,
  identityClient,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import type { IdentityAuthMethod } from "./types.js";
import type { IdentityAuthIntent } from "./types.js";
import { DEFAULT_SURFACE, type IdentitySurface } from "./surfaces.js";

const SIGNIN_METHODS = "digit.auth.signin.methods";
const SIGNUP_METHODS = "digit.auth.signup.methods";
const SURFACE_ATTRIBUTE = "digit.auth.surface";
const METHOD_CATALOG_TTL_MS = 10_000;

interface IdentityMethodCatalog {
  signin: string[];
  signup: string[];
  providers: Awaited<ReturnType<typeof enabledIdentityProviders>>;
  magicLinkEnabled: boolean;
}

const catalogCache = new Map<IdentitySurface, {
  expiresAt: number;
  promise: Promise<IdentityMethodCatalog>;
}>();

function methodIds(value: string | undefined, attribute: string, optional = false): string[] {
  if (value === undefined && optional) return [];
  if (value === undefined) {
    throw new IdentityAdminError(`Keycloak client attribute ${attribute} is not configured`, 503);
  }
  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (ids.some((id) => !/^[a-z0-9._-]+$/.test(id))) {
    throw new IdentityAdminError(`Keycloak client attribute ${attribute} is invalid`, 503);
  }
  return ids;
}

function providerName(alias: string, displayName: string): string {
  if (alias.toLowerCase() === "github") return "GitHub";
  if (alias.toLowerCase() === "google") return "Google";
  const name = displayName.trim() || alias;
  return name === alias
    ? alias
      .split(/[._-]+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
    : name;
}

function providerLabel(alias: string, displayName: string): string {
  const name = providerName(alias, displayName);
  return /^(continue with|log in with)\b/i.test(name)
    ? name
    : `Continue with ${name}`;
}

function surfaceClient(surface: IdentitySurface): { clientId: string; secret: string } {
  if (surface === "employee") {
    return { clientId: config.keycloakEmployeeClientId, secret: config.keycloakEmployeeClientSecret };
  }
  if (surface === "citizen") {
    return { clientId: config.keycloakCitizenClientId, secret: config.keycloakCitizenClientSecret };
  }
  return { clientId: config.keycloakBffClientId, secret: config.keycloakBffClientSecret };
}

/**
 * Each surface's sign-in policy is read from its OWN Keycloak client, so the
 * configurator, employee and citizen journeys can offer different methods
 * without sharing a client or a flow.
 */
async function loadIdentityMethodCatalog(surface: IdentitySurface): Promise<IdentityMethodCatalog> {
  const { clientId, secret } = surfaceClient(surface);
  if (surface !== DEFAULT_SURFACE && !secret) {
    throw new IdentityAdminError(`The ${surface} sign-in client is not configured`, 503);
  }
  const client = await identityClient(clientId);
  if (!client?.enabled || !client.standardFlowEnabled) {
    throw new IdentityAdminError(`The Keycloak ${surface} sign-in client is not enabled`, 503);
  }
  const declaredSurface = client.attributes[SURFACE_ATTRIBUTE];
  if (declaredSurface !== undefined && declaredSurface !== surface) {
    throw new IdentityAdminError(`Keycloak client attribute ${SURFACE_ATTRIBUTE} is invalid`, 503);
  }

  const signin = methodIds(client.attributes[SIGNIN_METHODS], SIGNIN_METHODS);
  // kcadm drops an empty `-s attributes.x=`; employee/citizen clients offer
  // no self-service signup, so an absent signup attribute means "none".
  const signup = methodIds(
    client.attributes[SIGNUP_METHODS],
    SIGNUP_METHODS,
    surface !== DEFAULT_SURFACE,
  );
  const configured = [...new Set([...signin, ...signup])];
  const [providers, magicClient] = await Promise.all([
    configured.some((id) => id !== "password" && id !== "magic_link")
      ? enabledIdentityProviders()
      : Promise.resolve(new Map()),
    surface === DEFAULT_SURFACE && configured.includes("magic_link")
      ? identityClient(config.keycloakMagicLinkClientId)
      : Promise.resolve(null),
  ]);

  return {
    signin,
    signup,
    providers,
    magicLinkEnabled: Boolean(
      magicClient?.enabled && magicClient.standardFlowEnabled &&
      config.keycloakMagicLinkClientSecret,
    ),
  };
}

async function identityMethodCatalog(surface: IdentitySurface): Promise<IdentityMethodCatalog> {
  const now = Date.now();
  const cached = catalogCache.get(surface);
  if (cached && now < cached.expiresAt) return cached.promise;

  const promise = loadIdentityMethodCatalog(surface);
  catalogCache.set(surface, { expiresAt: now + METHOD_CATALOG_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    // Do not turn a transient Admin API failure into a cached outage.
    if (catalogCache.get(surface)?.promise === promise) catalogCache.delete(surface);
    throw error;
  }
}

/** Test/control-plane hook for a known Keycloak policy update. */
export function resetIdentityMethodCatalog(): void {
  catalogCache.clear();
}

export async function enabledIdentityMethods(
  intent?: IdentityAuthIntent,
  surface: IdentitySurface = DEFAULT_SURFACE,
): Promise<IdentityAuthMethod[]> {
  const { signin, signup, providers, magicLinkEnabled } = await identityMethodCatalog(surface);
  const ordered = [...new Set([...signin, ...signup])];
  const policy = new Map(ordered.map((id) => [id, ([
    ...(signin.includes(id) ? ["signin"] : []),
    ...(signup.includes(id) ? ["signup"] : []),
  ] as IdentityAuthIntent[])]));
  const requested = intent === "signin" ? signin : intent === "signup" ? signup : ordered;

  return requested.flatMap((id): IdentityAuthMethod[] => {
    const intents = policy.get(id) || [];
    if (id === "password") {
      return [{
        id,
        label: surface === DEFAULT_SURFACE ? "Email and password" : "Username and password",
        type: "password",
        intents,
      }];
    }
    if (id === "magic_link") {
      return surface === DEFAULT_SURFACE && magicLinkEnabled
        ? [{ id, label: "Email me a sign-in link", type: "magic_link", intents }]
        : [];
    }
    const provider = providers.get(id);
    return provider
      ? [{ id, label: providerLabel(provider.alias, provider.displayName), type: "oauth", idpHint: id, intents }]
      : [];
  });
}
