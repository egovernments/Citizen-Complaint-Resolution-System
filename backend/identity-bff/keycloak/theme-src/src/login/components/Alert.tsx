import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

export type AlertKind = "error" | "success" | "warning" | "info";

const ICONS = {
    error: AlertCircle,
    success: CheckCircle2,
    warning: TriangleAlert,
    info: Info
} as const;

/**
 * alert.tsx from the Configurator, with the icon/title/description structure
 * its auth screens use. `html` carries Keycloak's server-rendered message,
 * which the caller has already passed through `kcSanitize`.
 */
export function Alert(props: { kind: AlertKind; title?: ReactNode; children?: ReactNode; html?: string }) {
    const Icon = ICONS[props.kind];
    return (
        <div className={`digit-alert digit-alert--${props.kind}`} role="alert">
            <Icon className="digit-alert__icon" size={16} aria-hidden="true" />
            <div>
                {props.title !== undefined && <h2 className="digit-alert__title">{props.title}</h2>}
                {props.html !== undefined ? (
                    <div
                        className="digit-alert__body"
                        dangerouslySetInnerHTML={{ __html: props.html }}
                    />
                ) : (
                    <div className="digit-alert__body">{props.children}</div>
                )}
            </div>
        </div>
    );
}
