import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { RoundedCheck, DeleteBtn, ErrorIcon } from "./svgindex";
import ButtonSelector from "./ButtonSelector";

// Auto-dismiss delay in ms. Configurable per deployment via the runtime config
// key TOAST_AUTO_DISMISS_MS (window.globalConfigs); falls back to 5000 (5s).
// A positive `override` (autoDismissTimer prop) wins over the config.
const resolveAutoDismissMs = (override) => {
  if (override != null && Number(override) > 0) return Number(override);
  const fromConfig =
    (typeof window !== "undefined" && window?.globalConfigs?.getConfig?.("TOAST_AUTO_DISMISS_MS")) || undefined;
  const ms = Number(fromConfig);
  return Number.isFinite(ms) && ms > 0 ? ms : 5000;
};

const Toast = (props) => {
  // Opt-in auto-dismiss: when `autoDismiss` is set, call onClose after the
  // configured delay. onClose is read through a ref so a parent passing an
  // inline handler doesn't reset the timer on every render; the timer resets
  // when the message (label) changes so a new toast gets the full delay.
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    if (!props.autoDismiss) return undefined;
    const timer = setTimeout(() => {
      if (typeof onCloseRef.current === "function") onCloseRef.current();
    }, resolveAutoDismissMs(props.autoDismissTimer));
    return () => clearTimeout(timer);
  }, [props.autoDismiss, props.autoDismissTimer, props.label]);

  if (props.error) {
    return (
      <div className="toast-success error" style={{ backgroundColor: "red", ...props.style }}>
        <ErrorIcon />
        <h2 style={{...props.labelstyle}}>{props.label}</h2>
        { props.isDleteBtn ? <DeleteBtn fill="none" className="toast-close-btn" onClick={props.onClose} /> : null }
      </div>
    );
  }

  if (props.warning) {
    return (
      <div>
        <div className="toast-success" style={props?.isWarningButtons ? { backgroundColor: "#EA8A3B", display: "block", ...props.style } : { backgroundColor: "#EA8A3B", ...props.style }}>
          {!props?.isWarningButtons ?
            <div className="toast-success" style={{ backgroundColor: "#EA8A3B", ...props.style }}>
              <ErrorIcon />
              <h2 style={{ marginLeft: "10px" }}>{props.label}</h2>
              {props.isDleteBtn ? <DeleteBtn fill="none" className="toast-close-btn" onClick={props.onClose} /> : null}
            </div> : <div style={{ display: "flex" }}>
              <ErrorIcon />
              <h2 style={{ marginLeft: "10px" }}>{props.label}</h2>
              {props.isDleteBtn ? <DeleteBtn fill="none" className="toast-close-btn" onClick={props.onClose} /> : null}
            </div>
          }
          {props?.isWarningButtons ?
            <div style={{ width: "100%", display: "flex", justifyContent: "flex-end" }}>
              <ButtonSelector theme="border" label={"NO"} onSubmit={props.onNo} style={{ marginLeft: "10px" }} />
              <ButtonSelector label={"YES"} onSubmit={props.onYes} style={{ marginLeft: "10px" }} />
            </div> : null
          }
        </div>
      </div>
    );
  }

  return (
    <div className="toast-success" style={{ ...props.style }}>
      <RoundedCheck />
      <h2>{props.label}</h2>
      <DeleteBtn fill="none" className="toast-close-btn" onClick={props.onClose} />
    </div>
  );
};

Toast.propTypes = {
  label: PropTypes.string,
  onClose: PropTypes.func,
  isDleteBtn: PropTypes.bool,
  // When true, the toast calls onClose after the auto-dismiss delay.
  autoDismiss: PropTypes.bool,
  // Optional per-toast override (ms) for the auto-dismiss delay.
  autoDismissTimer: PropTypes.number
};

Toast.defaultProps = {
  label: "",
  onClose: undefined,
  isDleteBtn: false,
  autoDismiss: false
};

export default Toast;
