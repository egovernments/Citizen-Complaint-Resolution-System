import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Upload, File, X } from 'lucide-react';

interface BulkUploadProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
}

const BulkUpload: React.FC<BulkUploadProps> = ({
  onFilesSelected,
  accept = '.xlsx,.xls,.csv',
  multiple = false,
  className,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      const newFiles = multiple ? droppedFiles : [droppedFiles[0]];
      setFiles(newFiles);
      onFilesSelected(newFiles);
    },
    [multiple, onFilesSelected]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const selectedFiles = Array.from(e.target.files);
        const newFiles = multiple ? selectedFiles : [selectedFiles[0]];
        setFiles(newFiles);
        onFilesSelected(newFiles);
      }
    },
    [multiple, onFilesSelected]
  );

  const handleRemoveFile = useCallback(
    (index: number) => {
      const newFiles = files.filter((_, i) => i !== index);
      setFiles(newFiles);
      onFilesSelected(newFiles);
    },
    [files, onFilesSelected]
  );

  return (
    <div className={cn('space-y-4', className)}>
      {files.length === 0 ? (
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <input
            id="file-upload"
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={handleFileChange}
            className="hidden"
          />
          <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            Drag & Drop or{' '}
            <span className="text-primary font-medium cursor-pointer">
              Browse Files
            </span>
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Supported formats: XLS, XLSX, CSV
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-muted rounded border border-border"
            >
              <div className="flex items-center gap-3">
                <File className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium truncate max-w-[200px] sm:max-w-none">
                  {file.name}
                </span>
              </div>
              <button
                onClick={() => handleRemoveFile(index)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export { BulkUpload };
