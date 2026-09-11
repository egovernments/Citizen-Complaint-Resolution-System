import { useCallback, useEffect, useRef } from "react";

const SCROLL_IDLE_MS = 700;
export const SUBTLE_SCROLL_ACTIVE_CLASS = "dashboard-subtle-scroll--active";

/**
 * Adds a transient class while the element is scrolling so scrollbar chrome can fade in/out.
 */
export default function useSubtleScrollbar(enabled = true) {
  const cleanupRef = useRef(null);

  const setRef = useCallback(
    (node) => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      if (!enabled || !node) return;

      let timer;
      const onScroll = () => {
        node.classList.add(SUBTLE_SCROLL_ACTIVE_CLASS);
        clearTimeout(timer);
        timer = setTimeout(() => {
          node.classList.remove(SUBTLE_SCROLL_ACTIVE_CLASS);
        }, SCROLL_IDLE_MS);
      };

      node.addEventListener("scroll", onScroll, { passive: true });
      cleanupRef.current = () => {
        node.removeEventListener("scroll", onScroll);
        clearTimeout(timer);
        node.classList.remove(SUBTLE_SCROLL_ACTIVE_CLASS);
      };
    },
    [enabled]
  );

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    []
  );

  return setRef;
}
