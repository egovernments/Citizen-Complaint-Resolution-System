import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";

type Provider = {
    alias: string;
    loginUrl: string;
    displayName: string;
    iconClasses?: string;
};

/**
 * Recognizable provider marks for the two providers this deployment supports.
 * The generic key keeps custom realm providers usable without pretending they
 * have one of those brands.
 */
function ProviderIcon({ alias }: { alias: string }): ReactNode {
    const id = alias.toLowerCase();
    if (id.includes("github")) {
        return (
            <svg className="digit-provider-logo" viewBox="0 0 24 24" aria-hidden="true">
                <path
                    fill="currentColor"
                    d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.39.97.1-.75.4-1.27.74-1.56-2.57-.29-5.27-1.29-5.27-5.73 0-1.27.45-2.3 1.2-3.11-.12-.3-.52-1.48.11-3.07 0 0 .98-.31 3.16 1.19a10.96 10.96 0 0 1 5.75 0c2.2-1.5 3.17-1.19 3.17-1.19.63 1.6.23 2.78.11 3.07.75.81 1.2 1.84 1.2 3.11 0 4.45-2.71 5.43-5.29 5.72.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"
                />
            </svg>
        );
    }
    if (id.includes("google")) {
        return (
            <svg className="digit-provider-logo" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
                <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
                <path fill="#FBBC05" d="M6.39 13.86A6 6 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.48l3.35-2.62Z" />
                <path fill="#EA4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
            </svg>
        );
    }
    return <KeyRound className="digit-provider-logo" aria-hidden="true" />;
}

function providerName(provider: Provider): string {
    const alias = provider.alias.toLowerCase();
    if (alias === "github") return "GitHub";
    if (alias === "google") return "Google";
    return provider.displayName.trim() || provider.alias;
}

/**
 * The identity providers Keycloak offers for this client, as the outline
 * buttons the Configurator uses for its alternative sign-in methods. The
 * `href` is Keycloak's own broker URL — the theme never talks to a provider.
 */
export function SocialProviders(props: {
    providers: Provider[];
    label: ReactNode;
    orLabel: string;
    providerLabel: (name: string) => ReactNode;
}) {
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
                        <span>{props.providerLabel(providerName(provider))}</span>
                    </a>
                ))}
            </div>
        </div>
    );
}
