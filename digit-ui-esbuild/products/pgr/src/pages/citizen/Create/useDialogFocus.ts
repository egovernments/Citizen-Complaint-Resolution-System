// Focus handling for the filing flow's modal sheets (the voice recorder and
// the photo source picker): focus moves into the sheet when it opens, Tab and
// Shift+Tab stay inside it, and focus returns to whatever opened it on close.

import * as React from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hidden);
}

/**
 * @param open   whether the sheet is showing
 * @param sheet  the dialog element (give it tabIndex={-1} so it can hold focus
 *               itself while it has no actions)
 * @param focusKey  changes when the sheet swaps its actions (recording, then
 *               ready): focus moves to the first action again, because the
 *               one that had it is no longer in the document
 */
export function useDialogFocus(open: boolean, sheet: React.RefObject<HTMLElement>, focusKey?: unknown) {
  React.useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      const root = sheet.current;
      if (event.key !== "Tab" || !root) return;
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, sheet]);

  React.useEffect(() => {
    const root = sheet.current;
    if (!open || !root) return;
    const [first] = focusables(root);
    (first || root).focus();
  }, [open, sheet, focusKey]);
}
