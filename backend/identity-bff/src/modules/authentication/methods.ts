import { config } from "../../infrastructure/config.js";
import {
  enabledIdentityProviders,
  identityClient,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import type { IdentityAuthMethod } from "./types.js";
import type { IdentityAuthIntent } from "./types.js";

const SIGNIN_METHODS = "digit.auth.signin.methods";
const SIGNUP_METHODS = "digit.auth.signup.methods";
const METHOD_CATALOG_TTL_MS = 10_000;

interface IdentityMethodCatalog {
  signin: string[];
  signup: string[];
  providers: Awaited<ReturnType<typeof enabledIdentityProviders>>;
  magicLinkEnabled: boolean;
}

let catalogCache: {
  expiresAt: number;
  promise: Promise<IdentityMethodCatalog>;
} | null = null;

function methodIds(value: string | undefined, attribute: string): string[] {
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

async function loadIdentityMethodCatalog(): Promise<IdentityMethodCatalog> {
  const client = await identityClient(config.keycloakBffClientId);
  if (!client?.enabled || !client.standardFlowEnabled) {
    throw new IdentityAdminError("The Keycloak Identity BFF client is not enabled", 503);
  }

  const signin = methodIds(client.attributes[SIGNIN_METHODS], SIGNIN_METHODS);
  const signup = methodIds(client.attributes[SIGNUP_METHODS], SIGNUP_METHODS);
  const configured = [...new Set([...signin, ...signup])];
  const [providers, magicClient] = await Promise.all([
    configured.some((id) => id !== "password" && id !== "magic_link")
      ? enabledIdentityProviders()
      : Promise.resolve(new Map()),
    configured.includes("magic_link")
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

async function identityMethodCatalog(): Promise<IdentityMethodCatalog> {
  const now = Date.now();
  if (catalogCache && now < catalogCache.expiresAt) return catalogCache.promise;

  const promise = loadIdentityMethodCatalog();
  catalogCache = { expiresAt: now + METHOD_CATALOG_TTL_MS, promise };
  try {
    return await promise;
  } catch (error) {
    // Do not turn a transient Admin API failure into a cached outage.
    if (catalogCache?.promise === promise) catalogCache = null;
    throw error;
  }
}

/** Test/control-plane hook for a known Keycloak policy update. */
export function resetIdentityMethodCatalog(): void {
  catalogCache = null;
}

export async function enabledIdentityMethods(
  intent?: IdentityAuthIntent,
): Promise<IdentityAuthMethod[]> {
  const { signin, signup, providers, magicLinkEnabled } = await identityMethodCatalog();
  const ordered = [...new Set([...signin, ...signup])];
  const policy = new Map(ordered.map((id) => [id, ([
    ...(signin.includes(id) ? ["signin"] : []),
    ...(signup.includes(id) ? ["signup"] : []),
  ] as IdentityAuthIntent[])]));
  const requested = intent === "signin" ? signin : intent === "signup" ? signup : ordered;

  return requested.flatMap((id): IdentityAuthMethod[] => {
    const intents = policy.get(id) || [];
    if (id === "password") {
      return [{ id, label: "Email and password", type: "password", intents }];
    }
    if (id === "magic_link") {
      return magicLinkEnabled
        ? [{ id, label: "Email me a sign-in link", type: "magic_link", intents }]
        : [];
    }
    const provider = providers.get(id);
    return provider
      ? [{ id, label: providerLabel(provider.alias, provider.displayName), type: "oauth", idpHint: id, intents }]
      : [];
  });
}
