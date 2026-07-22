import React from "react";
import { useTranslation } from "react-i18next";

// QA #26 — Canal de Recepção as a CHIP selector (radio-style pills with an
// icon + label + check circle), rendered at the top of the employee create
// form. The selected option's CODE rides service.source at submit
// (email / inperson / letter / linhaverde — kept in pgr-services'
// allowed.source list).
const OPTIONS = [
  { code: "email", name: "PGR_CHANNEL_EMAIL", icon: "mail" },
  { code: "inperson", name: "PGR_CHANNEL_IN_PERSON", icon: "person" },
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

const ACCENT = "var(--color-success, #00703C)";
const ACCENT_BG = "var(--color-success-bg, #E8F3EE)";

const ChannelChipsComponent = ({ config, onSelect, formData }) => {
  const { t } = useTranslation();
  const key = config?.key || "ReceivedChannel";
  const selected = formData?.[key]?.code;

  return (
    <div style={{ marginBottom: "16px" }}>
      <div role="radiogroup" aria-label={t("ES_CREATECOMPLAINT_RECEIVED_CHANNEL")} style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.code;
          return (
            <button
              key={opt.code}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(key, { code: opt.code, name: opt.name })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 14px",
                borderRadius: "10px",
                border: `1px solid ${isSelected ? ACCENT : "var(--color-border, #E0E0E0)"}`,
                backgroundColor: isSelected ? ACCENT_BG : "var(--color-background-secondary, #F6F6F6)",
                color: isSelected ? ACCENT : "var(--color-text-heading, #363636)",
                fontWeight: 600,
                fontSize: "0.875rem",
                cursor: "pointer",
                transition: "background-color 0.12s ease-out, border-color 0.12s ease-out",
              }}
            >
              {ICONS[opt.icon]}
              <span>{t(opt.name)}</span>
              {isSelected ? (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                  <circle cx="12" cy="12" r="10" fill={ACCENT.startsWith("var") ? "#00703C" : ACCENT} />
                  <path d="m8 12 3 3 5-6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                  <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-border, #C5C5C5)" strokeWidth="2" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ChannelChipsComponent;
