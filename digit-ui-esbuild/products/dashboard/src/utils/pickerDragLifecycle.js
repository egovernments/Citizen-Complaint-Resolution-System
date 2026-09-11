/**
 * pickerDragLifecycle — pure bookkeeping for one Add-KPI picker drag.
 *
 * react-grid-layout 1.3.4 has NO cancel path for external drags. Its dropping
 * state — droppingDOMNode, the __dropping-elem__ entry in state.layout, the
 * dragEnterCounter, and (once the synthetic GridItem drag engages) activeDrag —
 * is only ever cleaned by a drop on the grid or by dragleave events balancing
 * the counter back to 0. A drag that ENGAGES the grid and then ends anywhere
 * else — released over the header/picker, cancelled with ESC, or exiting after
 * a dragenter leaked because the hovered DOM node was replaced mid-drag (chart
 * redraws do this constantly) — leaves activeDrag set forever. From then on
 * RGL's getDerivedStateFromProps returns null on every prop change, so each
 * subsequent add (drop OR click) persists to storage but never renders: the
 * "drop does not attach" + collapsed-grid + chart-thrash state reproduced on
 * bomet for #1287.
 *
 * The tracker answers exactly one question at dragend: does the grid need a
 * synthetic drop dispatched at it so RGL runs its own onDrop cleanup path
 * (dragEnterCounter = 0 + removeDroppingPlaceholder)? Kept pure/instantiable
 * so the decision table is unit-testable under node --test.
 */
export function createPickerDragLifecycle() {
  let active = false; // a picker drag is in flight
  let engaged = false; // at least one dragover reached the grid (RGL state exists)
  let dropped = false; // the grid's onDrop ran (RGL cleaned itself up)

  return {
    /** dragstart on a picker item. */
    start() {
      active = true;
      engaged = false;
      dropped = false;
    },
    /** RGL onDropDragOver tick — its dropping state now exists. */
    gridDragOver() {
      if (active) engaged = true;
    },
    /** RGL onDrop ran — it has already cleaned its dropping state. */
    gridDrop() {
      dropped = true;
    },
    /**
     * dragend on the picker item (fires after drop when there was one).
     * Returns whether RGL was left holding dropping state that only a
     * synthetic drop can clear. Resets for the next drag either way.
     */
    end() {
      const needsSyntheticCleanup = active && engaged && !dropped;
      active = false;
      engaged = false;
      dropped = false;
      return { needsSyntheticCleanup };
    },
    /** Introspection for tests. */
    peek() {
      return { active, engaged, dropped };
    },
  };
}

export default createPickerDragLifecycle;
