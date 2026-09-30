import { useEffect, useState } from "react";

/**
 * digit-ui-components <Toast type="error">: the bar the legacy login raises
 * for a failed sign-in (login.js `showToast`). It hides
 * itself after five seconds as the legacy pages do; `persistent` keeps it for
 * messages the user has to act on.
 */
export function Toast(props: { label: string; kind?: "error" | "info"; persistent?: boolean }) {
    const [open, setOpen] = useState(true);
    useEffect(() => {
        setOpen(true);
        if (props.persistent) return;
        const timer = setTimeout(() => setOpen(false), 5000);
        return () => clearTimeout(timer);
    }, [props.label, props.persistent]);
    if (!open) return null;
    return (
        <div
            className={`dg-toast${props.kind === "info" ? " dg-toast--info" : ""}`}
            role={props.kind === "info" ? "status" : "alert"}
            id="dg-toast"
        >
            <svg className="dg-toast__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                    fill="#ffffff"
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                />
            </svg>
            <div className="dg-toast__label">
                <span>{props.label}</span>
            </div>
            <button type="button" className="dg-toast__close" aria-label="Close" onClick={() => setOpen(false)}>
                <svg viewBox="0 0 14 14" aria-hidden="true">
                    <path
                        fill="currentColor"
                        d="M14 1.41L12.59 0L7 5.59L1.41 0L0 1.41L5.59 7L0 12.59L1.41 14L7 8.41L12.59 14L14 12.59L8.41 7L14 1.41Z"
                    />
                </svg>
            </button>
        </div>
    );
}
