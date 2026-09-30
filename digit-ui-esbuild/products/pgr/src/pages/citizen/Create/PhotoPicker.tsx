/* eslint-disable @typescript-eslint/no-explicit-any */
// Complaint photos, as in the #2038 design: a sheet with "Take a photo" and
// "Choose from gallery" on a phone, a click-or-drop zone on desktop, and a
// list of what is attached with Remove.
//
// Uploads go to filestore the way ImageUploadHandler sends them
// ("property-upload", the complaint's tenant). Its 2 MB ceiling stays, but a
// phone camera's photo is usually over it, so larger images are scaled down
// in the browser first rather than refused.

import * as React from "react";
import { Button } from "@egovernments/digit-ui-components-v2";
import { useDialogFocus } from "./useDialogFocus";
import { trackEvent } from "../../../utils/analytics";

declare const Digit: any;

export const MAX_PHOTOS = 5;
/** What a citizen may pick. Anything over the upload ceiling is scaled down. */
export const MAX_PICK_BYTES = 5 * 1024 * 1024;
/** filestore's ceiling for this module, as ImageUploadHandler enforces it. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export interface PickedPhoto {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
  status: "uploading" | "done" | "failed";
  fileStoreId?: string;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/**
 * Fit a photo under the upload ceiling: longest side down to 1920px, then
 * JPEG quality down in steps. Files already under the ceiling pass through.
 */
async function fitForUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const img = await loadImage(file);
  const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  // JPEG has no transparency: a transparent PNG (a screenshot) would come out
  // with a black background, so it is laid on white first.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.75, 0.65, 0.55]) {
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) {
      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
    }
  }
  return file;
}

const CameraGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);
const ImageGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </svg>
);
const RetryGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
);
const UploadGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);

interface PhotoPickerProps {
  photos: PickedPhoto[];
  onChange: (updater: (prev: PickedPhoto[]) => PickedPhoto[]) => void;
  tenantId: string;
  tr: (key: string, fallback: string) => string;
}

