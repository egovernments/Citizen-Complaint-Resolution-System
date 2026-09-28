import type { ExtendKcContext } from "keycloakify/login";
import type { KcEnvName, ThemeName } from "../kc.gen";

export type KcContextExtension = {
    themeName: ThemeName;
    properties: Record<KcEnvName, string> & {};
    /**
     * Keycloak exposes the client's registered base URL on every login page;
     * Keycloakify's `Common` type only declares it on some. The theme uses it
     * to offer the way back to the Configurator, so declare it once here. It
     * is the client's own registered URL, never a request parameter.
     */
    client: {
        baseUrl?: string;
    };
};

export type KcContextExtensionPerPage = {};

export type KcContext = ExtendKcContext<KcContextExtension, KcContextExtensionPerPage>;
