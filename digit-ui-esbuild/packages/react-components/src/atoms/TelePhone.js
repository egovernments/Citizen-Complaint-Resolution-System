import React from "react";
import PropTypes from "prop-types";
import { Phone } from "./svgindex";
import { phoneParts } from "./mobilePrefix"; // ours (#1929)

// ours (#1929): the tenant's country code, not a fixed "+91"
const TelePhone = ({ mobile, text }) => {
  const { prefix, number, dial } = phoneParts(mobile);
  return (
  <React.Fragment>
    {text}
    <div className="telephone">
      <div className="call">
        <Phone fillcolor={"FFFFFF"} style={{marginLeft:"0px"}} />
        <a href={`tel:${dial}`}>{prefix}{prefix ? " " : ""}{number}</a>
      </div>
    </div>
  </React.Fragment>
  );
};

TelePhone.propTypes = {
  mobile: PropTypes.any,
  text: PropTypes.string,
};

TelePhone.defaultProps = {
  mobile: "",
  text: "",
};

export default TelePhone;