export function PhotoPicker({ photos, onChange, tenantId, tr }: PhotoPickerProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const galleryRef = React.useRef<HTMLInputElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  // The picked files, kept so a failed upload can be retried.
  const filesRef = React.useRef(new Map<string, File>());
  // For revoking the previews when the picker goes away.
  const photosRef = React.useRef(photos);
  photosRef.current = photos;
  const full = photos.length >= MAX_PHOTOS;
  useDialogFocus(sheetOpen, sheetRef);

  React.useEffect(
    () => () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    },
    []
  );

  React.useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const upload = React.useCallback(
    async (photo: PickedPhoto, file: File) => {
      try {
        const ready = await fitForUpload(file);
        const response = await Digit.UploadServices.Filestorage("property-upload", ready, tenantId);
        const fileStoreId = response?.data?.files?.[0]?.fileStoreId;
        if (!fileStoreId) throw new Error("no fileStoreId");
        trackEvent("pgr.file-complaint.photo.uploaded", { category: "pgr", label: ready === file ? "original" : "scaled" });
        // Named as uploaded: a scaled photo went up as a .jpg.
        onChange((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, status: "done", fileStoreId, size: ready.size, name: ready.name } : p))
        );
      } catch {
        trackEvent("pgr.file-complaint.photo.upload-failed", { category: "pgr" });
        onChange((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: "failed" } : p)));
      }
    },
    [onChange, tenantId]
  );

  const addFiles = (list: FileList | null) => {
    setNotice(null);
    const files = Array.from(list || []);
    const room = MAX_PHOTOS - photos.length;
    const accepted: File[] = [];
    for (const file of files) {
      if (!/^image\/(jpeg|png|jpg)$/i.test(file.type)) {
        setNotice(tr("CS_PHOTO_TYPE", "Only JPG or PNG photos can be attached."));
        trackEvent("pgr.file-complaint.photo.rejected", { category: "pgr", label: "type" });
        continue;
      }
      if (file.size > MAX_PICK_BYTES) {
        setNotice(tr("CS_PHOTO_TOO_LARGE", "That photo is over 5 MB. Choose a smaller one."));
        trackEvent("pgr.file-complaint.photo.rejected", { category: "pgr", label: "size" });
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > room) {
      setNotice(tr("CS_PHOTO_LIMIT", `You can attach up to ${MAX_PHOTOS} photos.`));
      trackEvent("pgr.file-complaint.photo.rejected", { category: "pgr", label: "limit" });
    }
    const picked = accepted.slice(0, Math.max(0, room)).map((file) => ({
      file,
      photo: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
        status: "uploading" as const,
      },
    }));
    if (picked.length === 0) return;
    onChange((prev) => [...prev, ...picked.map((p) => p.photo)]);
    picked.forEach(({ photo, file }) => {
      filesRef.current.set(photo.id, file);
      upload(photo, file);
    });
  };

  const retry = (photo: PickedPhoto) => {
    const file = filesRef.current.get(photo.id);
    if (!file) return;
    onChange((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: "uploading" } : p)));
    upload(photo, file);
  };

  const remove = (id: string) => {
    onChange((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      filesRef.current.delete(id);
      return prev.filter((p) => p.id !== id);
    });
  };

  const onInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files);
    // Picking the same file again must still fire change.
    event.target.value = "";
    setSheetOpen(false);
  };

  return (
    <div className="cms-photos">
      <input ref={cameraRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={onInput} />
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={onInput} />

      {/* Phone: one button, then the choice of camera or gallery. */}
      <Button
        variant="outline"
        width="full"
        className="cms-photo-button"
        disabled={full}
        leading={<CameraGlyph />}
        onClick={() => setSheetOpen(true)}
        data-analytics-event="pgr.file-complaint.photo.open"
      >
        {tr("CS_ADDCOMPLAINT_UPLOAD_PHOTO", "Upload photo")}
      </Button>

      {/* Desktop: click or drop. */}
      <div
        className={`cms-drop${dragging ? " dragging" : ""}${full ? " disabled" : ""}`}
        role="button"
        tabIndex={full ? -1 : 0}
        aria-disabled={full}
        data-analytics-event="pgr.file-complaint.photo.browse"
        onClick={() => !full && galleryRef.current?.click()}
        onKeyDown={(event) => {
          if (!full && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            galleryRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!full) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (full) return;
          // A drop is no click, so the shim cannot see it.
          trackEvent("pgr.file-complaint.photo.dropped", { category: "pgr", value: event.dataTransfer.files?.length || 0 });
          addFiles(event.dataTransfer.files);
        }}
      >
        <span className="cms-drop-icon">
          <UploadGlyph />
        </span>
        <span className="cms-drop-label">{tr("CS_PHOTO_DROP", "Click to upload or drag and drop a photo")}</span>
        <span className="cms-drop-hint">
          {tr("CS_PHOTO_RULES", `JPG or PNG, up to 5 MB each, ${MAX_PHOTOS} at most`)}
        </span>
      </div>

      {notice ? (
        <p className="cms-field-error" role="alert">
          {notice}
        </p>
      ) : null}

      {photos.length > 0 ? (
        <ul className="cms-photo-list">
          {photos.map((photo) => (
            <li key={photo.id} className="cms-photo-row">
              <img className="cms-photo-thumb" src={photo.previewUrl} alt="" />
              <span className="cms-photo-meta">
                <span className="cms-photo-name">{photo.name}</span>
                <span className={`cms-photo-status ${photo.status}`}>
                  {photo.status === "uploading"
                    ? tr("CS_PHOTO_UPLOADING", "Uploading…")
                    : photo.status === "failed"
                    ? tr("CS_PHOTO_FAILED", "Upload failed")
                    : formatSize(photo.size)}
                </span>
              </span>
              {photo.status === "failed" ? (
                <button
                  type="button"
                  className="cms-link-button cms-retry"
                  onClick={() => retry(photo)}
                  data-analytics-event="pgr.file-complaint.photo.retry"
                >
                  <RetryGlyph />
                  {tr("CS_COMMON_RETRY", "Retry")}
                </button>
              ) : null}
              <button
                type="button"
                className="cms-link-button"
                onClick={() => remove(photo.id)}
                data-analytics-event="pgr.file-complaint.photo.remove"
              >
                {tr("CS_COMMON_REMOVE", "Remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {sheetOpen ? (
        <div className="cms-sheet-overlay" onMouseDown={(event) => event.target === event.currentTarget && setSheetOpen(false)}>
          <div ref={sheetRef} tabIndex={-1} className="cms-sheet cms-photo-sheet" role="dialog" aria-modal="true" aria-labelledby="cms-photo-title">
            <h2 id="cms-photo-title" className="cms-sheet-head">
              {tr("CS_PHOTO_SHEET_TITLE", "Upload a photo")}
            </h2>
            <div className="cms-sheet-options">
              <button
                type="button"
                className="cms-sheet-option"
                onClick={() => cameraRef.current?.click()}
                data-analytics-event="pgr.file-complaint.photo.camera"
              >
                <CameraGlyph />
                {tr("CS_PHOTO_TAKE", "Take a photo")}
              </button>
              <button
                type="button"
                className="cms-sheet-option"
                onClick={() => galleryRef.current?.click()}
                data-analytics-event="pgr.file-complaint.photo.gallery"
              >
                <ImageGlyph />
                {tr("CS_PHOTO_GALLERY", "Choose from gallery")}
              </button>
            </div>
            <Button
              variant="ghost"
              width="full"
              className="cms-sheet-cancel"
              onClick={() => setSheetOpen(false)}
              data-analytics-event="pgr.file-complaint.photo.cancel"
            >
              {tr("CS_COMMON_CANCEL", "Cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
