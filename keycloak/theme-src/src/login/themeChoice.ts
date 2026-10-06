import { THEME_NAMES, THEME_STORAGE_KEY } from "./themeChoice.generated";

/**
 * Wear the preset someone picked in the Configurator.
 *
 * The Configurator's own sign-in screen follows a saved pick, and this page is
 * the next step of the same sign-in, served from the same origin. Without this
 * it always wore the default, so the colours changed as soon as Log in was
 * pressed. A pick it doesn't know (or storage it can't read) leaves the default.
 */
export function followSavedTheme(root: HTMLElement = document.documentElement): void {
    try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (saved && THEME_NAMES.includes(saved)) root.dataset.theme = saved;
    } catch {
        // Storage blocked (private window, site data off): keep the default.
    }
}
