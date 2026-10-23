/**
 * Keycloak's errors for a sign-in this tab started but the browser no longer
 * holds, e.g. after an emailed password link finished in another tab (#2644).
 * Going back cannot resume it; a new sign-in can.
 *
 * error.ftl carries no message key. Keycloak formats the message into
 * `message.summary` and keeps only that text and the type
 * (FreeMarkerLoginFormsProvider.handleMessages, MessageBean), so the page can
 * only match text. To match what this Keycloak rendered (its message bundle,
 * any realm override, the page's locale) rather than keycloakify's
 * client-side copy, the theme names each key in theme.properties
 * (vite.config.ts). keycloakify has the server resolve every message key it
 * finds in the page data, and `msgStr` prefers that answer to its bundled
 * copy, which stays the fallback.
 *
 * Kept free of imports: vite.config.ts reads it.
 */
export const LOST_SESSION_MESSAGE_KEYS = ["cookieNotFoundMessage", "expiredCodeMessage", "invalidCodeMessage"] as const;

/** theme.properties lines whose values are the keys above. */
export const lostSessionThemeProperties = LOST_SESSION_MESSAGE_KEYS.map(key => `digitLostSessionMessage.${key}=${key}`);

/** Whether `summary` is one of the lost-session messages, as `msgStr` resolves them. */
export function isLostSessionMessage(
    summary: string | undefined,
    msgStr: (key: (typeof LOST_SESSION_MESSAGE_KEYS)[number]) => string
): boolean {
    const text = summary?.trim();
    return !!text && LOST_SESSION_MESSAGE_KEYS.some(key => msgStr(key).trim() === text);
}
