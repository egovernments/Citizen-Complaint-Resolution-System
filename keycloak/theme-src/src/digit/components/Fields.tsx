import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * components-v2 Field + Label + Input as login.js composes them: an inline
 * label with the red required asterisk, then the 44px input 8px below it.
 */
export function TextField(props: {
    id: string;
    label: ReactNode;
    required?: boolean;
    invalid?: boolean;
    error?: ReactNode;
    input: InputHTMLAttributes<HTMLInputElement>;
}) {
    const errorId = `${props.id}-error`;
    return (
        <div className="dg-field">
            <label className="dg-label" htmlFor={props.id}>
                {props.label}
                {props.required && (
                    <span className="dg-label__required" aria-hidden="true">
                        *
                    </span>
                )}
            </label>
            <input
                id={props.id}
                className="dg-input"
                aria-invalid={props.invalid || undefined}
                aria-describedby={props.error !== undefined ? errorId : undefined}
                {...props.input}
            />
            {props.error !== undefined && (
                <p id={errorId} className="dg-field-error" aria-live="polite">
                    {props.error}
                </p>
            )}
        </div>
    );
}

/** login.js PasswordInput: the input and a 44×44 eye toggle in one frame. */
export function PasswordInput(props: {
    id: string;
    name: string;
    value: string;
    onChange: (value: string) => void;
    invalid?: boolean;
    autoComplete?: string;
    showLabel: string;
    hideLabel: string;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className={`dg-password${props.invalid ? " is-invalid" : ""}`}>
            <input
                id={props.id}
                name={props.name}
                className="dg-password__input"
                type={show ? "text" : "password"}
                value={props.value}
                onChange={event => props.onChange(event.target.value)}
                autoComplete={props.autoComplete ?? "current-password"}
                aria-invalid={props.invalid || undefined}
            />
            <button
                type="button"
                className="dg-password__toggle"
                aria-label={show ? props.hideLabel : props.showLabel}
                aria-controls={props.id}
                onClick={() => setShow(value => !value)}
            >
                {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
        </div>
    );
}
