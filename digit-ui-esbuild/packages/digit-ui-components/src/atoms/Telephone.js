import React from "react";
import PropTypes from "prop-types";
import { SVG } from "./SVG";
import { phoneParts } from "../utils/mobilePrefix"; // ours (#1929)

// ours (#1929): the tenant's country code, not a fixed "+91"; a dialable tel: link (was "digit-tel:")
const TelePhone = (props) => {
  const { prefix, number, dial } = phoneParts(props?.mobile);
  return (
  <React.Fragment>
    {props?.text}
    <div className={`digit-telephone ${props?.className ? props?.className : ""}`} style={props?.style}>
      <div className={`digit-call`}>
        <SVG.Phone />
        <a href={`tel:${dial}`}>
          {prefix}{prefix ? " " : ""}{number}
        </a>
      </div>
    </div>
  </React.Fragment>
  );
};

TelePhone.propTypes = {
  text: PropTypes.string,
  mobile: PropTypes.string.isRequired,
  className: PropTypes.string,
  style: PropTypes.object,
};

export default TelePhone;
