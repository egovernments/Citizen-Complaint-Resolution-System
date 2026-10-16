import { useFormState } from 'react-hook-form';

interface FieldStateLike { invalid: boolean; isTouched?: boolean; isDirty?: boolean }

/**
 * When a field shows its validation error. Touched or changed, as before - and also once the
 * form has been submitted: a blank Create used to refuse silently (nothing touched, so no field said it was required;
 * the click only moved the focus).
 */
export function useShowFieldError(fieldState: FieldStateLike): boolean {
  const { isSubmitted } = useFormState();
  return fieldState.invalid && (!!fieldState.isTouched || !!fieldState.isDirty || isSubmitted);
}
