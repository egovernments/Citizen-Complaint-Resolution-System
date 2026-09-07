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
// NOTIFY-FIRST by design: dismissing changes nothing, so an in-progress
// complaint is never destroyed. Switching to the other account is offered as a
// deliberate secondary action for the user who actually wants it — it reloads,
// which is why it is not the default.
//
// Never appears for employee+citizen (different key prefixes) or for the same
// person in two tabs (same uuid) — see detectSessionCollision.

// Theme variables with literal fallbacks: this notice must render correctly
// even before a tenant theme has been applied.
const C = {
  text: "var(--color-text-primary, #0B0C0C)",
  muted: "var(--color-text-secondary, #505A5F)",
  border: "var(--color-border, #D6D5D4)",
  surfaceAlt: "var(--color-grey-light, #FAFAFA)",
  info: "var(--color-digitv2-alert-info, #3498DB)",
  success: "var(--color-success, #00703C)",
};

const InfoIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: "0.125rem" }}>
    <circle cx="12" cy="12" r="10" fill={C.info} />
    <path d="M12 11v6M12 7.5v.01" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

// One account row. `current` marks the session this tab is actually using.
// Names wrap rather than truncate: identifying the account is the whole point,
// and pt_MZ names run long.
const AccountRow = ({ name, label, current }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      padding: "0.75rem 1rem",
      background: current ? C.surfaceAlt : "transparent",
      borderLeft: `3px solid ${current ? C.success : "transparent"}`,
    }}
  >
    <div
      style={{
        width: "2rem",
        height: "2rem",
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: current ? C.success : C.info,
        color: "#fff",
        fontSize: "0.875rem",
        fontWeight: 700,
      }}
    >
      {String(name || "?").trim().charAt(0).toUpperCase()}
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: C.text, overflowWrap: "anywhere", lineHeight: 1.35 }}>{name}</div>
      <div style={{ fontSize: "0.8125rem", color: C.muted, marginTop: "0.0625rem" }}>{label}</div>
    </div>
  </div>
);

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
  const myName = me?.name || me?.userName || tx("CORE_SESSION_COLLISION_YOU", "You");

  return (
    <PopUp
      className="digit-session-collision-popup"
      style={{ maxWidth: "38rem", width: "min(38rem, 94vw)" }}
      showIcon={false}
      heading={tx("CORE_SESSION_COLLISION_HEADING", "Another account signed in")}
      onClose={() => setOther(null)}
      onOverlayClick={() => setOther(null)}
      children={[
        <div key="body" style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "0.25rem 0" }}>
          {/* Group 1 — the situation: lead sentence tied tightly to the two
              identities it is about (0.75rem), so they read as one idea. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <InfoIcon />
              <div style={{ fontSize: "0.9375rem", lineHeight: 1.55, color: C.text }}>
                {tx(
                  "CORE_SESSION_COLLISION_LEAD",
                  "Two accounts are open in this browser. Your work here is safe — but this browser now remembers the other account."
                )}
              </div>
            </div>

            <div style={{ border: `1px solid ${C.border}`, borderRadius: "0.25rem", overflow: "hidden" }}>
              <AccountRow name={myName} label={tx("CORE_SESSION_COLLISION_THIS_TAB", "This tab — your current work")} current />
              <div style={{ height: "1px", background: C.border }} />
              <AccountRow name={other.name} label={tx("CORE_SESSION_COLLISION_OTHER_TAB", "Signed in from another tab")} />
            </div>
          </div>

          {/* Group 2 — the guidance. A rule instead of a filled panel: three
              short lines do not need a coloured block competing with the
              account card above. */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "1rem" }}>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "0.5rem" }}>
              {tx("CORE_SESSION_COLLISION_WHAT_TO_DO", "What to do")}
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.125rem", listStyle: "disc outside", fontSize: "0.875rem", lineHeight: 1.6, color: C.text }}>
              <li style={{ marginBottom: "0.25rem" }}>
                {tx("CORE_SESSION_COLLISION_TIP_FINISH", "Finish and submit what you are working on in this tab.")}
              </li>
              <li style={{ marginBottom: "0.25rem" }}>
                {tx("CORE_SESSION_COLLISION_TIP_REFRESH", "Avoid refreshing this tab — it may switch to the other account.")}
              </li>
              <li>
                {tx("CORE_SESSION_COLLISION_TIP_SEPARATE", "To use both accounts at once, open one in a private window.")}
              </li>
            </ul>
          </div>
        </div>,
      ]}
      footerChildren={[
        // Secondary, and deliberately not the default: switching reloads the
        // page, which would discard anything unsaved in this tab.
        <Button
          key="switch"
          type="button"
          size="large"
          variation="link"
          label={`${tx("CORE_SESSION_COLLISION_SWITCH", "Switch to")} ${other.name}`}
          onClick={() => window.location.reload()}
        />,
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
