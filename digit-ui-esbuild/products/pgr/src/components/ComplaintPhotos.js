import React, { useState, useEffect } from "react";
import { DisplayPhotos, ImageViewer, ArrowLeft } from "@egovernments/digit-ui-react-components";
import { parseFilestoreEntry } from "../utils/attachmentKind";

// ArrowRight is not in upstream react-components; define locally
const ArrowRight = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
  </svg>
);

const PaperclipIcon = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M16.5 6v11.5a4 4 0 01-8 0V5a2.5 2.5 0 015 0v10.5a1 1 0 01-2 0V6H10v9.5a2.5 2.5 0 005 0V5a4 4 0 00-8 0v12.5a5.5 5.5 0 0011 0V6h-1.5z" />
  </svg>
);

const chipStyle = {
  display: "inline-flex", alignItems: "center", gap: "0.4rem",
  fontSize: "0.8rem", padding: "0.45rem 0.7rem", borderRadius: 6,
  border: "1px solid var(--color-border, #cbd5e1)",
  color: "var(--color-primary-1, #c84c0e)", textDecoration: "none",
};

/**
 * One playable attachment. Mounts a real <video>/<audio> element and falls back
 * to a download link if the browser rejects the media.
 *
 * The fallback is driven by the element's `error` event rather than by a codec
 * allowlist: container sniffing cannot answer "will this play". Chrome reports
 * it cannot play video/quicktime yet plays most .mov files (they are usually
 * H.264), and an .mp4 can still carry a codec the browser refuses. The error
 * event is the only signal that reflects what actually happened.
 *
 * `preload="metadata"` so opening a complaint with several videos fetches only
 * headers, not whole payloads — these are up to 5 MB each on mobile
 * connections. `playsInline` stops iOS Safari hijacking playback to fullscreen.
 */
const MediaAttachment = ({ url, kind, label, downloadLabel }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={label} style={chipStyle}>
        <PaperclipIcon />
        {downloadLabel}
      </a>
    );
  }

  if (kind === "audio") {
    return (
      <audio
        controls
        preload="metadata"
        src={url}
        aria-label={label}
        onError={() => setFailed(true)}
        style={{ display: "block", width: 280, maxWidth: "100%" }}
      />
    );
  }

  return (
    <video
      controls
      playsInline
      preload="metadata"
      // CCSD-2153: same size + first-frame still as the timeline tiles
      // (280x180, #t=0.1) so video attachments look identical everywhere.
      src={`${url}#t=0.1`}
      aria-label={label}
      onError={() => setFailed(true)}
      style={{ display: "block", width: 280, maxWidth: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 6, background: "#000" }}
    />
  );
};

