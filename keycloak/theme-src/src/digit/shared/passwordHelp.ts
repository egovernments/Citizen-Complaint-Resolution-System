/**
 * Employee password recovery through the identity BFF (#2167).
 *
 * Keycloak's native forgot-password entry stays disabled realm-wide (it could
 * bypass the unverified-federated-account check; see docs/identity-bff.md), so
 * the digit-employee login posts to the BFF's non-enumerating
 * `POST /identity/v1/password/setup-requests`, the same endpoint the
 * Configurator's password help uses. The BFF always answers 202 and emails a
 * one-use Keycloak link only when the account is eligible. With `surface` and
 * `tenantSlug`, the email uses that surface's Keycloak client (and theme), and
 * the link returns to that tenant's app.
 */
export function passwordSetupRequestUrl(baseUrl: string | undefined): string {
    return `${(baseUrl ?? "").replace(/\/+$/, "")}/identity/v1/password/setup-requests`;
}

/** Where the emailed link lands afterwards: the same tenant's employee app. */
export function employeeReturnTo(slug: string | undefined): string | undefined {
    return slug ? `/${slug}/digit-ui/employee/` : undefined;
}

/**
 * The tenant's employee sign-in, on the origin of `base` (the client's
 * baseUrl, which honours IDENTITY_DIGIT_UI_BASE_URL) rather than Keycloak's
 * own, so it holds when digit-ui and Keycloak are on different origins.
 * Nothing without a usable `base`: a path would resolve on Keycloak's origin.
 */
export function employeeSignInUrl(slug: string | undefined, base: string | undefined): string | undefined {
    const app = employeeReturnTo(slug);
    if (app === undefined || !base) return undefined;
    try {
        return new URL(`${app}user/login`, base).href;
    } catch {
        return undefined;
    }
}

export async function requestPasswordSetup(params: {
    baseUrl?: string;
    email: string;
    returnTo?: string;
    surface?: "employee" | "citizen";
    tenantSlug?: string;
    fetchImpl?: typeof fetch;
}): Promise<boolean> {
    try {
        const response = await (params.fetchImpl ?? fetch)(passwordSetupRequestUrl(params.baseUrl), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                email: params.email.trim(),
                ...(params.returnTo ? { returnTo: params.returnTo } : {}),
                ...(params.surface && params.tenantSlug ? { surface: params.surface, tenantSlug: params.tenantSlug } : {})
            })
        });
        return response.status === 202 || response.ok;
    } catch {
        return false;
    }
}
