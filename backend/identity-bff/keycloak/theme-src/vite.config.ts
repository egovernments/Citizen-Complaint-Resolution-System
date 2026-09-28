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

/**
 * Dev only: what the digit-employee / digit-citizen screens fetch in a
 * deployment, served from fixtures so the dev server and the screenshot suite
 * render a real tenant.
 *
 * - `/identity/v1/tenant-contexts/{slug}/branding` → the identity BFF's
 *   public branding document, from tests/digit/fixtures/branding-{slug}.json
 *   (or `$DIGIT_BRANDING_FIXTURE_DIR`, checked first); an unknown slug is a 404, which the
 *   theme turns into the default DIGIT look.
 * - `/digit-ui/brand/*` → the "Powered by DIGIT" wordmarks digit-ui serves.
 * - `/dev-fixtures/*` → fixture images (the placeholder county crest).
 */
function serveDigitFixtures(): Plugin {
    const fixturesDir = resolve(projectDir, "tests/digit/fixtures");
    const digitUiBrandDir = resolve(projectDir, "../../../../digit-ui-esbuild/public/brand");
    const types: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
    const sendFile = (dir: string, name: string, response: import("node:http").ServerResponse) => {
        const ext = name.slice(name.lastIndexOf("."));
        const filePath = resolve(dir, name);
        if (!/^[\w.-]+$/.test(name) || types[ext] === undefined || !existsSync(filePath)) return false;
        response.setHeader("Content-Type", types[ext]!);
        createReadStream(filePath).pipe(response);
        return true;
    };
    return {
        name: "digit-serve-dev-fixtures",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use("/identity/v1/tenant-contexts", (request, response, next) => {
                const match = /^\/([a-z0-9-]{2,63})\/branding(?:\?.*)?$/.exec(request.url ?? "");
                if (match === null) {
                    next();
                    return;
                }
                const filePath = [process.env.DIGIT_BRANDING_FIXTURE_DIR, fixturesDir]
                    .filter((dir): dir is string => !!dir)
                    .map(dir => resolve(dir, `branding-${match[1]}.json`))
                    .find(candidate => existsSync(candidate));
                if (filePath === undefined) {
                    response.statusCode = 404;
                    response.end();
                    return;
                }
                response.setHeader("Content-Type", "application/json");
                createReadStream(filePath).pipe(response);
            });
            server.middlewares.use("/digit-ui/brand", (request, response, next) => {
                const name = (request.url ?? "").split("?")[0]!.replace(/^\//, "");
                if (!sendFile(digitUiBrandDir, name, response)) next();
            });
            server.middlewares.use("/dev-fixtures", (request, response, next) => {
                const name = (request.url ?? "").split("?")[0]!.replace(/^\//, "");
                if (!sendFile(fixturesDir, name, response)) next();
            });
        }
    };
}

export default defineConfig({
    plugins: [
        react(),
        serveConfiguratorBrand(),
        serveDigitFixtures(),
        keycloakify({
            // One jar, three login themes. configurator-blue is the
            // Configurator's; digit-employee and digit-citizen are the legacy
            // digit-ui login pages (#2167). kcContext.themeName picks the
            // implementation in src/login/KcPage.tsx.
            themeName: ["configurator-blue", "digit-employee", "digit-citizen"],
            accountThemeImplementation: "none",
            // The deployed Keycloak is 26.7.3 (keycloak/Dockerfile.magic-link).
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
                // digit-employee / digit-citizen: where the identity BFF's
                // public branding endpoint lives. Empty means same origin.
                { name: "DIGIT_IDENTITY_BFF_BASE_URL", default: "" }
            ]
        })
    ]
});
