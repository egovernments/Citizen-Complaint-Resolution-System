/*
 * Shared by the top bar and the sidebar foot, which both carry the eGov lockup.
 */

/**
 * Both lockups are served from this repo, and both are cropped to the wordmark.
 *
 * The upstream assets are 800x800 canvases carrying a 800x200 wordmark
 * letterboxed in the middle, so 75% of the image is transparency. The header
 * sizes the logo by height, which meant the visible wordmark rendered at a
 * quarter of the height it was given — 11px inside a 44px box — and read as a
 * logo with far too much padding around it (#2038 review). Cropping the asset
 * fixes it for every consumer at once, rather than asking each one to know the
 * canvas geometry.
 *
 * The light lockup was also being fetched from a `-dev-assets` S3 bucket on
 * every page load. Self-hosting it removes that request and that dependency.
 */
export const DEFAULT_EGOV_LOGO = "/digit-ui/brand/egov-logo.png";
/**
 * The shipped lockup is the dark-on-light one: an orange "e" and a navy "GOV".
 * On a tenant that paints its header navy the "GOV" is navy on navy and simply
 * disappears, so a dark header needs the reverse lockup instead. Same geometry
 * as the default, so the two are interchangeable in the slot.
 *
 * `applyTheme` publishes the header's tone from the same luminance it uses to
 * pick readable foregrounds, so this cannot disagree with the rest of the
 * chrome about whether the header is dark.
 */
export const DEFAULT_EGOV_LOGO_ON_DARK = "/digit-ui/brand/egov-logo-white.png";
