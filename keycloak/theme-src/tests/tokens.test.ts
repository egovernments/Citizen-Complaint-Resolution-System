// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHOICE_FILE, DEFAULT_PRESET, OUTPUT_FILE, generate, readConfiguratorThemes } from "../scripts/generate-tokens.mjs";

describe("palettes generated from the Configurator", () => {
    it("are committed as the generator writes them today", async () => {
        const { css, choice } = await generate();
        expect(readFileSync(OUTPUT_FILE, "utf8"), "run `npm run tokens`").toBe(css);
        expect(readFileSync(CHOICE_FILE, "utf8"), "run `npm run tokens`").toBe(choice);
    });

    it("carry the default on :root and a block for every preset", async () => {
        const { themes } = await readConfiguratorThemes();
        const { css } = await generate();
        expect(themes.some((theme) => theme.name === DEFAULT_PRESET)).toBe(true);
        for (const theme of themes) expect(css).toContain(`:root[data-theme="${theme.name}"] {`);
    });
});
