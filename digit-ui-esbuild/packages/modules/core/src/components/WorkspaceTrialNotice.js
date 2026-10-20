import React from "react";
import { PopUp, Button } from "@egovernments/digit-ui-components";

// Only http(s) links render; anything else (javascript:, data:) is dropped.
const safeLink = (url) => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol) ? url : null;
  } catch (_) {
    return null;
  }
};

/**
 * Blocking "trial ended" modal for a locked workspace on the sign-in pages.
 *
 * Deliberate exception to "digit-ui never renders BFF display text": the
 * notice is operator-configured content, not error text. Every field is
 * rendered as a plain text child, never as HTML. The link shows only when
 * both link fields are present.
 */
export const WorkspaceTrialNoticeBody = ({ notice }) => {
  const href = notice.linkLabel && notice.linkUrl ? safeLink(notice.linkUrl) : null;
  return (
    <div className="digit-workspace-trial-notice" role="alert">
      <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: "pre-line" }}>{notice.message}</p>
      {href ? (
        <p style={{ margin: "16px 0 0" }}>
          <a href={href} target="_blank" rel="noopener noreferrer">{notice.linkLabel}</a>
        </p>
      ) : null}
    </div>
  );
};

// PopUp calls onClose unguarded from its X button and Escape, so a function
// is always passed; callers show the notice inline once it is closed.
const WorkspaceTrialNotice = ({ notice, onClose }) => {
  if (!notice) return null;
  const close = typeof onClose === "function" ? onClose : () => {};
  return (
    <PopUp
      type="default"
      heading={notice.title}
      children={[<WorkspaceTrialNoticeBody key="body" notice={notice} />]}
      footerChildren={[
        <Button key="ok" type="button" size="large" variation="primary" label="OK" onClick={close} />,
      ]}
      onClose={close}
      onOverlayClick={close}
      className="digit-workspace-trial-popup"
    />
  );
};

export default WorkspaceTrialNotice;
