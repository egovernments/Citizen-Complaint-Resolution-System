import { kcSanitize } from "keycloakify/lib/kcSanitize";
import { Github, KeyRound } from "lucide-react";
import type { ReactNode } from "react";

type Provider = {
    alias: string;
    loginUrl: string;
    displayName: string;
    iconClasses?: string;
};

/**
 * MethodIcon from configurator/src/pages/LoginPage.tsx: Google is its own
 * wordmark letter, GitHub is the lucide glyph, anything else is the generic
 * key. Matching on the alias is what the Configurator does too.
 */
function ProviderIcon({ alias }: { alias: string }): ReactNode {
    const id = alias.toLowerCase();
    if (id.includes("github")) {
        return <Github size={16} aria-hidden="true" />;
    }
    if (id.includes("google")) {
        return (
            <span className="digit-provider-icon" aria-hidden="true">
                G
            </span>
        );
    }
    return <KeyRound size={16} aria-hidden="true" />;
}

/**
 * The identity providers Keycloak offers for this client, as the outline
 * buttons the Configurator uses for its alternative sign-in methods. The
 * `href` is Keycloak's own broker URL — the theme never talks to a provider.
 */
export function SocialProviders(props: { providers: Provider[]; label: ReactNode; orLabel: string }) {
    if (props.providers.length === 0) {
        return null;
    }
    return (
        <div id="kc-social-providers">
            <div className="digit-divider" aria-hidden="true">
                <span>{props.orLabel}</span>
            </div>
            <h2 className="digit-visually-hidden">{props.label}</h2>
            <div className="digit-stack-sm" style={{ marginTop: "1.25rem" }}>
                {props.providers.map(provider => (
                    <a
                        key={provider.alias}
                        id={`social-${provider.alias}`}
                        className="digit-button digit-button--outline"
                        href={provider.loginUrl}
                    >
                        <ProviderIcon alias={provider.alias} />
                        <span
                            dangerouslySetInnerHTML={{ __html: kcSanitize(provider.displayName) }}
                        />
                    </a>
                ))}
            </div>
        </div>
    );
}
