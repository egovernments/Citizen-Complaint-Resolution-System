import React from "react";

// Shared PGR file uploader — the SAME component/UX as the citizen create
// wizard's Step-4 uploader (CreatePGRFlowV2 PgrFileUpload): dashed drop-zone
// with cloud icon + "Choose files", preview-card grid (image thumb or doc
// icon, check badge, ✕ remove, name + size), drag-and-drop, 2MB/file,
// keyboard accessible. Extracted here so the employee workflow-action modal
// (CCSD-1965) reuses it verbatim; the citizen wizard keeps its inline copy
// with identical markup/classes (unifying that import is a follow-up).
//
// Self-contained: injects its own scoped CSS once (.pgr-upload* — the same
// class names/rules as the wizard's WIZARD_CSS block, so double-injection on
// the citizen page is harmless).

// Per the Moz feedback doc (CCSD-1971): PDF, DOC, images, audio and video up
// to 5 MB each. Server-side, filestore's allowed-format list for module
// "property-upload" must also permit these (platform config).
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file
const DEFAULT_ACCEPT =
  "image/*,.pdf,.doc,.docx,.mp3,.wav,.m4a,.aac,.mp4,.mov,.avi,.mkv";

function tr(t, key, fallback) {
  const v = typeof t === "function" ? t(key) : key;
  return v === key ? fallback : v;
}

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CheckIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const CloudIcon = (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 16l-4-4-4 4" />
    <path d="M12 12v9" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
);
const XIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const DocIcon = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

const STYLE_ID = "pgr-file-upload-css";
const UPLOAD_CSS = `
.pgr-upload { width: 100%; }
.pgr-upload-error {
  margin-bottom: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 0.5rem;
  background: #fdecea; border: 1px solid #f5c2bc; color: #b3261e;
  font-size: 0.8rem; text-align: center;
}
.pgr-upload-zone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.4rem; padding: 1.5rem 1rem; text-align: center; cursor: pointer;
  border: 1px dashed var(--color-border, #cbd5e1); border-radius: 0.75rem;
  background: var(--color-surface-secondary, #f8fafc);
  transition: border-color .15s ease, background .15s ease;
}
.pgr-upload-zone--empty { padding: 2rem 1rem; }
.pgr-upload-zone--cell { border-radius: 0.5rem; padding: 1rem; }
.pgr-upload-zone:hover, .pgr-upload-zone:focus-visible, .pgr-upload-zone.is-dragover {
  outline: none;
  border-color: var(--color-primary-1, var(--color-primary-main, #c84c0e));
  background: var(--color-primary-1-bg, #eef6ef);
}
.pgr-upload-cloud { color: var(--color-text-secondary, #94a3b8); display: inline-flex; }
.pgr-upload-dnd { font-size: 0.85rem; color: var(--color-text-secondary, #64748b); }
.pgr-upload-choose {
  display: inline-block; border: 1px solid var(--color-border, #cbd5e1); border-radius: 0.375rem;
  padding: 0.4rem 0.9rem; background: #fff; font-weight: 600; font-size: 0.85rem;
  color: var(--color-primary-1, var(--color-primary-main, #c84c0e));
}
.pgr-upload-hint { margin: 0.25rem 0 0; font-size: 0.72rem; color: var(--color-text-secondary, #94a3b8); }
.pgr-upload-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.75rem; align-items: stretch; }
.pgr-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--color-border, #e2e8f0); border-radius: 0.5rem;
  padding: 0.5rem; background: #fff;
}
.pgr-card-img {
  position: relative; flex: 1 1 auto; min-height: 4.5rem; border-radius: 0.375rem; overflow: hidden;
  background: var(--color-surface-secondary, #f1f5f9);
}
.pgr-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pgr-card-doc { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary, #64748b); }
.pgr-badge {
  position: absolute; top: 6px; left: 6px; width: 20px; height: 20px; border-radius: 9999px;
  background: var(--color-primary-1, var(--color-primary-main, #c84c0e)); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.pgr-del {
  position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border: none; border-radius: 9999px;
  background: #fff; color: #475569; font-size: 15px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.25);
}
.pgr-del:hover { background: #b3261e; color: #fff; }
.pgr-card-name {
  font-size: 0.78rem; font-weight: 600; margin-top: 0.35rem; color: var(--color-text, #1f2937);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pgr-card-meta { display: flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: var(--color-text-secondary, #64748b); }
.pgr-card-ok { color: var(--color-primary-1, var(--color-primary-main, #c84c0e)); display: inline-flex; }
@media (max-width: 480px) {
  .pgr-upload-row { grid-template-columns: repeat(2, 1fr); }
}
/* Compact variant — for constrained containers (the workflow-action modal):
   smaller drop-zone and small preview tiles so the section never balloons
   the popup. */
.pgr-upload--compact .pgr-upload-zone--empty { padding: 0.9rem 0.75rem; gap: 0.25rem; }
.pgr-upload--compact .pgr-upload-zone--cell { padding: 0.5rem; border-radius: 0.375rem; }
.pgr-upload--compact .pgr-upload-cloud svg { width: 22px; height: 22px; }
.pgr-upload--compact .pgr-upload-dnd { font-size: 0.78rem; }
.pgr-upload--compact .pgr-upload-choose { padding: 0.25rem 0.7rem; font-size: 0.78rem; }
.pgr-upload--compact .pgr-upload-hint { font-size: 0.68rem; margin-top: 0.1rem; }
.pgr-upload--compact .pgr-upload-row { grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr)); gap: 0.5rem; }
.pgr-upload--compact .pgr-card { padding: 0.35rem; }
.pgr-upload--compact .pgr-card-img { min-height: 3rem; max-height: 4rem; }
.pgr-upload--compact .pgr-card-name { font-size: 0.68rem; margin-top: 0.25rem; }
.pgr-upload--compact .pgr-card-meta { font-size: 0.62rem; }
.pgr-upload--compact .pgr-badge, .pgr-upload--compact .pgr-del { width: 16px; height: 16px; }
/* In the compact filled state the inline "add more" cell keeps only the icon
   + button — repeating the drag hint + format text made the cell taller than
   the preview tiles and cramped the popup. */
.pgr-upload--compact .pgr-upload-zone--cell .pgr-upload-dnd,
.pgr-upload--compact .pgr-upload-zone--cell .pgr-upload-hint { display: none; }
`;

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = UPLOAD_CSS;
  document.head.appendChild(el);
}

