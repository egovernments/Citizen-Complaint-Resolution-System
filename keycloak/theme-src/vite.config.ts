import { createReadStream, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { keycloakify } from "keycloakify/vite-plugin";

const projectDir = dirname(fileURLToPath(import.meta.url));

const BRAND_FILES: Record<string, string> = {
    "signup-crowd.jpg": "image/jpeg",
    "egov-logo-white.png": "image/png"
};

/**
 * Serve the Configurator's brand assets at the path the theme asks for.
 *
 * Dev only. In a deployment nginx already serves `/configurator/brand/` from
 * the Configurator on the same origin, and none of this is bundled into the
 * theme — the assets stay the Configurator's. It is also what makes the
 * screenshot baselines show the real photograph rather than the gradient
 * fallback.
 */
function serveConfiguratorBrand(): Plugin {
    const brandDir = resolve(projectDir, "../../configurator/public/brand");
    return {
        name: "digit-serve-configurator-brand",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use("/configurator/brand", (request, response, next) => {
                const name = (request.url ?? "").split("?")[0]!.replace(/^\//, "");
                const contentType = BRAND_FILES[name];
                const filePath = resolve(brandDir, name);
                if (contentType === undefined || !existsSync(filePath)) {
                    next();
                    return;
                }
                response.setHeader("Content-Type", contentType);
                createReadStream(filePath).pipe(response);
            });
        }
    };
}

export default defineConfig({
    plugins: [
        react(),
        serveConfiguratorBrand(),
        keycloakify({
            // One jar, two login themes. configurator-blue is the
            // Configurator's; digit-employee is the legacy digit-ui employee
            // login page (#2167). kcContext.themeName picks the
            // implementation in src/login/KcPage.tsx.
            themeName: ["configurator-blue", "digit-employee"],
            accountThemeImplementation: "none",
            // The deployed Keycloak is 26.7.3 (keycloak/Dockerfile).
            // Emitting only the modern jar keeps one artifact to reason about
            // and turns an unexpected Keycloak downgrade into a missing-theme
            // failure rather than a silently mismatched FreeMarker contract.
            keycloakVersionTargets: {
                "22-to-25": false,
                "all-other-versions": "configurator-blue-login-theme.jar"
            },
            // Read at runtime by the theme (see src/login/brand.ts). Set per
            // deployment through Keycloak's theme environment variables so a
            // new brand host does not need a theme rebuild.
            environmentVariables: [
                { name: "DIGIT_BRAND_BASE_URL", default: "/configurator/brand" },
                { name: "DIGIT_APP_NAME", default: "DIGIT Complaint Management" },
                // Slug resolution and password setup only; branding is public DIGIT data.
                { name: "DIGIT_IDENTITY_BFF_BASE_URL", default: "" },
                { name: "DIGIT_PUBLIC_API_BASE_URL", default: "" },
                { name: "DIGIT_MDMS_SEARCH_PATH", default: "/mdms-v2/v1/_search" },
                { name: "DIGIT_UI_CONFIG_MODULE_NAME", default: "commonMDMSConfig" },
                { name: "DIGIT_DEFAULT_LOCALE", default: "en_IN" },
                { name: "DIGIT_FOOTER_URL", default: "/digit-ui/brand/digit-footer.png" },
                { name: "DIGIT_FOOTER_BW_URL", default: "/digit-ui/brand/digit-footer-bw.png" },
                { name: "DIGIT_HOME_URL", default: "https://www.digit.org/" }
            ]
        })
    ]
});
