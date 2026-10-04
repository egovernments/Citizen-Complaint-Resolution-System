/**
 * Employee password recovery through the identity BFF (#2167).
 *
 * Keycloak's native forgot-password entry stays disabled realm-wide (it could
 * bypass the unverified-federated-account check; see docs/identity-bff.md), so
 * the digit-employee login posts to the BFF's non-enumerating
 * `POST /identity/v1/password/setup-requests`, the same endpoint the
 * Configurator's password help uses. The BFF always answers 202 and emails a
 * one-use Keycloak link only when the account is eligible.
 */
export function passwordSetupRequestUrl(baseUrl: string | undefined): string {
    return `${(baseUrl ?? "").replace(/\/+$/, "")}/identity/v1/password/setup-requests`;
}

/** Where the emailed link lands afterwards: the same tenant's employee app. */
export function employeeReturnTo(slug: string | undefined): string | undefined {
    return slug ? `/${slug}/digit-ui/employee/` : undefined;
}

export async function requestPasswordSetup(params: {
    baseUrl?: string;
    email: string;
    returnTo?: string;
    fetchImpl?: typeof fetch;
}): Promise<boolean> {
    try {
        const response = await (params.fetchImpl ?? fetch)(passwordSetupRequestUrl(params.baseUrl), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ email: params.email.trim(), ...(params.returnTo ? { returnTo: params.returnTo } : {}) })
        });
        return response.status === 202 || response.ok;
    } catch {
        return false;
    }
}
