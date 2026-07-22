import React from "react";
import { useTranslation } from "react-i18next";

// QA #26 — Canal de Recepção as a CHIP selector (card-style pills with an
// icon + label + radio circle), rendered just above the mobile number on the
// employee create form. The selected option's CODE rides service.source at
// submit (email / inperson / letter / linhaverde — kept in pgr-services'
// allowed.source list).
//
// Rendered as SPANs, not <button>: the platform stylesheet resets buttons
// with !important rules that beat inline styles (same lesson as the admin
// search chips), which flattened the pills into bare text.
const OPTIONS = [
  // In Person first (product call) — it is also the pre-selected default.
  { code: "inperson", name: "PGR_CHANNEL_IN_PERSON", icon: "person" },
  { code: "email", name: "PGR_CHANNEL_EMAIL", icon: "mail" },
  { code: "letter", name: "PGR_CHANNEL_LETTER", icon: "letter" },
  { code: "linhaverde", name: "PGR_CHANNEL_LINHA_VERDE", icon: "phone" },
];

const ICONS = {
  mail: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  person: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  ),
  letter: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M15 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  ),
  phone: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  ),
};

// Same theme tokens the rest of the PGR UI uses (StatusPill, links):
// primary accent with the platform fallback chain; selected bg = the
// theme's selected-pill tint.
const ACCENT = "var(--color-primary-1, var(--color-primary-main, #c84c0e))";
const ACCENT_BG = "var(--color-primary-selected-bg, #FFF4D7)";

const ChannelChipsComponent = ({ config, onSelect, formData }) => {
  const { t } = useTranslation();
  const key = config?.key || "ReceivedChannel";
  const selected = formData?.[key]?.code;

  const pick = (opt) => onSelect(key, { code: opt.code, name: opt.name });

  return (
    // Same width cap as the inputs below (the platform caps field controls at
    // ~600px) so the chip row's right edge lines up with the mobile number.
    <div style={{ width: "100%", maxWidth: "600px" }}>
      <div role="radiogroup" aria-label={t("ES_CREATECOMPLAINT_RECEIVED_CHANNEL")} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.code;
          return (
            <span
              key={opt.code}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => pick(opt)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(opt);
                }
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                // Fill the control column: 140px basis + grow → all 4 chips
                // share one row on desktop (4×140 + gaps < 600px cap) and the
                // row's right edge lines up with the inputs below; on phones
                // they wrap into a tidy 2×2 grid instead of overflowing.
                flex: "1 1 140px",
                minWidth: "140px",
                whiteSpace: "nowrap",
                justifyContent: "space-between",
                gap: "8px",
                padding: "8px 10px",
                borderRadius: "8px",
                border: `1px solid ${isSelected ? ACCENT : "#E0E0E0"}`,
                backgroundColor: isSelected ? ACCENT_BG : "#F7F7F7",
                color: isSelected ? ACCENT : "#363636",
                fontWeight: 600,
                fontSize: "0.8125rem",
                lineHeight: 1,
                cursor: "pointer",
                userSelect: "none",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                transition: "background-color 0.12s ease-out, border-color 0.12s ease-out",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                {ICONS[opt.icon]}
                <span>{t(opt.name)}</span>
              </span>
              {isSelected ? (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                  <circle cx="12" cy="12" r="10" style={{ fill: ACCENT }} />
                  <path d="m8 12 3 3 5-6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                  <circle cx="12" cy="12" r="9" fill="#fff" stroke="#C5C5C5" strokeWidth="2" />
                </svg>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default ChannelChipsComponent;
