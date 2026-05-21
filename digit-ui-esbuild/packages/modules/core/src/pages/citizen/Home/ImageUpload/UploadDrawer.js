// V2 Upload Drawer — replaces the legacy unstyled full-width slab
// (CCRS deploy regression: appeared as a 1459×152 white bar at the
// bottom with no padding, broken icon styling, no proper modal
// chrome). Now a centered v2 modal: dimmed overlay + brand-tinted
// card with two clear actions (Choose photo / Remove) and a Cancel
// button. Same upload pipeline (`Digit.UploadServices.Filestorage`
// → fileStoreId → setProfilePic), so the data flow is byte-identical.

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image as ImageIcon, Trash2, X } from "lucide-react";

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

const tr = (t, key, fallback) => {
  const v = t(key);
  return v === key ? fallback : v;
};

function ActionRow({ Icon, label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="v2-upload-action-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        width: "100%",
        padding: "12px 14px",
        borderRadius: "8px",
        border: "1px solid var(--color-border, #d6d5d4)",
        background:
          "var(--v2-surface-color, var(--color-surface, #ffffff))",
        color: danger
          ? "var(--color-error, #d4351c)"
          : "var(--color-text-primary, #0B0C0C)",
        fontSize: "0.9375rem",
        fontWeight: 500,
        textAlign: "left",
        cursor: "pointer",
        transition: "background-color 0.15s ease-out, border-color 0.15s ease-out",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "36px",
          height: "36px",
          borderRadius: "9999px",
          flexShrink: 0,
          background: danger
            ? "rgba(212, 53, 28, 0.10)"
            : "var(--color-primary-selected-bg, #FFF4D7)",
          color: danger
            ? "var(--color-error, #d4351c)"
            : "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
        }}
      >
        <Icon style={{ width: 18, height: 18 }} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function UploadDrawer({ setProfilePic, closeDrawer, userType, removeProfilePic, showToast }) {
  const { t } = useTranslation();
  const [file, setFile] = useState("");
  const [error, setError] = useState(null);

  const onFilePicked = (e) => setFile(e.target.files[0]);
  const onRemove = () => {
    removeProfilePic();
    closeDrawer();
  };

  // Esc-to-close support — same affordance v2 confirm dialogs use.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDrawer]);

  // Upload pipeline — unchanged contract: filestore POST returns a
  // fileStoreId; surface that to the parent so it can set the avatar.
  useEffect(() => {
    if (!file) return;
    setError(null);
    if (file.size >= MAX_PROFILE_IMAGE_BYTES) {
      showToast?.("error", t("CORE_COMMON_PROFILE_MAXIMUM_UPLOAD_SIZE_EXCEEDED"));
      setError(t("CORE_COMMON_PROFILE_MAXIMUM_UPLOAD_SIZE_EXCEEDED"));
      return;
    }
    (async () => {
      try {
        const response = await Digit.UploadServices.Filestorage(
          `${userType}-profile`,
          file,
          Digit.ULBService.getStateId()
        );
        const fileStoreId = response?.data?.files?.[0]?.fileStoreId;
        if (fileStoreId) {
          setProfilePic(fileStoreId);
          closeDrawer();
        } else {
          showToast?.("error", t("CORE_COMMON_PROFILE_FILE_UPLOAD_ERROR"));
          setError(t("CORE_COMMON_PROFILE_FILE_UPLOAD_ERROR"));
        }
      } catch (err) {
        showToast?.("error", t("CORE_COMMON_PROFILE_INVALID_FILE_INPUT"));
        setError(t("CORE_COMMON_PROFILE_INVALID_FILE_INPUT"));
      }
    })();
  }, [file]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr(t, "CORE_COMMON_CHANGE_PHOTO", "Change photo")}
      onClick={closeDrawer}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(11, 12, 12, 0.5)",
        padding: "16px",
      }}
    >
      <div
        className="v2-upload-drawer"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "440px",
          backgroundColor:
            "var(--v2-surface-color, var(--color-surface, #ffffff))",
          borderRadius: "10px",
          boxShadow:
            "0 20px 25px -5px rgba(16, 24, 40, 0.18), 0 8px 10px -6px rgba(16, 24, 40, 0.12)",
          padding: "20px 22px 22px 22px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "1.0625rem",
                fontWeight: 700,
                color:
                  "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                lineHeight: 1.3,
              }}
            >
              {tr(t, "CORE_COMMON_CHANGE_PHOTO", "Change photo")}
            </h2>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: "0.8125rem",
                color: "var(--color-text-secondary, #6B7280)",
                lineHeight: 1.45,
              }}
            >
              {tr(
                t,
                "CORE_PROFILE_UPLOAD_HINT",
                "Pick a new image (max 5 MB) or remove the current one."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label={tr(t, "CORE_COMMON_CLOSE", "Close")}
            className="v2-upload-close-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              border: 0,
              borderRadius: 6,
              background: "transparent",
              color: "var(--color-text-secondary, #6B7280)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Hidden native input — clicking the label triggers the file picker. */}
          <label
            htmlFor="v2-profile-upload-file"
            style={{ cursor: "pointer", display: "block" }}
          >
            <ActionRow
              Icon={ImageIcon}
              label={tr(t, "CORE_PROFILE_CHOOSE_PHOTO", "Choose from gallery")}
              // Triggering the underlying input via label click — no
              // explicit handler here, the label-for relationship does it.
              onClick={() => {
                document.getElementById("v2-profile-upload-file")?.click();
              }}
            />
          </label>
          <input
            id="v2-profile-upload-file"
            type="file"
            accept="image/*,.png,.jpeg,.jpg"
            onChange={onFilePicked}
            style={{ display: "none" }}
          />
          <ActionRow
            Icon={Trash2}
            label={tr(t, "CORE_COMMON_REMOVE", "Remove current photo")}
            onClick={onRemove}
            danger
          />
        </div>

        {error ? (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: "0.8125rem",
              color: "var(--color-error, #d4351c)",
            }}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default UploadDrawer;
