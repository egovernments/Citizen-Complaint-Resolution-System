/**
 * Employee password recovery through the identity BFF (#2167).
 *
 * Keycloak's native forgot-password entry stays disabled realm-wide (it could
 * bypass the unverified-federated-account check; see docs/identity-bff.md), so
 * the digit-employee login posts to the BFF's non-enumerating
 * `POST /identity/v1/password/setup-requests`, the same endpoint the
 * Configurator's password help uses. The BFF answers 202 whether or not the
 * account exists, and emails a one-use Keycloak link only when the account is
 * eligible; over a request limit it answers 429 and sends nothing. With `surface` and
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

/**
 * The BFF's answer. `limited` (#2805): the address, or the network an office
 * shares, asked for too many links; nothing was sent, and `minutes` (rounded
 * up from `retryAfter`) says how long to wait.
 */
export type PasswordSetupOutcome =
    | { status: "sent" }
    | { status: "failed" }
    | { status: "limited"; by: "email" | "network"; minutes: number };

async function limitedOutcome(response: Response): Promise<PasswordSetupOutcome> {
    const body = (await response.json().catch(() => null)) as { code?: unknown; retryAfter?: unknown } | null;
    const seconds = Number(body?.retryAfter ?? response.headers.get("Retry-After"));
    return {
        status: "limited",
        by: body?.code === "EMAIL_RATE_LIMITED" ? "email" : "network",
        minutes: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : 1
    };
}

export async function requestPasswordSetup(params: {
    baseUrl?: string;
    email: string;
    returnTo?: string;
    surface?: "employee" | "citizen";
    tenantSlug?: string;
    fetchImpl?: typeof fetch;
}): Promise<PasswordSetupOutcome> {
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
        if (response.status === 429) return await limitedOutcome(response);
        return { status: response.status === 202 || response.ok ? "sent" : "failed" };
    } catch {
        return { status: "failed" };
    }
}
