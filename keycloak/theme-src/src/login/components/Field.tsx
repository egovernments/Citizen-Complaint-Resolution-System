import type { InputHTMLAttributes, ReactNode } from "react";
import { useIsPasswordRevealed } from "keycloakify/tools/useIsPasswordRevealed";
import { Eye, EyeOff } from "lucide-react";

/**
 * The label/input/error triple the Configurator's auth forms use, plus the
 * password field's inline reveal button (LoginPage.tsx). Errors come from
 * Keycloak already sanitized and are wired to the input with
 * `aria-describedby` so a screen reader announces them with the field.
 */
export function Field(props: {
    id: string;
    label: ReactNode;
    errorHtml?: string;
    children?: ReactNode;
    input?: InputHTMLAttributes<HTMLInputElement>;
}) {
    const errorId = `${props.id}-error`;
    const hasError = props.errorHtml !== undefined && props.errorHtml !== "";
    return (
        <div className="digit-field">
            <label className="digit-label" htmlFor={props.id}>
                {props.label}
            </label>
            {props.children ?? (
                <input
                    id={props.id}
                    className="digit-input"
                    aria-invalid={hasError || undefined}
                    aria-describedby={hasError ? errorId : undefined}
                    {...props.input}
                />
            )}
            {hasError && (
                <span
                    id={errorId}
                    className="digit-field-error"
                    aria-live="polite"
                    dangerouslySetInnerHTML={{ __html: props.errorHtml! }}
                />
            )}
        </div>
    );
}

/**
 * Keycloak's own reveal behaviour (`useIsPasswordRevealed` toggles the input's
 * `type` in the DOM) wearing the Configurator's inset eye button. Keeping
 * Keycloak's hook rather than React state matters because the passkey and
 * authenticator scripts read these inputs directly.
 */
export function PasswordField(props: {
    id: string;
    label: ReactNode;
    showLabel: string;
    hideLabel: string;
    errorHtml?: string;
    input: InputHTMLAttributes<HTMLInputElement>;
}) {
    const { isPasswordRevealed, toggleIsPasswordRevealed } = useIsPasswordRevealed({
        passwordInputId: props.id
    });
    const revealed = isPasswordRevealed;
    const errorId = `${props.id}-error`;
    const hasError = props.errorHtml !== undefined && props.errorHtml !== "";
    return (
        <Field id={props.id} label={props.label} errorHtml={props.errorHtml}>
            <span className="digit-input-group">
                <input
                    id={props.id}
                    className="digit-input"
                    type="password"
                    aria-invalid={hasError || undefined}
                    aria-describedby={hasError ? errorId : undefined}
                    {...props.input}
                />
                <button
                    type="button"
                    className="digit-input-group__button"
                    aria-label={revealed ? props.hideLabel : props.showLabel}
                    aria-controls={props.id}
                    onClick={toggleIsPasswordRevealed}
                >
                    {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
            </span>
        </Field>
    );
}
