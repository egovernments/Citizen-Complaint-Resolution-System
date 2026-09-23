// Credential inputs rendered straight from a catalog entry's `credentialFields`.
// Shared by "Add provider" and "Rotate credentials" so both forms are identical.
//
// Values live only in the caller's local state and are dropped when the dialog
// closes: nothing is written to localStorage or any persistent store, and the
// bridge never returns a stored credential, so there is nothing to prefill.
import { useTranslate } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  credLabelKey,
  type CatalogCredentialField,
  type CredentialValues,
} from './providerCatalog';

export function ProviderCredentialFields({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: CatalogCredentialField[];
  values: CredentialValues;
  onChange: (key: string, value: string | boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslate();

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('app.providers.cred_none', { _: 'This provider needs no credentials.' })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((f) => {
        const label = t(credLabelKey(f.key), { _: f.label });
        return (
          <div key={f.key} className="space-y-1.5">
            {f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={values[f.key] === true}
                  disabled={disabled}
                  onChange={(e) => onChange(f.key, e.target.checked)}
                />
                {label}
              </label>
            ) : (
              <>
                <Label htmlFor={`cred-${f.key}`}>
                  {label}
                  {f.required && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  id={`cred-${f.key}`}
                  type={f.type}
                  autoComplete="off"
                  disabled={disabled}
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              </>
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
