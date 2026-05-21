import React, { Fragment } from "react";
import { SVG } from "./SVG";
import StringManipulator from "./StringManipulator";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { Colors} from "../constants/colors/colorconstants";
import { getUserType } from "../utils/digitUtils";

const CheckBox = ({
  onChange,
  label,
  value,
  disabled,
  ref,
  checked,
  inputRef,
  pageType,
  style,
  index,
  isLabelFirst,
  hideLabel,
  isIntermediate,
  ...props
}) => {
  const { t } = useTranslation();
  const userType = pageType || getUserType();
  let styles = props?.styles;

  const sentenceCaseLabel = StringManipulator("TOSENTENCECASE", label);

  const diabledIconColor = Colors.lightTheme.text.disabled;
  const iconColor = Colors.lightTheme.primary[1];

  return (
    <div
      className={`digit-checkbox-container ${
        !isLabelFirst ? "checkboxFirst" : "labelFirst"
      } ${disabled ? "disabled" : " "} ${props?.mainClassName}`}
    >
      {isLabelFirst && !hideLabel ? (
        <label
          htmlFor={props.id || `checkbox-${value}`}
          className={`label ${props?.labelClassName} `}
          style={{ maxWidth: "100%", width: "auto", marginRight: "0rem" }}
          onClick={props?.onLabelClick}
        >
          {sentenceCaseLabel}
        </label>
      ) : null}
      <div
        style={{ display: "flex", position: "relative" }}
        className={props?.inputWrapperClassName}
      >
        <input
          type="checkbox"
          className={`input ${userType === "employee" ? "input-emp" : ""} ${
            props?.inputClassName
          } `}
          onChange={onChange}
          value={value || label}
          {...props}
          ref={inputRef}
          disabled={disabled}
          checked={checked}
          id={props?.id}
          // The input is rendered visually-hidden (opacity:0) and is offset
          // beside the .digit-custom-checkbox glyph rather than under it, so
          // its 16x16 hit-rect creates a "ghost click zone" to the left of
          // the visible square. Disable pointer events on the input itself —
          // toggles still happen via the <label htmlFor> on the glyph + the
          // text label, which both have working click-to-toggle behaviour.
          style={{ pointerEvents: "none" }}
        />
        {/* Render the visible square as a <label htmlFor> so a click on it
         * toggles the (visually-hidden, opacity:0) <input> via native browser
         * behaviour. Was a bare <p> previously, which is why clicks on the
         * checkbox glyph silently no-op'd on the employee login (closes
         * egovernments/CCRS#503). The text label below is unchanged. The
         * onClick is a belt-and-suspenders fallback for any environment
         * where the label[for] native behaviour doesn't kick in (e.g.
         * synthetic-event automation, custom shadow-DOM hosts). */}
        <label
          htmlFor={props.id || `checkbox-${value}`}
          className={`digit-custom-checkbox ${
            userType === "employee" ? "digit-custom-checkbox-emp" : ""
          } ${isIntermediate ? "intermediate" : ""} ${
            props?.inputIconClassname
          } `}
          style={{ cursor: disabled ? "not-allowed" : "pointer" }}
          onClick={(e) => {
            if (disabled) return;
            // If the click was already routed to the input via label[for],
            // checked has flipped — bail. Otherwise force-toggle so the
            // glyph behaves the same as the input's hit area.
            const inp = e.currentTarget.parentElement?.querySelector("input[type='checkbox']");
            if (inp && e.target !== inp) {
              e.preventDefault();
              inp.click();
            }
          }}
        >
          {isIntermediate && !checked ? (
            <span
              className={`intermediate-square ${
                disabled ? "squaredisabled" : ""
              }`}
            />
          ) : (
            <SVG.Check
              fill={
                props?.iconFill || (disabled ? diabledIconColor : iconColor)
              }
            />
          )}
        </label>
      </div>
      {!isLabelFirst && !hideLabel ? (
        <label
          htmlFor={props.id || `checkbox-${value}`}
          className={`label ${props?.labelClassName} `}
          style={{ maxWidth: "100%", width: "100%", marginRight: "0rem" }}
          onClick={props?.onLabelClick}
        >
          {sentenceCaseLabel}
        </label>
      ) : null}
    </div>
  );
};

CheckBox.propTypes = {
  /**
   * CheckBox content
   */
  label: PropTypes.string.isRequired,
  /**
   * onChange func
   */
  onChange: PropTypes.func,
  /**
   * input ref
   */
  ref: PropTypes.func,
  userType: PropTypes.string,
  hideLabel:PropTypes.bool,
  isIntermediate: PropTypes.bool,
};

CheckBox.defaultProps = {
  label: "Default",
  isLabelFirst: false,
  onChange: () => console.log("CLICK"),
  value: "",
  checked: false,
  ref: "ww",
  // pageType: "EMPLOYEE",
  index: 0,
  isIntermediate: false,
};

export default CheckBox;
