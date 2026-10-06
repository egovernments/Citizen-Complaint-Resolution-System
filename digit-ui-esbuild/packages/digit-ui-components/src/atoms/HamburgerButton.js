import React from "react";
import { CustomSVG } from "./CustomSVG";

// `analyticsEvent` is opt-in: the name the analytics shim records for a tap.
const HamburgerButton = ({ handleClick, color, className, analyticsEvent }) => (
  <div
    className={`digit-hamburger-span ${className || ""}`}
    onClick={handleClick}
    {...(analyticsEvent ? { "data-analytics-event": analyticsEvent } : {})}
  >
    <CustomSVG.HamburgerIcon className="digit-hamburger" color={color} />
  </div>
);

export default HamburgerButton;
