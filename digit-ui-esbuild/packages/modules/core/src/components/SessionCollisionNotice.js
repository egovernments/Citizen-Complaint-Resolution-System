import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PopUp, Button } from "@egovernments/digit-ui-components";
import { detectSessionCollision, onSessionCollision } from "@egovernments/digit-ui-libraries";

// Tells the user when ANOTHER tab in this browser has signed in as a different
// user of the same type. The platform keeps the active session per tab but
// writes the shared `Employee.*` / `Citizen.*` keys under fixed names, so the
// older tab can silently adopt the newer identity after a reload. Saying so is
// far better than letting a complaint be filed under the wrong officer.
//
// Deliberately NOTIFY-ONLY: nothing here signs anybody out or reloads the
// page, so an in-progress complaint is never destroyed. The user decides.
// Never appears for employee+citizen (different keys) or for the same person
// in two tabs (same uuid) — see detectSessionCollision.
//
// Presented as INFORMATION, not an alert: the user has done nothing wrong and
// nothing is broken, so the popup avoids the red warning treatment and leads
// with what is true right now ("you are still working as X") before the
// consequence of refreshing.
const SessionCollisionNotice = () => {
  const { t } = useTranslation();
  const [other, setOther] = useState(null);
  const [me, setMe] = useState(null);

  useEffect(() => {
    const capture = (detected) => {
      setMe(window?.Digit?.UserService?.getUser?.()?.info || null);
      setOther(detected);
    };
    // Collision may already exist at mount (this tab was reloaded after the
    // other tab signed in), and may also happen live while this tab is open.
    const existing = detectSessionCollision();
    if (existing) capture(existing);
    return onSessionCollision(capture);
  }, []);

  if (!other) return null;

  // Localisation keys with built-in English fallbacks: the notice must read
  // correctly on an environment where these keys have not been seeded.
  const tx = (key, fallback) => (t(key) === key ? fallback : t(key));
  const myName = me?.name || me?.userName || tx("CORE_SESSION_COLLISION_YOU", "you");

  return (
    <PopUp
      className="digit-session-collision-popup"
      style={{ maxWidth: "31rem" }}
      showIcon={false}
      heading={tx("CORE_SESSION_COLLISION_HEADING", "Another account signed in")}
      onClose={() => setOther(null)}
      onOverlayClick={() => setOther(null)}
      children={[
        <div key="body" style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "0.25rem 0" }}>
          {/* Reassurance first: nothing the user is doing has been lost. */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
              padding: "0.75rem",
              borderRadius: "0.25rem",
              background: "var(--color-primary-bg, #f6f6f6)",
              borderLeft: "4px solid var(--color-primary-main, #c84c0e)",
            }}
          >
            <div style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "var(--color-text-primary, #0b0c0c)" }}>
              {tx("CORE_SESSION_COLLISION_STILL_YOU", "You are still working as")}{" "}
              <strong>{myName}</strong>
              {". "}
              {tx("CORE_SESSION_COLLISION_NO_DATA_LOST", "Nothing on this page has been lost.")}
            </div>
          </div>

          <div style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "var(--color-text-secondary, #4b5462)" }}>
            {tx("CORE_SESSION_COLLISION_WHAT_HAPPENED", "This browser was signed in as")}{" "}
            <strong style={{ color: "var(--color-text-primary, #0b0c0c)" }}>{other.name}</strong>{" "}
            {tx("CORE_SESSION_COLLISION_IN_ANOTHER_TAB", "in another tab.")}
          </div>

          <ul
            style={{
              margin: 0,
              paddingLeft: "1.125rem",
              // `display:flex` on a list suppresses its markers, so keep the
              // default list layout and space the items with li margins.
              listStyle: "disc outside",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "var(--color-text-secondary, #4b5462)",
            }}
          >
            <li style={{ marginBottom: "0.375rem" }}>{tx("CORE_SESSION_COLLISION_TIP_FINISH", "Finish and save your work in this tab before refreshing it.")}</li>
            <li style={{ marginBottom: "0.375rem" }}>{tx("CORE_SESSION_COLLISION_TIP_REFRESH", "Refreshing this tab may switch it to the other account.")}</li>
            <li>{tx("CORE_SESSION_COLLISION_TIP_SEPARATE", "To use both accounts at the same time, open one in a private window.")}</li>
          </ul>
        </div>,
      ]}
      footerChildren={[
        <Button
          key="ack"
          type="button"
          size="large"
          variation="primary"
          label={tx("CORE_SESSION_COLLISION_ACK", "Continue working")}
          onClick={() => setOther(null)}
        />,
      ]}
    />
  );
};

export default SessionCollisionNotice;
