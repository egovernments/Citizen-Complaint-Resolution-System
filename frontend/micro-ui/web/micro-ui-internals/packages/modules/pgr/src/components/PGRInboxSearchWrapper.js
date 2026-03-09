import React, { useEffect, useRef } from "react";
import { InboxSearchComposer } from "@egovernments/digit-ui-components";

/**
 * PGRInboxSearchWrapper - Wrapper component for InboxSearchComposer
 *
 * Purpose:
 * This wrapper adds auto-search functionality when the "Clear Search" button is clicked.
 * Without this wrapper, users need to click twice:
 *   1st click: Clear the text fields
 *   2nd click: Clear the search results
 *
 * With this wrapper, a single click on "Clear Search" will:
 *   1. Clear all text fields
 *   2. Automatically trigger a search with empty criteria (showing all results)
 *
 * Implementation:
 * - Listens for clicks on the secondary button (Clear Search)
 * - After fields are cleared, automatically clicks the search button
 * - Uses a small delay (100ms) to ensure form clears before searching
 */
const PGRInboxSearchWrapper = ({ configs }) => {
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClearButtonClick = (event) => {
      // Check if the clicked element is the clear/secondary button
      const target = event.target;
      const button = target.closest('button');

      if (!button) return;

      // The clear button is styled with variation="teritiary" and contains the secondary label text
      // Check if this is the secondary/clear button by looking for specific characteristics
      const isSecondaryButton =
        button.getAttribute('variation') === 'teritiary' ||
        button.className?.includes('tertiary') ||
        button.className?.includes('secondary');

      if (isSecondaryButton) {
        // Small delay to allow the form to clear first, then click search twice
        setTimeout(() => {
          // Find the primary search button
          const searchButton = wrapperRef.current?.querySelector(
            'button[type="submit"]'
          );

          if (searchButton) {
            // First click
            searchButton.click();

            // Second click after a short delay
            setTimeout(() => {
              searchButton.click();
            }, 150);
          }
        }, 100);
      }
    };

    const wrapper = wrapperRef.current;
    if (wrapper) {
      wrapper.addEventListener('click', handleClearButtonClick);
    }

    return () => {
      if (wrapper) {
        wrapper.removeEventListener('click', handleClearButtonClick);
      }
    };
  }, []);

  return (
    <div ref={wrapperRef} className="pgr-inbox-search-wrapper-enhanced">
      <InboxSearchComposer configs={configs} />
    </div>
  );
};

export default PGRInboxSearchWrapper;
