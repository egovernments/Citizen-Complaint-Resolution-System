import React from "react";
import { useHistory } from "react-router-dom";

const BackButton = ({ children, className, style, ...props }) => {
  const history = useHistory();
  return (
    <div className={`back-btn2 ${className || ""}`} style={{ marginBottom: "16px", ...style }} {...props}>
      <a onClick={() => history.goBack()} style={{ cursor: "pointer", display: "flex", alignItems: "center" }}>
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 7H3.83L9.42 1.41L8 0L0 8L8 16L9.41 14.59L3.83 9H16V7Z" fill="#0B4B66" />
        </svg>
        <span className="back-btn2-text" style={{ marginLeft: "8px" }}>{children || "Back"}</span>
      </a>
    </div>
  );
};

export default BackButton;
