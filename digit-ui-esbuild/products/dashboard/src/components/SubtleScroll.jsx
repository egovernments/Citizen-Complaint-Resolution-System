import React from "react";
import useSubtleScrollbar from "../hooks/useSubtleScrollbar";
import { mergeRefs } from "../utils/mergeRefs";

const SubtleScroll = React.forwardRef(
  ({ className = "", enabled = true, children, ...props }, ref) => {
    const subtleRef = useSubtleScrollbar(enabled);

    return (
      <div
        ref={mergeRefs(subtleRef, ref)}
        className={`dashboard-subtle-scroll${className ? ` ${className}` : ""}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

SubtleScroll.displayName = "SubtleScroll";

export default SubtleScroll;
