import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// The first render of a lazy page in a file pays for its module transform; on a
// loaded machine that runs past the 1 s default and fails the wait, not the page.
configure({ asyncUtilTimeout: 5000 });

// The node-environment test files (palette drift, page coverage) share this
// setup file and have no `window`.
if (typeof window !== "undefined" && window.matchMedia === undefined) {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false
        })
    });
}
