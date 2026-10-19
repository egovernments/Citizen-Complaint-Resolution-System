/**
 * The red asterisk after a required field's label, as the management console's
 * form widgets draw it. Decorative only: the control itself carries
 * `aria-required` (or `required`), so a screen reader says "required" rather
 * than "star".
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive" data-required-mark="">
      *
    </span>
  );
}
