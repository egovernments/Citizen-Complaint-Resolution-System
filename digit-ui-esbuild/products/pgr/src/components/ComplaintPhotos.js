import React, { useState, useEffect } from "react";
import { DisplayPhotos, ImageViewer, ArrowLeft } from "@egovernments/digit-ui-react-components";

// ArrowRight is not in upstream react-components; define locally
const ArrowRight = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
  </svg>
);

const ComplaintPhotos = ({ serviceWrapper }) => {
    const [images, setImages] = useState(null);
    const [imageZoom, setImageZoom] = useState(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const tenantId = serviceWrapper?.service?.tenantId?.split(".")[0];

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
                        setImages(res.data);
                    }
                } catch (err) {
                    console.error("Error fetching images:", err);
                    setImages(null);
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

    if (!images) return null;

    // Filefetch's actual response shape is:
    //   { fileStoreIds: [{ id, url: "url1,url2-large,url3-medium,url4-small,…" }, …],
    //     responseInfo: {…} }
    // The previous parser walked Object.keys() looking for sibling
    // entries beyond `fileStoreIds` / `responseInfo` — which never
    // exist — so it always produced empty `thumbs`/`fullImages` and
    // the photos panel rendered nothing. CCRS#555.
    //
    // Pull the per-file URL list off `fileStoreIds[].url`, treat the
    // first segment as the full image and prefer a "small" variant
    // for the thumb, falling back to the full image if no small
    // variant is present (some filestore deployments don't generate
    // thumbnails).
    const thumbs = [];
    const fullImages = [];

    const filestoreEntries = Array.isArray(images?.fileStoreIds) ? images.fileStoreIds : [];
    filestoreEntries.forEach((entry) => {
        const raw = typeof entry?.url === "string" ? entry.url : "";
        if (!raw) return;
        const urls = raw.split(",").map((u) => u.trim()).filter(Boolean);
        if (urls.length === 0) return;
        const fullImage = urls[0];
        const thumb = urls.find((u) => /small/i.test(u)) || fullImage;
        fullImages.push(fullImage);
        thumbs.push(thumb);
    });

    if (thumbs.length === 0) return null;

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

    return (
        <React.Fragment>
            <DisplayPhotos srcs={thumbs} onClick={(src, index) => zoomImage(fullImages[index], index)} />
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
