/**
 * Where the shared brand assets live.
 *
 * The photograph and the logo belong to the Configurator, which serves them
 * from `/configurator/brand/`. Keycloak is deployed on the same origin (nginx
 * serves it under `/auth/`, see local-setup/ansible/templates/nginx-site.conf.j2),
 * so a same-origin path reuses the approved assets instead of copying them
 * into a second place and re-deciding their licensing.
 *
 * A deployment that puts Keycloak on its own host overrides
 * `DIGIT_BRAND_BASE_URL` with an absolute URL. If the photograph cannot be
 * fetched for any reason the backdrop falls back to the gradient, which is
 * built on the same navy as the theme's `--secondary`.
 */
import type { KcContext } from "./KcContext";

export type Brand = {
    baseUrl: string;
    appName: string;
    photoUrl: string;
    logoUrl: string;
};

export function getBrand(kcContext: Pick<KcContext, "properties">): Brand {
    const baseUrl = (kcContext.properties.DIGIT_BRAND_BASE_URL || "/configurator/brand").replace(
        /\/+$/,
        ""
    );
    return {
        baseUrl,
        appName: kcContext.properties.DIGIT_APP_NAME || "DIGIT Complaint Management",
        photoUrl: `${baseUrl}/signup-crowd.jpg`,
        logoUrl: `${baseUrl}/egov-logo-white.png`
    };
}
