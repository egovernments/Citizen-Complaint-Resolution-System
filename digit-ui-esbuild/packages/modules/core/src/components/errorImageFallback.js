// Inline fallback artwork for the error / maintenance / not-found screens.
//
// Their illustrations are hardcoded to an upstream S3 bucket
// (digit-ui-assets.s3.ap-south-1.amazonaws.com) which now answers 403 for every
// object, so every error page in every environment rendered a broken-image icon
// next to its message. Embedding the artwork removes the external dependency
// entirely — an error page is exactly the wrong place to depend on a third-party
// fetch, since it is often reached when something is already failing.
//
// Same mechanism as DIGIT_FOOTER_FALLBACK: ImageComponent swaps to this on the
// img's onError (loop-guarded), so a deployment that DOES serve the S3 asset
// keeps using it and nothing regresses.
//
// currentColor is deliberate — the mark inherits the surrounding text colour and
// so picks up each tenant's theme instead of pinning a brand colour here.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none" role="img">
  <circle cx="48" cy="48" r="34" stroke="currentColor" stroke-width="4" opacity="0.28"/>
  <path d="M48 30v24" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
  <circle cx="48" cy="65" r="3.4" fill="currentColor" opacity="0.85"/>
</svg>`;

export const ERROR_IMAGE_FALLBACK = `data:image/svg+xml,${encodeURIComponent(svg)}`;

export default ERROR_IMAGE_FALLBACK;
