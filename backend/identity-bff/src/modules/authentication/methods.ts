import { config } from "../../infrastructure/config.js";
import {
  enabledIdentityClientIds,
  enabledIdentityProviderAliases,
} from "../organizations/organization-service.js";
import type { IdentityAuthMethod } from "./types.js";
import type { IdentityAuthIntent } from "./types.js";

export async function enabledIdentityMethods(
  intent?: IdentityAuthIntent,
): Promise<IdentityAuthMethod[]> {
  const needsProviders = config.identityAuthMethods.some((method) => method.type === "oauth");
  const needsMagicLink = config.identityAuthMethods.some((method) => method.type === "magic_link");
  const [providerAliases, clientIds] = await Promise.all([
    needsProviders
      ? enabledIdentityProviderAliases().catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    needsMagicLink
      ? enabledIdentityClientIds([config.keycloakMagicLinkClientId]).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);
  return config.identityAuthMethods.filter((method) => {
    if (intent && !method.intents.includes(intent)) return false;
    return method.type === "password" ||
      (method.type === "oauth" && Boolean(method.idpHint && providerAliases.has(method.idpHint))) ||
      (method.type === "magic_link" &&
        Boolean(config.keycloakMagicLinkClientSecret) &&
        clientIds.has(config.keycloakMagicLinkClientId));
  });
}
