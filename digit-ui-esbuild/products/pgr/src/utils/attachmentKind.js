/**
 * Classify a filestore attachment so the UI can pick the right renderer
 * (image thumbnail, <video>, <audio>, or a download chip).
 *
 * Why sniff the extension at all: `/filestore/v1/files/url` returns ONLY a
 * comma-joined URL list per fileStoreId — no contentType and no filename field
 * (verified against a running stack). filestore *does* persist contenttype and
 * the original filename in eg_filestoremap, but does not expose either here, so
 * the URL is the only signal the browser gets.
 *
 * Two traps this encapsulates, both of which have already bitten this codebase:
 *
 *  1. The S3 presign appends a long `?X-Amz-Algorithm=…&X-Amz-Signature=…`
 *     query. A naive /\.mp4$/ test against the whole URL never matches, and a
 *     naive "last dot" read returns garbage from the signature. Strip the query
 *     (and any #fragment) before reading the extension.
 *
 *  2. filestore generates `_large` / `_medium` / `_small` variants for IMAGES
 *     ONLY. So a multi-entry URL list is a positive image signal — it catches
 *     images whose extension is absent or unusual — while a video always
 *     arrives as a single URL. The old ComplaintPhotos code inverted this by
 *     accident: with no `_small` variant to find it fell back to the original
 *     URL and fed a video straight into an <img>, which is why videos rendered
 *     as a broken image.
 */

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"];
// Kept aligned with PgrFileUpload's DEFAULT_ACCEPT. `avi`/`mkv` are accepted at
// upload but no browser plays them natively — they are still classed as video
// so the UI can say "video" while offering a download; see canAttemptPlayback.
const VIDEO_EXT = ["mp4", "mov", "webm", "m4v", "ogv", "3gp", "3gpp", "avi", "mkv"];
const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "amr", "weba"];

/** Strip the presign query/fragment, then read the trailing extension. */
export const extensionOf = (url) => {
  if (typeof url !== "string" || !url) return "";
  const path = url.split("#")[0].split("?")[0];
  const last = path.split("/").pop() || "";
  const dot = last.lastIndexOf(".");
  if (dot < 0 || dot === last.length - 1) return "";
  return last.slice(dot + 1).toLowerCase();
};

/**
 * @param {string} url        one attachment URL (presigned is fine)
 * @param {number} variantCount how many URLs filestore returned for this file
 * @returns {"image"|"video"|"audio"|"doc"}
 */
export const attachmentKind = (url, variantCount = 1) => {
  const ext = extensionOf(url);
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (IMAGE_EXT.includes(ext)) return "image";
  // Thumbnail variants exist only for images — trust that over a missing or
  // unrecognised extension.
  if (variantCount > 1) return "image";
  return "doc";
};

/**
 * Whether it's worth mounting a player element at all.
 *
 * Deliberately optimistic: it returns true for every video/audio kind rather
 * than consulting a codec allowlist. `canPlayType` is unreliable in both
 * directions here — Chrome answers "" for video/quicktime yet plays most .mov
 * files (they are usually H.264), and an .mp4 can still carry a codec the
 * browser refuses. Container-sniffing cannot tell those apart, so the player is
 * mounted and the caller falls back to a download chip on the element's `error`
 * event, which is the only signal that reflects what actually happened.
 */
export const canAttemptPlayback = (kind) => kind === "video" || kind === "audio";

/**
 * Split filestore's comma-joined URL string into the original file and its
 * thumbnail, and classify it. Mirrors the parsing TimeLineWrapper and
 * ComplaintPhotos each used to do inline.
 */
export const parseFilestoreEntry = (raw) => {
  const variants = (typeof raw === "string" ? raw : "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (variants.length === 0) return null;
  const full = variants[0];
  const kind = attachmentKind(full, variants.length);
  // Only images have a meaningful small variant; for anything else the "thumb"
  // is the file itself and must never be fed to an <img>.
  const thumb = kind === "image" ? variants.find((u) => /small/i.test(u)) || full : full;
  return { full, thumb, kind, variants };
};
