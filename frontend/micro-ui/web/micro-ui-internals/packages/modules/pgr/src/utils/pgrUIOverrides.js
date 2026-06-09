// Injects PGR UI style overrides into document.head once at module import time,
// so they apply on the very first paint and survive page refreshes (a JSX
// <style> element inside the component tree can race with the toast / inbox
// mount on refresh and miss the first paint). Idempotent — re-running is a
// no-op.

const STYLE_ID = "pgr-ui-overrides";

const css = `
  .digit-toast-success,
  .digit-toast-success.animate {
    bottom: 8rem !important;
  }
  .digit-inbox-search-wrapper {
    max-width: 100%;
    overflow-x: auto;
  }
  .status-container .checkbox-wrap {
    display: flex !important;
    align-items: center !important;
    min-height: 0 !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0.5rem 0 !important;
    position: relative !important;
  }
  .status-container .checkbox-wrap > div:first-child {
    position: relative !important;
    width: 24px !important;
    height: 24px !important;
    flex: 0 0 24px !important;
    margin-right: 0.75rem !important;
  }
  .status-container .checkbox-wrap > div:first-child input {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 24px !important;
    height: 24px !important;
    margin: 0 !important;
    z-index: 1 !important;
    cursor: pointer !important;
  }
  .status-container .checkbox-wrap > div:first-child .custom-checkbox,
  .status-container .checkbox-wrap > div:first-child .custom-checkbox-emp {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 24px !important;
    height: 24px !important;
    margin: 0 !important;
  }
  .status-container .checkbox-wrap .label {
    margin: 0 !important;
    line-height: 1.25 !important;
    flex: 1 1 auto !important;
    max-width: none !important;
  }
`;

export const injectPGRUIOverrides = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
};

injectPGRUIOverrides();
