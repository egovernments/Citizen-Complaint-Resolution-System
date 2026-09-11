import React, { forwardRef } from "react";
import PropTypes from "prop-types";

const SubmitBar = forwardRef((props, ref) => {
  const fieldId = props?.id||Digit?.Utils?.getFieldIdName?.( props?.label || props?.className || "submitbutton")||"NA";

  // Forward data-* attributes to the DOM so a call site can tag a control for
  // the analytics shim (CCRS#2007) without this atom knowing anything about
  // analytics. Only data-*: spreading every prop would put component props like
  // `submit`, `label` and `submitIcon` on the button as invalid DOM attributes.
  const dataAttrs = {};
  Object.keys(props || {}).forEach((k) => {
    if (k.indexOf("data-") === 0) dataAttrs[k] = props[k];
  });

  return (
    <button
      {...dataAttrs}
      ref={ref}
      id={fieldId}
      disabled={props.disabled ? true : false}
      className={`${props.disabled ? "submit-bar-disabled" : "submit-bar"} ${props.className ? props.className : ""}`}
      type={props.submit ? "submit" : "button"}
      style={{ ...props.style }}
      onClick={props.onSubmit}
      {... props.form ? {form: props.form} : {}}
    >
      <header style={{...props?.headerStyle}}>{props.label}</header>
      {props?.submitIcon}
    </button>
  );
});

SubmitBar.propTypes = {
  /**
   * Is it a normal button or submit button?
   */
  submit: PropTypes.any,
  /**
   * style for the button
   */
  style: PropTypes.object,
  /**
   * SubmitButton contents
   */
  label: PropTypes.string,
  /**
   * Optional click handler
   */
  onSubmit: PropTypes.func,
  /**
   * Submit icon
   */
  submitIcon: PropTypes.node,
};

SubmitBar.defaultProps = {};

export default SubmitBar;
