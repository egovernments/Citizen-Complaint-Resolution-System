#!/usr/bin/env node
/**
 * Emit the login theme's palette from the Configurator's own theme presets.
 *
 * The theme must look like the Configurator, and #2108 is explicit that it
 * must not become a second source of truth for that look. So the palette is
 * not retyped here: it is read out of `configurator/src/themes/index.ts`, the
 * same module `AuthShell` reads, and written to a generated stylesheet.
 *
 * The generated file is committed so the theme stays independently buildable
 * (the Docker build never reaches outside `backend/identity-bff`). `npm test`
 * regenerates it in memory and fails on drift, which is what keeps the commit
 * honest after someone edits the preset.
 */
import { buildSync } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");
const repoRoot = resolve(projectDir, "../../../..");
export const PRESET_NAME = "cms-blue";
export const THEMES_MODULE = join(repoRoot, "configurator/src/themes/index.ts");
export const OUTPUT_FILE = join(projectDir, "src/login/styles/tokens.generated.css");

/** The Configurator palette, evaluated from its own TypeScript module. */
export async function readConfiguratorTokens() {
    const scratch = mkdtempSync(join(tmpdir(), "digit-theme-tokens-"));
    try {
        const bundle = join(scratch, "themes.mjs");
        buildSync({
            entryPoints: [THEMES_MODULE],
            outfile: bundle,
            bundle: true,
            format: "esm",
            platform: "node",
            logLevel: "silent"
        });
        const { themeVariables } = await import(`file://${bundle}`);
        const variables = themeVariables(PRESET_NAME);
        if (Object.keys(variables).length === 0) {
            throw new Error(`Configurator preset "${PRESET_NAME}" is gone or empty: ${THEMES_MODULE}`);
        }
        return variables;
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

export function renderTokensCss(variables) {
    const declarations = Object.entries(variables)
        .map(([name, value]) => `    ${name}: ${value};`)
        .join("\n");
    return [
        "/*",
        " * GENERATED FILE — do not edit.",
        ` * Source: configurator/src/themes/index.ts, preset "${PRESET_NAME}".`,
        " * Regenerate with `npm run tokens` from backend/identity-bff/keycloak/theme-src.",
        " */",
        ":root {",
        declarations,
        "}",
        ""
    ].join("\n");
}

export async function generate() {
    return renderTokensCss(await readConfiguratorTokens());
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
    const css = await generate();
    const current = (() => {
        try {
            return readFileSync(OUTPUT_FILE, "utf8");
        } catch {
            return null;
        }
    })();
    if (current === css) {
        console.log(`tokens up to date: ${OUTPUT_FILE}`);
    } else {
        writeFileSync(OUTPUT_FILE, css);
        console.log(`tokens written: ${OUTPUT_FILE}`);
    }
}
