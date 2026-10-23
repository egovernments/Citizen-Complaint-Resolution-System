import { useFormContext, useFormState, type Control } from 'react-hook-form';

interface FieldStateLike { invalid: boolean; isTouched?: boolean; isDirty?: boolean }

/** isSubmitted of the surrounding form; false outside one (an input rendered alone, e.g. in a unit test). */
function useSubmitted(control: Control | undefined): boolean {
  // The branch is fixed for a component's lifetime (an input is inside a form or it is not), so the hook order is stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return control ? useFormState({ control }).isSubmitted : false;
}

/**
 * When a field shows its validation error. Touched or changed, as before - and also once the
 * form has been submitted: a blank Create used to refuse silently (nothing touched, so no field said it was required;
 * the click only moved the focus).
 */
export function useShowFieldError(fieldState: FieldStateLike): boolean {
  const isSubmitted = useSubmitted(useFormContext()?.control);
  return fieldState.invalid && (!!fieldState.isTouched || !!fieldState.isDirty || isSubmitted);
}
