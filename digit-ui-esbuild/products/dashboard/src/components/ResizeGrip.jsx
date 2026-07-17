import React from "react";

/** Decorative bottom-right resize affordance; grid item supplies the actual handle. */
const ResizeGrip = () => (
  <span className="dashboard-resize-grip" aria-hidden="true">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="3.5" y1="14" x2="14" y2="3.5" className="dashboard-resize-grip-line" />
      <line x1="7.5" y1="14" x2="14" y2="7.5" className="dashboard-resize-grip-line" />
    </svg>
  </span>
);

export default ResizeGrip;
