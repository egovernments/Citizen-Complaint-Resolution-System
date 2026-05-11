import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

const styles = {
  wrapper: { marginTop: 8 },
  hint: { fontSize: 12, color: "#505a5f", display: "block", marginBottom: 6 },
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    border: "1px dashed #f47738",
    borderRadius: 4,
    color: "#f47738",
    fontSize: 13,
    fontWeight: 500,
    background: "#fff",
    userSelect: "none",
  },
  plus: { fontSize: 16, lineHeight: 1 },
  list: { marginTop: 8, display: "flex", flexDirection: "column", gap: 4 },
  chip: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px",
    background: "#f6f6f6",
    borderRadius: 4,
    fontSize: 12,
    maxWidth: 240,
  },
  chipName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 },
  remove: {
    background: "none",
    border: "none",
    color: "#d4351c",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
    marginLeft: 8,
  },
  error: { color: "#d4351c", fontSize: 12, marginTop: 4 },
};

const ActionUploadComponent = ({ config, onSelect }) => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const tr = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const emit = (next) => {
    setFiles(next);
    if (config?.key) onSelect(config.key, next.map((f) => f.id));
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    if (file.size > MAX_SIZE_BYTES) {
      setError(tr("CS_FILE_TOO_LARGE", "File too large (max 2MB)"));
      return;
    }

    setError("");
    setIsUploading(true);
    try {
      const response = await Digit.UploadServices.Filestorage("property-upload", file, tenantId);
      const fileStoreId = response?.data?.files?.[0]?.fileStoreId;
      if (fileStoreId) {
        emit([...files, { id: fileStoreId, name: file.name }]);
      } else {
        setError(tr("CS_UPLOAD_FAILED", "Upload failed"));
      }
    } catch {
      setError(tr("CS_UPLOAD_FAILED", "Upload failed"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = (id) => emit(files.filter((f) => f.id !== id));

  const triggerStyle = {
    ...styles.trigger,
    cursor: isUploading ? "wait" : "pointer",
    opacity: isUploading ? 0.6 : 1,
  };

  return (
    <div style={styles.wrapper}>
      <span style={styles.hint}>
        {tr("CS_UPLOAD_HELPER", "Add screenshots or documents (max 2MB each)")}
      </span>

      <input
        ref={inputRef}
        id="pgr-action-upload"
        type="file"
        accept="image/*,.pdf"
        onChange={handleFileChange}
        disabled={isUploading}
        style={{ display: "none" }}
      />

      <label htmlFor="pgr-action-upload" style={triggerStyle}>
        <span style={styles.plus}>+</span>
        {isUploading ? tr("CS_COMMON_UPLOADING", "Uploading…") : tr("CS_COMMON_ADD_FILE", "Add file")}
      </label>

      {files.length > 0 && (
        <div style={styles.list}>
          {files.map((f) => (
            <div key={f.id} style={styles.chip}>
              <span style={styles.chipName} title={f.name}>{f.name}</span>
              <button
                type="button"
                onClick={() => handleRemove(f.id)}
                style={styles.remove}
                aria-label={tr("CS_COMMON_REMOVE", "Remove")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
};

export default ActionUploadComponent;
