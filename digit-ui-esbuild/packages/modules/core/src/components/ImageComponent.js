import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";

const ImageComponent = ({
  src,
  alt = "Image not found",
  decorative = false,
  ariaLabel = "No Image description set",
  ariaLabelledby = "no-image-description",
  onError,
  ...props
}) => {
  // CCRS#881: a non-empty but unreachable src (a stale/dead asset URL — e.g. a
  // per-tenant MDMS StateInfo bannerUrl pointing at a decommissioned S3
  // object) produces the exact same broken-image glyph as a missing src once
  // the browser fails to load it. Track that failure and stop rendering the
  // <img> instead — same "never show the broken-icon" outcome as the
  // missing-src case below. Resets if the caller later passes a different
  // (hopefully working) src. Declared before any early return: hooks must
  // run on every render regardless of the src/failed checks that follow.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  // An <img> with no src is always a broken-image icon, never a useful render.
  // Several callers pass a globalConfigs value straight through (the "Powered by
  // DIGIT" footers, tenant logos), so an unset config used to paint a broken
  // icon plus its alt text on the login, OTP and password screens. Render
  // nothing instead — the same guard the employee shell already applies inline.
  if (!src || failed) return null;

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

  const handleError = (event) => {
    setFailed(true);
    onError?.(event);
  };

  return <img src={src} onError={handleError} {...accessibilityProps} {...props} />;
};

ImageComponent.propTypes = {
  src: PropTypes.string.isRequired, // The source URL for the image
  alt: PropTypes.string, // Alternative text for the image
  decorative: PropTypes.bool, // If true, image is decorative
  ariaLabel: PropTypes.string, // Custom label for screen readers
  ariaLabelledby: PropTypes.string, // Association with another descriptive element
};

export default ImageComponent;
