import { useState, useEffect, useRef } from 'react';
import { Input } from './input';
import { Button } from './button';
import { Check, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  custom?: (value: string) => string | null; // Returns error message or null
}

export interface EditableCellProps {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  validation?: ValidationRule;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
  type?: 'text' | 'email' | 'tel' | 'number';
  initialEditing?: boolean;
}

export function EditableCell({
  value,
  onSave,
  validation,
  placeholder = 'Click to edit',
  disabled = false,
  className,
  displayClassName,
  inputClassName,
  type = 'text',
  initialEditing = false,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [editValue, setEditValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const validate = (val: string): string | null => {
    if (!validation) return null;

    if (validation.required && !val.trim()) {
      return 'This field is required';
    }

    if (validation.minLength && val.length < validation.minLength) {
      return `Minimum ${validation.minLength} characters required`;
    }

    if (validation.maxLength && val.length > validation.maxLength) {
      return `Maximum ${validation.maxLength} characters allowed`;
    }

    if (validation.pattern && !validation.pattern.test(val)) {
      return validation.patternMessage || 'Invalid format';
    }

    if (validation.custom) {
      return validation.custom(val);
    }

    return null;
  };

  const handleSave = async () => {
    const validationError = validate(editValue);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onSave(editValue);
      setIsEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (disabled) {
    return <span className={cn('text-muted-foreground', className)}>{value || '-'}</span>;
  }

  if (isEditing) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            type={type}
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Delay to allow button clicks
              setTimeout(() => {
                if (!saving) handleCancel();
              }, 150);
            }}
            className={cn('h-8 text-sm', error && 'border-destructive', inputClassName)}
            disabled={saving}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
            onClick={handleSave}
            disabled={saving}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={handleCancel}
            disabled={saving}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className={cn(
        'group flex items-center gap-1 text-left hover:bg-muted/50 rounded px-1 -mx-1 transition-colors',
        displayClassName
      )}
    >
      <span className={value ? '' : 'text-muted-foreground italic'}>{value || placeholder}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// Common validation patterns
export const validationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\d{10}$/,
  code: /^[A-Z0-9_]+$/,
  alphanumeric: /^[a-zA-Z0-9]+$/,
};

export const commonValidations = {
  required: { required: true } as ValidationRule,
  email: {
    required: true,
    pattern: validationPatterns.email,
    patternMessage: 'Enter a valid email address',
  } as ValidationRule,
  phone: {
    required: true,
    pattern: validationPatterns.phone,
    patternMessage: 'Enter a 10-digit phone number',
  } as ValidationRule,
  code: {
    required: true,
    pattern: validationPatterns.code,
    patternMessage: 'Only uppercase letters, numbers, and underscores allowed',
  } as ValidationRule,
  name: {
    required: true,
    minLength: 2,
    maxLength: 100,
  } as ValidationRule,
};
