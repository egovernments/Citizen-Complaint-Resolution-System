import React, { useState, useEffect } from "react";
import { DisplayPhotos, ImageViewer, ArrowLeft, ArrowRight } from "@egovernments/digit-ui-react-components";

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
                const fileStoreIds = verificationDocuments.map((doc) => doc.fileStoreId).join(",");
                try {
                    const res = await Digit.UploadServices.Filefetch([fileStoreIds], tenantId);
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

    const thumbs = [];
    const fullImages = [];

    Object.keys(images).forEach((key) => {
        if (key === "fileStoreIds" || key === "responseInfo") return;
        const value = images[key];
        if (typeof value === "string") {
            const urls = value.split(",");
            const fullImage = urls[0];
            const thumb = urls.find((u) => u.indexOf("small") !== -1) || fullImage;
            fullImages.push(fullImage);
            thumbs.push(thumb);
        }
    });

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
