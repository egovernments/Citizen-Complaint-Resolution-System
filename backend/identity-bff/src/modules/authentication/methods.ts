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

function providerLabel(displayName: string): string {
  return /^continue with\b/i.test(displayName)
    ? displayName
    : `Continue with ${displayName}`;
}

export async function enabledIdentityMethods(
  intent?: IdentityAuthIntent,
): Promise<IdentityAuthMethod[]> {
  const client = await identityClient(config.keycloakBffClientId);
  if (!client?.enabled || !client.standardFlowEnabled) {
    throw new IdentityAdminError("The Keycloak Identity BFF client is not enabled", 503);
  }

  const signin = methodIds(client.attributes[SIGNIN_METHODS], SIGNIN_METHODS);
  const signup = methodIds(client.attributes[SIGNUP_METHODS], SIGNUP_METHODS);
  const ordered = [...new Set([...signin, ...signup])];
  const policy = new Map(ordered.map((id) => [id, ([
    ...(signin.includes(id) ? ["signin"] : []),
    ...(signup.includes(id) ? ["signup"] : []),
  ] as IdentityAuthIntent[])]));
  const requested = intent === "signin" ? signin : intent === "signup" ? signup : ordered;
  const needsProviders = requested.some((id) => id !== "password" && id !== "magic_link");
  const needsMagicLink = requested.includes("magic_link");
  const [providers, magicClient] = await Promise.all([
    needsProviders ? enabledIdentityProviders() : Promise.resolve(new Map()),
    needsMagicLink ? identityClient(config.keycloakMagicLinkClientId) : Promise.resolve(null),
  ]);

  return requested.flatMap((id): IdentityAuthMethod[] => {
    const intents = policy.get(id) || [];
    if (id === "password") {
      return [{ id, label: "Email and password", type: "password", intents }];
    }
    if (id === "magic_link") {
      return magicClient?.enabled && magicClient.standardFlowEnabled &&
        Boolean(config.keycloakMagicLinkClientSecret)
        ? [{ id, label: "Email me a sign-in link", type: "magic_link", intents }]
        : [];
    }
    const provider = providers.get(id);
    return provider
      ? [{ id, label: providerLabel(provider.displayName), type: "oauth", idpHint: id, intents }]
      : [];
  });
}
