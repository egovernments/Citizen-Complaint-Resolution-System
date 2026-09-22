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
    const brandDir = resolve(projectDir, "../../../../configurator/public/brand");
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
            themeName: "digit",
            accountThemeImplementation: "none",
            // The deployed Keycloak is 26.7.3 (keycloak/Dockerfile.magic-link).
            // Emitting only the modern jar keeps one artifact to reason about
            // and turns an unexpected Keycloak downgrade into a missing-theme
            // failure rather than a silently mismatched FreeMarker contract.
            keycloakVersionTargets: {
                "22-to-25": false,
                "all-other-versions": "digit-login-theme.jar"
            },
            // Read at runtime by the theme (see src/login/brand.ts). Set per
            // deployment through Keycloak's theme environment variables so a
            // new brand host does not need a theme rebuild.
            environmentVariables: [
                { name: "DIGIT_BRAND_BASE_URL", default: "/configurator/brand" },
                { name: "DIGIT_APP_NAME", default: "DIGIT Complaint Management" }
            ]
        })
    ]
});
