#!/usr/bin/env node
/**
 * Emit the login theme's palettes from the Configurator's own theme presets.
 *
 * The theme must look like the Configurator, and #2108 is explicit that it
 * must not become a second source of truth for that look. So the palettes are
 * not retyped here: they are read out of `configurator/src/themes/index.ts`, the
 * same module `AuthShell` reads. Every preset is written, with the default on
 * `:root`, plus the key the Configurator saves a pick under, so this page can
 * wear the same preset as the Configurator's sign-in screen before it.
 *
 * The generated files are committed so the theme stays independently buildable
 * (the Docker build never reaches outside `keycloak/`). `npm test`
 * regenerates them in memory and fails on drift (tests/tokens.test.ts), which
 * is what keeps the commit honest after someone edits a preset.
 */
import { buildSync } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");
const repoRoot = resolve(projectDir, "../..");
/** The palette the page wears when nothing has been picked. */
export const DEFAULT_PRESET = "cms-blue";
export const THEMES_MODULE = join(repoRoot, "configurator/src/themes/index.ts");
export const OUTPUT_FILE = join(projectDir, "src/login/styles/tokens.generated.css");
export const CHOICE_FILE = join(projectDir, "src/login/themeChoice.generated.ts");

/**
 * Every Configurator preset, and the key its saved pick is kept under,
 * evaluated from the Configurator's own TypeScript module.
 */
export async function readConfiguratorThemes() {
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
        const { THEMES, THEME_STORAGE_KEY } = await import(`file://${bundle}`);
        if (!Array.isArray(THEMES) || THEMES.length === 0) {
            throw new Error(`No Configurator presets found: ${THEMES_MODULE}`);
        }
        if (!THEMES.some((theme) => theme.name === DEFAULT_PRESET)) {
            throw new Error(`Configurator preset "${DEFAULT_PRESET}" is gone: ${THEMES_MODULE}`);
        }
        if (typeof THEME_STORAGE_KEY !== "string" || THEME_STORAGE_KEY === "") {
            throw new Error(`THEME_STORAGE_KEY is not exported: ${THEMES_MODULE}`);
        }
        return {
            themes: THEMES.map(({ name, variables }) => ({ name, variables })),
            storageKey: THEME_STORAGE_KEY
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

const block = (selector, variables) =>
    [`${selector} {`, ...Object.entries(variables).map(([name, value]) => `    ${name}: ${value};`), "}"].join("\n");

/**
 * The default palette on `:root`, then one block per preset on
 * `:root[data-theme="…"]`, which outranks it. The page sets `data-theme` to the
 * preset someone picked in the Configurator (src/login/themeChoice.ts).
 */
export function renderTokensCss(themes) {
    const fallback = themes.find((theme) => theme.name === DEFAULT_PRESET);
    return [
        "/*",
        " * GENERATED FILE — do not edit.",
        " * Source: configurator/src/themes/index.ts, every preset; the default is",
        ` * "${DEFAULT_PRESET}". Regenerate with \`npm run tokens\` from keycloak/theme-src.`,
        " */",
        block(":root", fallback.variables),
        "",
        ...themes.flatMap((theme) => [block(`:root[data-theme="${theme.name}"]`, theme.variables), ""])
    ].join("\n");
}

export function renderChoiceModule({ themes, storageKey }) {
    return [
        "// GENERATED FILE — do not edit. Source: configurator/src/themes/index.ts.",
        "// Regenerate with `npm run tokens` from keycloak/theme-src.",
        "",
        "/** Where the Configurator keeps the preset someone picked. */",
        `export const THEME_STORAGE_KEY = ${JSON.stringify(storageKey)};`,
        "",
        "/** The presets tokens.generated.css carries a block for. */",
        `export const THEME_NAMES: readonly string[] = ${JSON.stringify(themes.map((theme) => theme.name))};`,
        ""
    ].join("\n");
}

export async function generate() {
    const configurator = await readConfiguratorThemes();
    return { css: renderTokensCss(configurator.themes), choice: renderChoiceModule(configurator) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
    const { css, choice } = await generate();
    for (const [file, content] of [[OUTPUT_FILE, css], [CHOICE_FILE, choice]]) {
        const current = (() => {
            try {
                return readFileSync(file, "utf8");
            } catch {
                return null;
            }
        })();
        if (current === content) {
            console.log(`up to date: ${file}`);
        } else {
            writeFileSync(file, content);
            console.log(`written: ${file}`);
        }
    }
}
