/**
 * Where the working-context panel opens: right-aligned under the header pill,
 * or centred when the trigger is the full-width mobile row, where aligning to
 * either edge strands it in a corner. The pill's width follows its text, so a
 * long translation ("Condado de Bomet · 1 departamento · 1 função") must not
 * read as the mobile row: only a trigger wider than half the viewport is.
 * Clamped so the panel never leaves the viewport.
 */
export function workingContextPanelLeft(trigger, viewportWidth, panelWidth) {
  const spansBar = trigger.width > viewportWidth / 2;
  const preferred = spansBar ? (viewportWidth - panelWidth) / 2 : trigger.right - panelWidth;
  return Math.max(8, Math.min(preferred, viewportWidth - panelWidth - 8));
}
