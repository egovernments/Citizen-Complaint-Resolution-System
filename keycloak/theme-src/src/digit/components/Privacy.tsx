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

const TICK_PATH =
    "M9.00016 16.1698L4.83016 11.9998L3.41016 13.4098L9.00016 18.9998L21.0002 6.99984L19.5902 5.58984L9.00016 16.1698Z";

/**
 * PrivacyComponent.js's consent row. The policy text expands inline instead of
 * in digit-ui's accept/decline PopUp; the page's submit is gated on `checked`,
 * as in login.js.
 */
export function PrivacyConsent(props: {
    policy: PrivacyPolicy;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    const { i18n } = useBranding();
    const t = (key: string | undefined) => i18n.tr(key, key ?? "");

    return (
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
            <details>
                <summary id="user-login-privacy-policy" className="dg-privacy__link">
                    <span>{i18n.t("ES_PRIVACY_POLICY")}</span>
                </summary>
                <div className="dg-privacy__policy">
                    {(props.policy.contents ?? []).map((content, index) => (
                        <div key={index}>
                            <strong>{t(content.header)}</strong>
                            {(content.descriptions ?? []).map((description, subIndex) => (
                                <p key={subIndex}>{t(description.text)}</p>
                            ))}
                        </div>
                    ))}
                </div>
            </details>
        </div>
    );
}
