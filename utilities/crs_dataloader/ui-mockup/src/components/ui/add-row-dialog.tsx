import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Plus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ValidationRule } from './editable-cell';

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'number' | 'select';
  placeholder?: string;
  required?: boolean;
  validation?: ValidationRule;
  options?: { value: string; label: string }[]; // For select type
  defaultValue?: string;
}

interface AddRowDialogProps {
  title: string;
  description?: string;
  fields: FormField[];
  onSubmit: (data: Record<string, string>) => Promise<void> | void;
  trigger?: React.ReactNode;
  submitLabel?: string;
}

export function AddRowDialog({
  title,
  description,
  fields,
  onSubmit,
  trigger,
  submitLabel = 'Add',
}: AddRowDialogProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    fields.forEach((f) => {
      initial[f.name] = f.defaultValue || '';
    });
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetForm = () => {
    const initial: Record<string, string> = {};
    fields.forEach((f) => {
      initial[f.name] = f.defaultValue || '';
    });
    setFormData(initial);
    setErrors({});
    setSubmitError(null);
  };

  const validate = (field: FormField, value: string): string | null => {
    if (field.required && !value.trim()) {
      return `${field.label} is required`;
    }

    const v = field.validation;
    if (!v) return null;

    if (v.minLength && value.length < v.minLength) {
      return `Minimum ${v.minLength} characters required`;
    }

    if (v.maxLength && value.length > v.maxLength) {
      return `Maximum ${v.maxLength} characters allowed`;
    }

    if (v.pattern && !v.pattern.test(value)) {
      return v.patternMessage || 'Invalid format';
    }

    if (v.custom) {
      return v.custom(value);
    }

    return null;
  };

  const validateAll = (): boolean => {
    const newErrors: Record<string, string> = {};
    let hasErrors = false;

    fields.forEach((field) => {
      const error = validate(field, formData[field.name] || '');
      if (error) {
        newErrors[field.name] = error;
        hasErrors = true;
      }
    });

    setErrors(newErrors);
    return !hasErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateAll()) return;

    setSubmitting(true);
    try {
      await onSubmit(formData);
      setOpen(false);
      resetForm();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            {submitLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {fields.map((field) => (
              <div key={field.name} className="grid gap-2">
                <Label htmlFor={field.name} className="flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-destructive">*</span>}
                </Label>
                {field.type === 'select' ? (
                  <select
                    id={field.name}
                    value={formData[field.name]}
                    onChange={(e) => {
                      setFormData((prev) => ({ ...prev, [field.name]: e.target.value }));
                      setErrors((prev) => ({ ...prev, [field.name]: '' }));
                    }}
                    className={cn(
                      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      errors[field.name] && 'border-destructive'
                    )}
                  >
                    <option value="">Select {field.label}</option>
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={field.name}
                    type={field.type || 'text'}
                    placeholder={field.placeholder}
                    value={formData[field.name]}
                    onChange={(e) => {
                      setFormData((prev) => ({ ...prev, [field.name]: e.target.value }));
                      setErrors((prev) => ({ ...prev, [field.name]: '' }));
                    }}
                    className={cn(errors[field.name] && 'border-destructive')}
                  />
                )}
                {errors[field.name] && (
                  <span className="text-xs text-destructive">{errors[field.name]}</span>
                )}
              </div>
            ))}
          </div>

          {submitError && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md mb-4">
              {submitError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
