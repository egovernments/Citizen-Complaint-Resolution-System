import * as React from "react";
import { cn } from "../../lib/cn";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { Button } from "./button";

export interface UploadedFile {
  /** Local object URL for preview. */
  url: string;
  /** Original File reference; consumer can re-upload if needed. */
  file: File;
  /** Server-assigned id once upload completes. */
  uploadedId?: string;
}

export interface FileUploadProps {
  files: UploadedFile[];
  onAdd: (newFiles: File[]) => void;
  onRemove: (index: number) => void;
  /** When true, the picker is in "uploading" state. */
  uploading?: boolean;
  accept?: string;
  /** Max files allowed. */
  maxFiles?: number;
  /** Hint shown under the dropzone. */
  hint?: React.ReactNode;
  className?: string;
}

/**
 * Drag-and-drop or tap-to-upload file picker with thumbnail strip.
 * Designed for the SelectImages step — accepts images by default, capped at 5.
 */
export function FileUpload({
  files,
  onAdd,
  onRemove,
  uploading,
  accept = "image/*",
  maxFiles = 5,
  hint,
  className,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const remaining = Math.max(0, maxFiles - files.length);

  function handlePick(filesPicked: FileList | null) {
    if (!filesPicked) return;
    const list = Array.from(filesPicked).slice(0, remaining);
    if (list.length) onAdd(list);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handlePick(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
          "hover:border-primary/60 hover:bg-primary/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          dragOver ? "border-primary bg-primary/10" : "border-border bg-background",
          remaining === 0 && "cursor-not-allowed opacity-60 hover:border-border hover:bg-background"
        )}
        aria-disabled={remaining === 0 || uploading}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          disabled={remaining === 0 || uploading}
          onChange={(e) => {
            handlePick(e.target.files);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Upload className="h-5 w-5" aria-hidden />
        </span>
        <div className="text-sm font-medium text-foreground">
          {uploading ? "Uploading…" : remaining > 0 ? "Tap to upload or drop a file" : "Limit reached"}
        </div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        <div className="text-xs text-muted-foreground">
          {files.length}/{maxFiles} files
        </div>
      </div>

      {files.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((f, i) => (
            <div
              key={f.url + i}
              className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
            >
              {f.file.type.startsWith("image/") ? (
                // Object-URL thumbnails — released by the consumer when the
                // step unmounts (URL.revokeObjectURL).
                <img src={f.url} alt={f.file.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              <Button
                variant="destructive"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7 rounded-full shadow"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${f.file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
