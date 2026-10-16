/**
 * How far to scroll a scroll box so that a menu opened inside it shows: just
 * enough to bring the menu's bottom edge in, never so far that its top edge
 * leaves. Both are viewport boxes ({ top, bottom }); 0 when it already fits.
 */
export const revealOffset = (scroller, menu) => {
  const below = menu.bottom - scroller.bottom;
  if (below <= 0) return 0;
  return Math.max(0, Math.min(below, menu.top - scroller.top));
};

/**
 * Watches `root` for dropdown menus opening inside the scroll box matched by
 * `scrollerSelector` and scrolls each into view. The dropdowns draw their
 * menus in place (absolutely positioned), so one opened near the bottom of
 * the box was cut off by it. Returns the disconnect.
 */
export const revealMenusIn = (root, scrollerSelector) => {
  if (!root || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver((records) => {
    const scroller = root.querySelector(scrollerSelector);
    if (!scroller) return;
    for (const { addedNodes } of records) {
      for (const node of addedNodes) {
        if (node.nodeType !== 1 || !scroller.contains(node)) continue;
        const menu = [node, ...node.querySelectorAll("*")].find((el) => getComputedStyle(el).position === "absolute");
        if (!menu) continue;
        scroller.scrollTop += revealOffset(scroller.getBoundingClientRect(), menu.getBoundingClientRect());
        return;
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
};
