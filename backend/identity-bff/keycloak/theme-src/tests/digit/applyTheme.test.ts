// @vitest-environment node
import { describe, expect, it } from "vitest";
import golden from "./fixtures/applyTheme-golden.json";
import { computeThemeVars } from "../../src/digit/theme/applyTheme";

/**
 * Parity with digit-ui-esbuild/src/theme/applyTheme.js. The golden file was
 * produced by running that original (with Ajv) over each input; see
 * scripts/generate-applytheme-golden.cjs. If digit-ui changes its mapping,
 * regenerate the golden file and port the change.
 */
type Golden = Record<string, { input: unknown; vars: Record<string, string>; headerTone?: string; bridge?: string }>;

describe("applyTheme port", () => {
    it.each(Object.entries(golden as Golden))("%s matches digit-ui", (_name, expected) => {
        const result = computeThemeVars(expected.input);
        if (Object.keys(expected.vars).length === 0) {
            // digit-ui wrote nothing: rejected by the schema or no colors.
            expect(result).toBeNull();
            return;
        }
        expect(result).not.toBeNull();
        expect(result!.vars).toEqual(expected.vars);
        // Same write order, so "later wins" behaves the same on <html>.
        expect(Object.keys(result!.vars)).toEqual(Object.keys(expected.vars));
        expect(result!.headerTone).toBe(expected.headerTone);
        expect(`.v2-scope { ${result!.v2Bridge.join("; ")}; }`).toBe(expected.bridge);
    });

    it("gives Bomet's blue button white text and marks its navy header dark", () => {
        const result = computeThemeVars((golden as Golden).bometV3!.input)!;
        expect(result.vars["--color-button-primary-bg-default"]).toBe("#2563EB");
        expect(result.vars["--color-button-primary-text"]).toBe("#FFFFFF");
        expect(result.headerTone).toBe("dark");
    });

    it("picks a near-black label for the default orange (white fails AA on it)", () => {
        const result = computeThemeVars((golden as Golden).default!.input)!;
        expect(result.vars["--color-button-primary-text"]).toBe("#0B0C0C");
    });
});
