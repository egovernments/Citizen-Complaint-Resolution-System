import { afterEach, describe, expect, it } from "vitest";
import { followSavedTheme } from "../src/login/themeChoice";
import { THEME_STORAGE_KEY } from "../src/login/themeChoice.generated";

describe("followSavedTheme", () => {
    afterEach(() => {
        window.localStorage.clear();
        delete document.documentElement.dataset.theme;
    });

    it("wears the preset picked in the Configurator", () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, "digit-orange");
        followSavedTheme();
        expect(document.documentElement.dataset.theme).toBe("digit-orange");
    });

    it("keeps the default when nothing, or something unknown, was picked", () => {
        followSavedTheme();
        expect(document.documentElement.dataset.theme).toBeUndefined();
        window.localStorage.setItem(THEME_STORAGE_KEY, "retired-preset");
        followSavedTheme();
        expect(document.documentElement.dataset.theme).toBeUndefined();
    });
});