const ComplaintPhotos = ({ t, serviceWrapper }) => {
    const [attachments, setAttachments] = useState(null);
    const [imageZoom, setImageZoom] = useState(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    // #555: attachments are uploaded under the complaint's CITY tenant
    // (e.g. ke.bomet), and /filestore/v1/files/url is tenant-scoped, so
    // stripping to the state root returned no file and the panel rendered
    // nothing. Use the full tenant, like PGRDetails.js:289 / useComplaintDetails.js:63.
    const tenantId = serviceWrapper?.service?.tenantId;

    useEffect(() => {
        (async () => {
            const workflow = serviceWrapper?.workflow;
            const verificationDocuments = workflow?.verificationDocuments;

            if (verificationDocuments && verificationDocuments.length > 0) {
                // Filefetch joins its `filesArray` arg with "," to build
                // the query string. Pass the array of fileStoreIds
                // directly — the previous code joined them itself and
                // wrapped in a single-element array, which still worked
                // but obscured intent.
                const fileStoreIds = verificationDocuments
                    .map((doc) => doc.fileStoreId)
                    .filter(Boolean);
                try {
                    const res = await Digit.UploadServices.Filefetch(fileStoreIds, tenantId);
                    if (res && res.data) {
                        setAttachments(res.data);
                    }
                } catch (err) {
                    console.error("Error fetching attachments:", err);
                    setAttachments(null);
                }
            }
        })();
    }, [serviceWrapper, tenantId]);

    function zoomImage(imageSource, index) {
        setImageZoom(imageSource);
        setCurrentIndex(index);
    }

    function onCloseImageZoom() {
        setImageZoom(null);
    }

    if (!attachments) return null;

    // Filefetch's actual response shape is:
    //   { fileStoreIds: [{ id, url: "url1,url2-large,url3-medium,url4-small,…" }, …],
    //     responseInfo: {…} }
    // The previous parser walked Object.keys() looking for sibling
    // entries beyond `fileStoreIds` / `responseInfo` — which never
    // exist — so it always produced empty `thumbs`/`fullImages` and
    // the photos panel rendered nothing. CCRS#555.
    //
    // CCSD-2027: uploads accept video and audio, but this panel fed every
    // attachment into <img>. Only images get _large/_medium/_small variants
    // from filestore, so a video had no "small" URL to find, fell back to the
    // original URL, and rendered as a broken image. Classify each entry first,
    // then route images to the existing lightbox and media to a real player.
    const images = [];   // { full, thumb } — preserves the existing gallery UX
    const media = [];    // { full, kind } — video/audio, rendered as players
    const docs = [];     // { full } — anything else, download only

    const filestoreEntries = Array.isArray(attachments?.fileStoreIds) ? attachments.fileStoreIds : [];
    filestoreEntries.forEach((entry) => {
        const parsed = parseFilestoreEntry(entry?.url);
        if (!parsed) return;
        if (parsed.kind === "image") images.push({ full: parsed.full, thumb: parsed.thumb });
        else if (parsed.kind === "video" || parsed.kind === "audio") media.push({ full: parsed.full, kind: parsed.kind });
        else docs.push({ full: parsed.full });
    });

    if (images.length === 0 && media.length === 0 && docs.length === 0) return null;

    const fullImages = images.map((i) => i.full);
    const thumbs = images.map((i) => i.thumb);

    const handleNext = () => {
        if (currentIndex < fullImages.length - 1) {
            const newIndex = currentIndex + 1;
            setCurrentIndex(newIndex);
            setImageZoom(fullImages[newIndex]);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            const newIndex = currentIndex - 1;
            setCurrentIndex(newIndex);
            setImageZoom(fullImages[newIndex]);
        }
    };

    // `t` is not passed by every caller (the citizen ComplaintDetails omits
    // it), so resolve labels defensively instead of crashing on t(...). An
    // unseeded key echoes back, so treat "key === value" as a miss too.
    const label = (key, fallback) => {
        const v = typeof t === "function" ? t(key) : key;
        return !v || v === key ? fallback : v;
    };

    return (
        <React.Fragment>
            {/* CCSD-2153: in native fullscreen the inline width/max-height on the
                <video> below beat the browser's non-!important fullscreen UA rule,
                so the video stayed a small box and its control bar sat mid-screen.
                Release the size constraints in fullscreen so the video fills the
                viewport and the controls pin to the true bottom. Inert otherwise.
                Vendor selectors kept in separate rules — an engine that doesn't
                know one prefixed pseudo would otherwise drop the whole group. */}
            <style>
                {`
                video:fullscreen { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; object-fit: contain !important; }
                video:-webkit-full-screen { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; object-fit: contain !important; }
                video:-moz-full-screen { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; object-fit: contain !important; }
                /* CCSD-2153 defense-in-depth: the platform vendored CSS once shipped
                   video::-webkit-media-controls-panel { top: 55%; position: absolute; }
                   which pins the Chrome control bar mid-video (fullscreen) and half
                   outside small timeline tiles. PR #1696 removed it, but it was
                   re-introduced on a production box via a local commit to the
                   vendored files. revert defers to the browser default, and as an
                   !important author rule it beats any non-important vendored rule
                   regardless of load order — so the panel renders normally even if
                   the culprit ever ships again. */
                video::-webkit-media-controls-panel { position: revert !important; top: revert !important; width: revert !important; }
                `}
            </style>
            {thumbs.length > 0 && (
                <DisplayPhotos srcs={thumbs} onClick={(src, index) => zoomImage(fullImages[index], index)} />
            )}

            {media.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: thumbs.length > 0 ? "0.75rem" : 0 }}>
                    {media.map((m, i) => (
                        <MediaAttachment
                            key={m.full}
                            url={m.full}
                            kind={m.kind}
                            label={`${label("CS_TIMELINE_ATTACHMENT", "Attachment")} ${i + 1}`}
                            downloadLabel={label("CS_COMMON_DOWNLOAD", "Download")}
                        />
                    ))}
                </div>
            )}

            {docs.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
                    {docs.map((d, i) => (
                        <a key={d.full} href={d.full} target="_blank" rel="noopener noreferrer" style={chipStyle}>
                            <PaperclipIcon />
                            {`${label("CS_TIMELINE_ATTACHMENT", "Attachment")} ${i + 1}`}
                        </a>
                    ))}
                </div>
            )}

            {imageZoom && (
                <React.Fragment>
                    <style>
                        {`
                        .image-viewer-wrap {
                            background-color: rgba(0, 0, 0, 0.6) !important;
                            backdrop-filter: blur(10px) !important;
                            z-index: 9999999 !important;
                        }
                        `}
                    </style>
                    <ImageViewer imageSrc={imageZoom} onClose={onCloseImageZoom} />
                    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 20000, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px" }}>
                        {currentIndex > 0 ? (
                            <div
                                onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                                style={{ pointerEvents: "auto", cursor: "pointer", background: "rgba(255,255,255,0.2)", borderRadius: "50%", padding: "10px" }}
                            >
                                <ArrowLeft style={{ width: "40px", height: "40px", fill: "white" }} />
                            </div>
                        ) : <div />}
                        {currentIndex < fullImages.length - 1 ? (
                            <div
                                onClick={(e) => { e.stopPropagation(); handleNext(); }}
                                style={{ pointerEvents: "auto", cursor: "pointer", background: "rgba(255,255,255,0.2)", borderRadius: "50%", padding: "10px" }}
                            >
                                <ArrowRight style={{ width: "40px", height: "40px", fill: "white" }} />
                            </div>
                        ) : <div />}
                    </div>
                </React.Fragment>
            )}
        </React.Fragment>
    );
};

export default ComplaintPhotos;