const PgrFileUpload = ({ t, tenantId, value, onSelect, fieldKey, accept = DEFAULT_ACCEPT, maxFiles = 5, hint, compact = false }) => {
  ensureStyles();
  const [items, setItems] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [error, setError] = React.useState("");
  const inputRef = React.useRef(null);

  // Rebuild previews for ids that arrive from outside (session-restored form
  // values). Best-effort — the ids are valid for submit regardless.
  React.useEffect(() => {
    const have = new Set(items.map((i) => i.id));
    const missing = (value || []).filter((id) => !have.has(id));
    if (missing.length === 0) {
      if (items.some((i) => !(value || []).includes(i.id))) {
        setItems((prev) => prev.filter((i) => (value || []).includes(i.id)));
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await Digit.UploadServices.Filefetch(missing, tenantId);
        if (cancelled) return;
        const d = res?.data || {};
        const byId = {};
        (Array.isArray(d.fileStoreIds) ? d.fileStoreIds : []).forEach((o) => {
          if (o && o.id) byId[o.id] = o.url;
        });
        const rebuilt = missing.map((id) => {
          const raw = byId[id] != null ? byId[id] : (typeof d[id] === "string" ? d[id] : "");
          const url = typeof raw === "string" ? raw.split(",").pop() || "" : "";
          return { id, url, name: tr(t, "CS_UPLOADED_FILE", "Attachment"), size: 0 };
        });
        setItems((prev) => [...prev, ...rebuilt]);
      } catch (e) {
        /* preview rebuild is best-effort; ids still submit */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value || []), tenantId]);

  const emit = (next) => {
    setItems(next);
    onSelect(fieldKey, next.map((i) => i.id));
  };

  const uploadFiles = async (files) => {
    setError("");
    const room = maxFiles - items.length;
    if (room <= 0) {
      setError(tr(t, "CS_UPLOAD_MAX_FILES", `You can upload up to ${maxFiles} files.`));
      return;
    }
    const accepted = [];
    for (const f of files.slice(0, room)) {
      if (f.size > MAX_BYTES) {
        setError(tr(t, "CS_FILE_TOO_LARGE", "File is too large (max 5 MB)."));
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length === 0) return;
    setBusy(true);
    const uploaded = [];
    for (const file of accepted) {
      try {
        const response = await Digit.UploadServices.Filestorage("property-upload", file, tenantId);
        const id = response?.data?.files?.[0]?.fileStoreId;
        if (id) {
          uploaded.push({
            id,
            url: file.type && file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
            name: file.name,
            size: file.size,
          });
        }
      } catch (err) {
        const apiMessage =
          err?.response?.data?.Errors?.[0]?.message ||
          err?.response?.data?.message ||
          err?.message;
        setError(apiMessage || tr(t, "CS_FILE_UPLOAD_FAILED", "File upload failed."));
      }
    }
    setBusy(false);
    if (uploaded.length) emit([...items, ...uploaded]);
  };

  const onInputChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) uploadFiles(files);
    if (inputRef.current) inputRef.current.value = ""; // allow re-picking same file
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  };
  const removeAt = (id) => {
    const gone = items.find((i) => i.id === id);
    if (gone?.url?.startsWith("blob:")) URL.revokeObjectURL(gone.url);
    emit(items.filter((i) => i.id !== id));
  };
  const openPicker = () => inputRef.current && inputRef.current.click();
  const atMax = items.length >= maxFiles;

  const renderCue = (variant) => (
    <div
      className={"pgr-upload-zone " + variant + (dragOver ? " is-dragover" : "")}
      role="button"
      tabIndex={0}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <span className="pgr-upload-cloud">{CloudIcon}</span>
      <div className="pgr-upload-dnd">{tr(t, "CS_UPLOAD_DND", "Drag and drop files here or")}</div>
      <span className="pgr-upload-choose">
        {busy ? tr(t, "CS_UPLOADING", "Uploading…") : tr(t, "CS_UPLOAD_CHOOSE", "Choose files")}
      </span>
      <p className="pgr-upload-hint">
        {hint || tr(t, "CS_UPLOAD_HINT", `Images, PDF, DOC, audio or video up to 5 MB each. You can upload up to ${maxFiles} files.`)}
      </p>
    </div>
  );

  return (
    <div className={"pgr-upload" + (compact ? " pgr-upload--compact" : "")}>
      {error ? (
        <div className="pgr-upload-error" role="alert">
          {error}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={onInputChange}
        // NOT display:none — some Android WebViews refuse to open the file
        // chooser for programmatic clicks on display:none inputs.
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          overflow: "hidden",
          border: 0,
          padding: 0,
          margin: -1,
          clip: "rect(0 0 0 0)",
          pointerEvents: "none",
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      {items.length === 0 ? (
        renderCue("pgr-upload-zone--empty")
      ) : (
        <div className="pgr-upload-row">
          {items.map((it) => (
            <div className="pgr-card" key={it.id}>
              <div className="pgr-card-img">
                <span className="pgr-badge">{CheckIcon}</span>
                <button
                  type="button"
                  className="pgr-del"
                  aria-label={tr(t, "CS_REMOVE", "Remove")}
                  onClick={() => removeAt(it.id)}
                >
                  {XIcon}
                </button>
                {it.url ? (
                  <img src={it.url} alt={it.name} />
                ) : (
                  <div className="pgr-card-doc">{DocIcon}</div>
                )}
              </div>
              <div className="pgr-card-name" title={it.name}>
                {it.name}
              </div>
              <div className="pgr-card-meta">
                {it.size ? <span>{fmtSize(it.size)}</span> : null}
                <span className="pgr-card-ok">{CheckIcon}</span>
              </div>
            </div>
          ))}
          {!atMax ? renderCue("pgr-upload-zone--cell") : null}
        </div>
      )}
    </div>
  );
};

export default PgrFileUpload;
