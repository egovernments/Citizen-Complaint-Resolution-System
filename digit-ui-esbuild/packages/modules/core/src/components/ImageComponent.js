import React from "react";
import PropTypes from "prop-types";
import { DIGIT_FOOTER_FALLBACK } from "./digitFooterFallback";

const ImageComponent = ({
  src,
  alt = "Image not found",
  decorative = false,
  ariaLabel = "No Image description set",
  ariaLabelledby = "no-image-description",
  fallbackSrc,
  ...props
}) => {
  // Determine the appropriate attributes based on the props
  const accessibilityProps = {};

  if (decorative) {
    // For decorative images
    accessibilityProps.alt = "";
  } else if (alt) {
    // Provide meaningful alt text if available
    accessibilityProps.alt = alt;
  } else if (ariaLabel) {
    // Use aria-label if alt is not provided
    accessibilityProps["aria-label"] = ariaLabel;
  } else if (ariaLabelledby) {
    // Use aria-labelledby for descriptive associations
    accessibilityProps["aria-labelledby"] = ariaLabelledby;
  } else {
    console.warn("AccessibleImage: Missing alt, aria-label, or aria-labelledby for non-decorative image.");
  }

  // If the primary src is missing/broken, swap to a fallback once (loop-guarded).
  // The "Powered by DIGIT" footer auto-defaults to the embedded logo so every
  // footer (citizen + all employee/login pages) survives a missing/404
  // DIGIT_FOOTER / DIGIT_FOOTER_BW config — no per-page wiring needed.
  const effectiveFallback = fallbackSrc || (alt === "Powered by DIGIT" ? DIGIT_FOOTER_FALLBACK : undefined);

  const handleError = (e) => {
    if (effectiveFallback && e.currentTarget.src !== effectiveFallback) {
      e.currentTarget.onerror = null;
      e.currentTarget.src = effectiveFallback;
    }
  };

  return <img src={src || effectiveFallback} {...accessibilityProps} {...props} onError={handleError} />;
};

ImageComponent.propTypes = {
  src: PropTypes.string, // The source URL for the image
  alt: PropTypes.string, // Alternative text for the image
  decorative: PropTypes.bool, // If true, image is decorative
  ariaLabel: PropTypes.string, // Custom label for screen readers
  ariaLabelledby: PropTypes.string, // Association with another descriptive element
  fallbackSrc: PropTypes.string, // Shown if src is missing or fails to load
};

export default ImageComponent;
