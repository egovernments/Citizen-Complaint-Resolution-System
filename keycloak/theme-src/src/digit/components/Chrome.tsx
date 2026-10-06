import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { useBranding } from "../branding/BrandingContext";
import { tenantLabelKey } from "../branding/strings";

/**
 * components/ImageComponent.js: an unset or unreachable src renders nothing
 * rather than a broken-image glyph (CCRS#881).
 */
export function SafeImage(props: ImgHTMLAttributes<HTMLImageElement>) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [props.src]);
    if (!props.src || failed) return null;
    return <img {...props} onError={() => setFailed(true)} />;
}

/** The tenant's display name: `TENANT_TENANTS_{CODE}`, then the BFF's name. */
export function useTenantLabel(): string | undefined {
    const { branding, i18n } = useBranding();
    if (branding === undefined) return undefined;
    const key = tenantLabelKey(branding.stateInfo.code);
    const fallback = branding.tenant.name || branding.stateInfo.name || "";
    const label = i18n.tr(key, fallback);
    return label === "" ? undefined : label;
}

/**
 * components/Header.js: the state logo and the tenant name, centred above the
 * employee card. Without branding it shows neither (digit-ui renders
 * `<Header showTenant={false} />` with no logo when StateInfo has no code).
 */
export function TenantHeader() {
    const { branding } = useBranding();
    const label = useTenantLabel();
    const logo = branding?.stateInfo.logoUrl;
    if (logo === undefined && label === undefined) return null;
    return (
        <div className="dg-top-logos">
            <div className="dg-banner-header">
                <SafeImage className="dg-banner-header__logo" src={logo} alt="Digit Banner" />
                {label !== undefined && <p className="dg-banner-header__tenant">{label}</p>}
            </div>
        </div>
    );
}

/**
 * login.js PoweredByDigit: the BW wordmark on the dark banner, the colour one
 * on a light surface, each falling back to the other.
 */
export function PoweredByDigit(props: { onDarkSurface?: boolean; className: string }) {
    const { branding } = useBranding();
    const footer = branding?.footer ?? {};
    const onDark = props.onDarkSurface ?? true;
    const src = onDark
        ? footer.digitFooterBw || footer.digitFooter
        : footer.digitFooter || footer.digitFooterBw;
    if (!src) return null;
    const home = footer.digitHomeUrl;
    const image = <SafeImage src={src} alt="Powered by DIGIT" />;
    return (
        <div className={props.className}>
            {home ? (
                <a href={home} target="_blank" rel="noopener noreferrer">
                    {image}
                </a>
            ) : (
                image
            )}
        </div>
    );
}
