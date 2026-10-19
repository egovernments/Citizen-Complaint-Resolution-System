import "@testing-library/jest-dom/vitest";

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
