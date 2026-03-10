"use client"

import * as React from "react"
import { Pencil, Check, X } from "lucide-react"
import { cn } from "../lib/utils"
import { Input } from "../primitives/input"
import { Button } from "../primitives/button"
import { Switch } from "../primitives/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../primitives/select"
import type { EditableCellType, ValidationRule } from "../columns/types"

export interface EditableCellProps {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  type?: EditableCellType;
  validation?: ValidationRule;
  options?: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
  initialEditing?: boolean;
  disableAutofocus?: boolean;
  onCancel?: () => void;
}

export const validationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\d{10}$/,
  code: /^[A-Z0-9_]+$/,
  alphanumeric: /^[a-zA-Z0-9]+$/,
};

export const commonValidations = {
  required: { required: true } as ValidationRule,
  email: { required: true, pattern: validationPatterns.email, patternMessage: 'Enter a valid email address' } as ValidationRule,
  phone: { required: true, pattern: validationPatterns.phone, patternMessage: 'Enter a 10-digit phone number' } as ValidationRule,
  code: { required: true, pattern: validationPatterns.code, patternMessage: 'Only uppercase letters, numbers, and underscores' } as ValidationRule,
  name: { required: true, minLength: 2, maxLength: 100 } as ValidationRule,
};

function validateValue(value: string, validation?: ValidationRule): string | null {
  if (!validation) return null;

  if (validation.required && !value.trim()) {
    return 'This field is required';
  }

  if (validation.minLength && value.length < validation.minLength) {
    return `Minimum length is ${validation.minLength}`;
  }

  if (validation.maxLength && value.length > validation.maxLength) {
    return `Maximum length is ${validation.maxLength}`;
  }

  if (validation.pattern && !validation.pattern.test(value)) {
    return validation.patternMessage || 'Invalid format';
  }

  if (validation.custom) {
    return validation.custom(value);
  }

  return null;
}

export function EditableCell({
  value,
  onSave,
  type = 'text',
  validation,
  options,
  placeholder,
  disabled = false,
  className,
  displayClassName,
  inputClassName,
  initialEditing = false,
  disableAutofocus = false,
  onCancel,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = React.useState(initialEditing);
  const [editValue, setEditValue] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const blurTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    setEditValue(value);
  }, [value]);

  React.useEffect(() => {
    if (isEditing && !disableAutofocus && inputRef.current && (type === 'text' || type === 'number' || type === 'date')) {
      inputRef.current.focus();
    }
  }, [isEditing, disableAutofocus, type]);

  const handleSave = React.useCallback(async () => {
    // Validate before saving
    const validationError = validateValue(editValue, validation);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    await onSave(editValue);
    setIsEditing(false);
  }, [editValue, validation, onSave]);

  const handleCancel = React.useCallback(() => {
    setEditValue(value);
    setError(null);
    setIsEditing(false);
    onCancel?.();
  }, [value, onCancel]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  const handleBlur = React.useCallback(() => {
    // Delay blur to allow button clicks to register
    blurTimeoutRef.current = setTimeout(() => {
      handleCancel();
    }, 150);
  }, [handleCancel]);

  const handleFocus = React.useCallback(() => {
    // Clear blur timeout if input regains focus
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  const handleButtonMouseDown = React.useCallback((e: React.MouseEvent) => {
    // Prevent blur from firing when clicking buttons
    e.preventDefault();
  }, []);

  React.useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  // Boolean type: render switch, saves immediately
  if (type === 'boolean') {
    return (
      <div className={cn("flex items-center", className)}>
        <Switch
          checked={value === 'true' || value === '1'}
          onCheckedChange={(checked) => {
            onSave(checked ? 'true' : 'false');
          }}
          disabled={disabled}
          className={inputClassName}
        />
      </div>
    );
  }

  // Select type: render select dropdown, saves on selection
  if (type === 'select') {
    if (!options || options.length === 0) {
      return <span className={cn("text-muted-foreground", displayClassName)}>No options</span>;
    }

    return (
      <Select
        value={value}
        onValueChange={(newValue) => {
          onSave(newValue);
        }}
        disabled={disabled}
      >
        <SelectTrigger className={cn("h-9", inputClassName)}>
          <SelectValue placeholder={placeholder || "Select..."} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Disabled: render static value
  if (disabled) {
    return (
      <span className={cn("text-sm", displayClassName, className)}>
        {value || placeholder || '—'}
      </span>
    );
  }

  // Display mode: show value with hover pencil icon
  if (!isEditing) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className={cn(
          "group flex items-center gap-2 text-sm hover:text-primary transition-colors",
          displayClassName,
          className
        )}
      >
        <span>{value || placeholder || '—'}</span>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      </button>
    );
  }

  // Edit mode for text/number/date/reference types
  const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'reference' ? 'text' : 'text';

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type={inputType}
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholder={placeholder}
          className={cn("h-9", inputClassName)}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 text-green-600 hover:text-green-700 hover:bg-green-50"
          onMouseDown={handleButtonMouseDown}
          onClick={handleSave}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 text-red-600 hover:text-red-700 hover:bg-red-50"
          onMouseDown={handleButtonMouseDown}
          onClick={handleCancel}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error && (
        <span className="text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
