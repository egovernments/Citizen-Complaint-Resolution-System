import React from "react";
import { PopUp, Button } from "@egovernments/digit-ui-components";

/**
 * Blocking "trial ended" modal for a locked workspace on the sign-in pages.
 *
 * Deliberate exception to "digit-ui never renders BFF display text": the
 * notice is operator-configured content, not error text. Every field is
 * rendered as a plain text child, never as HTML.
 */
export const WorkspaceTrialNoticeBody = ({ notice }) => (
  <div className="digit-workspace-trial-notice" role="alert">
    <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: "pre-line" }}>{notice.message}</p>
    {notice.linkUrl ? (
      <p style={{ margin: "16px 0 0" }}>
        <a href={notice.linkUrl} target="_blank" rel="noopener noreferrer">{notice.linkLabel}</a>
      </p>
    ) : null}
  </div>
);

// PopUp calls onClose from its X button and Escape; callers show the notice inline once it is closed.
const WorkspaceTrialNotice = ({ notice, onClose }) => (
  <PopUp
    type="default"
    heading={notice.title}
    children={[<WorkspaceTrialNoticeBody key="body" notice={notice} />]}
    footerChildren={[
      <Button key="ok" type="button" size="large" variation="primary" label="OK" onClick={onClose} />,
    ]}
    onClose={onClose}
    onOverlayClick={onClose}
    className="digit-workspace-trial-popup"
  />
);

export default WorkspaceTrialNotice;
