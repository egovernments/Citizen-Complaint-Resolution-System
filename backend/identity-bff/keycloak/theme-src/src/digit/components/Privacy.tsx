import { useEffect, useRef, useState } from "react";
import { useBranding } from "../branding/BrandingContext";

type Line = { text?: string; type?: string | null; isBold?: boolean; isSpaceRequired?: boolean };
type Description = Line & { subDescriptions?: Line[] };
type Content = { header?: string; isSpaceRequired?: boolean; descriptions?: Description[] };
export type PrivacyPolicy = { module?: string; header?: string; contents?: Content[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The policy PrivacyComponent.js shows: digit-ui filters the MDMS
 * `PrivacyPolicy` list by `module` ("HCM" on the password login). The BFF may
 * hand over the list or the record it already picked.
 */
export function pickPrivacyPolicy(raw: unknown, module = "HCM"): PrivacyPolicy | undefined {
    const list = Array.isArray(raw) ? raw.filter(isRecord) : isRecord(raw) ? [raw] : [];
    const chosen = list.find(policy => policy.module === module) ?? (list.length === 1 ? list[0] : undefined);
    if (chosen === undefined) return undefined;
    return {
        module: typeof chosen.module === "string" ? chosen.module : undefined,
        header: typeof chosen.header === "string" ? chosen.header : undefined,
        contents: Array.isArray(chosen.contents) ? (chosen.contents.filter(isRecord) as Content[]) : []
    };
}

/** Localization keys a policy refers to, which the BFF must include in `messages`. */
export function privacyMessageKeys(policy: PrivacyPolicy | undefined): string[] {
    if (policy === undefined) return [];
    const keys = new Set<string>();
    if (policy.header) keys.add(policy.header);
    for (const content of policy.contents ?? []) {
        if (content.header) keys.add(content.header);
        for (const description of content.descriptions ?? []) {
            if (description.text) keys.add(description.text);
            for (const sub of description.subDescriptions ?? []) if (sub.text) keys.add(sub.text);
        }
    }
    return [...keys];
}

const TICK_PATH =
    "M9.00016 16.1698L4.83016 11.9998L3.41016 13.4098L9.00016 18.9998L21.0002 6.99984L19.5902 5.58984L9.00016 16.1698Z";

/**
 * PrivacyComponent.js as it renders inside the v2 login card: the consent
 * checkbox, the "Privacy Policy" link and the PopUp with I accept / I do not
 * accept. Accepting ticks the box; declining clears it. The page's submit is
 * gated on `checked`, as in login.js.
 */
export function PrivacyConsent(props: {
    policy: PrivacyPolicy;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    const { i18n } = useBranding();
    const [open, setOpen] = useState(false);
    const t = (key: string | undefined) => i18n.tr(key, key ?? "");

    return (
        <>
            <div className="dg-privacy">
                <div className="dg-checkbox">
                    <input
                        id="privacy-component-check"
                        className="dg-checkbox__input"
                        type="checkbox"
                        checked={props.checked}
                        onChange={event => props.onChange(event.target.checked)}
                    />
                    <label htmlFor="privacy-component-check" className="dg-checkbox__box">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d={TICK_PATH} />
                        </svg>
                    </label>
                    <label htmlFor="privacy-component-check" className="dg-checkbox__label">
                        {i18n.t("ES_BY_CLICKING")}
                    </label>
                </div>
                <button
                    type="button"
                    id="user-login-privacy-policy"
                    className="dg-privacy__link"
                    aria-haspopup="dialog"
                    onClick={() => setOpen(true)}
                >
                    <span>{i18n.t("ES_PRIVACY_POLICY")}</span>
                </button>
            </div>
            {open && (
                <PrivacyPopup
                    policy={props.policy}
                    t={t}
                    acceptLabel={i18n.t("DIGIT_I_ACCEPT")}
                    declineLabel={i18n.t("DIGIT_I_DO_NOT_ACCEPT")}
                    tocLabel={i18n.t("DIGIT_TABLE_OF_CONTENTS")}
                    onClose={() => setOpen(false)}
                    onDecide={accepted => {
                        props.onChange(accepted);
                        setOpen(false);
                    }}
                />
            )}
        </>
    );
}

function marker(type: string | null | undefined, index: number) {
    if (type === "points") return <span style={{ marginRight: "0.5rem" }}>&#8226;</span>;
    if (type === "step") return <span style={{ marginRight: "0.5rem" }}>{index + 1}. </span>;
    return null;
}

function PrivacyPopup(props: {
    policy: PrivacyPolicy;
    t: (key: string | undefined) => string;
    acceptLabel: string;
    declineLabel: string;
    tocLabel: string;
    onClose: () => void;
    onDecide: (accepted: boolean) => void;
}) {
    const { policy, t } = props;
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        dialogRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") props.onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    const contents = policy.contents ?? [];
    const anchor = (index: number) => `dg-privacy-section-${index}`;

    return (
        <div
            className="dg-popup-overlay"
            onClick={event => {
                if (event.target === event.currentTarget) props.onClose();
            }}
        >
            <div
                ref={dialogRef}
                className="dg-popup"
                role="dialog"
                aria-modal="true"
                aria-labelledby="dg-privacy-heading"
                tabIndex={-1}
            >
                <div className="dg-popup__header">
                    <h2 id="dg-privacy-heading" className="dg-popup__heading">
                        {t(policy.header)}
                    </h2>
                    <button type="button" className="dg-popup__close" aria-label="Close" onClick={props.onClose}>
                        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                            <path
                                fill="currentColor"
                                d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                            />
                        </svg>
                    </button>
                </div>
                <div className="dg-popup__body">
                    <div>
                        <div className="dg-popup__toc-title">{props.tocLabel}</div>
                        <ul className="dg-popup__toc">
                            {contents.map((content, index) => (
                                <li key={index}>
                                    <span style={{ marginRight: "0.5rem" }}>{index + 1}. </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            document.getElementById(anchor(index))?.scrollIntoView({ behavior: "smooth" })
                                        }
                                    >
                                        {t(content.header)}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    {contents.map((content, index) => (
                        <div key={index} id={anchor(index)}>
                            <div style={{ fontWeight: "bold", paddingLeft: content.isSpaceRequired ? "1rem" : 0 }}>
                                {t(content.header)}
                            </div>
                            {(content.descriptions ?? []).map((description, subIndex) => (
                                <div
                                    key={subIndex}
                                    style={{ paddingLeft: description.isSpaceRequired ? "1rem" : 0, marginBottom: "0.5rem" }}
                                >
                                    <div
                                        style={{
                                            fontWeight: description.isBold ? 700 : 400,
                                            display: "flex",
                                            alignItems: "center"
                                        }}
                                    >
                                        {marker(description.type, subIndex)}
                                        {t(description.text)}
                                    </div>
                                    {(description.subDescriptions ?? []).map((sub, subSubIndex) => (
                                        <div key={subSubIndex} style={{ paddingLeft: "1rem" }}>
                                            {marker(sub.type, subSubIndex)}
                                            {t(sub.text)}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
                <div className="dg-popup__footer">
                    <button
                        type="button"
                        id="user-login-i-do-not-accept"
                        className="dg-popup__decline"
                        onClick={() => props.onDecide(false)}
                    >
                        {props.declineLabel}
                    </button>
                    <button
                        type="button"
                        id="user-login-i-accept"
                        className="dg-popup__accept"
                        onClick={() => props.onDecide(true)}
                    >
                        {props.acceptLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
