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
// nothing is broken. The two accounts are shown side by side because the whole
// point is telling them apart; the theme's info blue carries that, leaving the
// brand orange for actions and red for genuine errors.

// Theme variables with literal fallbacks: this notice must render correctly
// even before a tenant theme has been applied.
const C = {
  text: "var(--color-text-primary, #0B0C0C)",
  muted: "var(--color-text-secondary, #505A5F)",
  border: "var(--color-border, #D6D5D4)",
  surfaceAlt: "var(--color-grey-light, #FAFAFA)",
  info: "var(--color-digitv2-alert-info, #3498DB)",
  infoBg: "var(--color-digitv2-alert-info-bg, #C7E0F1)",
  success: "var(--color-success, #00703C)",
};

const InfoIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" fill={C.info} />
    <path d="M12 11v6M12 7.5v.01" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

// One account row. `current` marks the session this tab is actually using.
const AccountRow = ({ name, label, current }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      padding: "0.875rem 1rem",
      background: current ? C.surfaceAlt : "transparent",
      borderLeft: `3px solid ${current ? C.success : "transparent"}`,
    }}
  >
    <div
      style={{
        width: "2.25rem",
        height: "2.25rem",
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: current ? C.success : C.info,
        color: "#fff",
        fontSize: "0.9375rem",
        fontWeight: 700,
      }}
    >
      {String(name || "?").trim().charAt(0).toUpperCase()}
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: C.text, overflowWrap: "anywhere" }}>{name}</div>
      <div style={{ fontSize: "0.8125rem", color: C.muted, marginTop: "0.125rem" }}>{label}</div>
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
      style={{ maxWidth: "40rem", width: "min(40rem, 92vw)" }}
      showIcon={false}
      heading={tx("CORE_SESSION_COLLISION_HEADING", "Another account signed in")}
      onClose={() => setOther(null)}
      onOverlayClick={() => setOther(null)}
      children={[
        <div key="body" style={{ display: "flex", flexDirection: "column", gap: "1.25rem", padding: "0.5rem 0 0.25rem" }}>
          {/* Lead: what happened, in one sentence, with an informational tone. */}
          <div style={{ display: "flex", gap: "0.875rem", alignItems: "flex-start" }}>
            <InfoIcon />
            <div style={{ fontSize: "0.9375rem", lineHeight: 1.55, color: C.text }}>
              {tx(
                "CORE_SESSION_COLLISION_LEAD",
                "Two accounts are open in this browser. Your work here is safe — but this browser now remembers the other account."
              )}
            </div>
          </div>

          {/* The two identities, side by side: this is the information that
              actually resolves the user's confusion. */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: "0.25rem", overflow: "hidden" }}>
            <AccountRow name={myName} label={tx("CORE_SESSION_COLLISION_THIS_TAB", "This tab — your current work")} current />
            <div style={{ height: "1px", background: C.border }} />
            <AccountRow name={other.name} label={tx("CORE_SESSION_COLLISION_OTHER_TAB", "Signed in from another tab")} />
          </div>

          {/* What to do, in priority order. */}
          <div style={{ background: C.infoBg, borderRadius: "0.25rem", padding: "0.875rem 1rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: C.text, marginBottom: "0.5rem" }}>
              {tx("CORE_SESSION_COLLISION_WHAT_TO_DO", "What to do")}
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.125rem", listStyle: "disc outside", fontSize: "0.875rem", lineHeight: 1.6, color: C.text }}>
              <li style={{ marginBottom: "0.375rem" }}>
                {tx("CORE_SESSION_COLLISION_TIP_FINISH", "Finish and submit what you are working on in this tab.")}
              </li>
              <li style={{ marginBottom: "0.375rem" }}>
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
