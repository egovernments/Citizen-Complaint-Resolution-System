import { useState } from 'react';
import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, X } from 'lucide-react';

interface RegexInputProps extends InputProps {
  label?: string;
  help?: string;
}

/** Regex pattern field with a live sample tester below it.
 *  Form value is the pattern string. Sample text is local-only (not persisted). */
export function RegexInput({ label, help, ...inputProps }: RegexInputProps) {
  const { id, field, fieldState, isRequired } = useInput(inputProps);
  const [sample, setSample] = useState('');
  const pattern = typeof field.value === 'string' ? field.value : '';

  let regex: RegExp | null = null;
  let compileError: string | null = null;
  try {
    regex = pattern ? new RegExp(pattern) : null;
  } catch (e) {
    compileError = e instanceof Error ? e.message : 'invalid regex';
  }
  const matches = regex && sample ? regex.test(sample) : null;
  const hasError = fieldState.invalid && fieldState.isTouched;

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <Input
        id={id}
        type="text"
        placeholder="^[0-9]{10}$"
        value={pattern}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        className={`font-mono ${hasError || compileError ? 'border-destructive' : ''}`}
      />
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
      {compileError && <p className="mt-1 text-xs text-destructive">Regex error: {compileError}</p>}
      <div className="mt-2 flex items-center gap-2">
        <Input
          type="text"
          placeholder="test a sample..."
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          className="flex-1"
          aria-label="sample text to test against pattern"
        />
        {matches === true && <Check className="w-4 h-4 text-success" aria-label="matches" />}
        {matches === false && <X className="w-4 h-4 text-destructive" aria-label="does not match" />}
      </div>
    </div>
  );
}
