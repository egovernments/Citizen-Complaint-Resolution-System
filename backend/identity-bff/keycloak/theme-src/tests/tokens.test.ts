// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTPUT_FILE, generate, readConfiguratorTokens } from "../scripts/generate-tokens.mjs";

describe("palette", () => {
    it("is still the Configurator's, not a copy that has drifted", async () => {
        const expected = await generate();
        const committed = readFileSync(OUTPUT_FILE, "utf8");
        expect(
            committed,
            "Run `npm run tokens` — configurator/src/themes/index.ts changed."
        ).toBe(expected);
    });

    it("carries the cms-blue values the auth shell is built on", async () => {
        const variables = await readConfiguratorTokens();
        // The two the shell depends on directly: the action colour and the
        // navy the left panel and its scrim are built on.
        expect(variables["--primary"]).toBe("221 83% 53%");
        expect(variables["--secondary"]).toBe("214 68% 14%");
    });
});
