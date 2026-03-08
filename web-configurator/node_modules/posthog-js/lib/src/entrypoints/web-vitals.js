"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var globals_1 = require("../utils/globals");
var web_vitals_1 = require("web-vitals");
var attribution_1 = require("web-vitals/attribution");
var loadCallbacks = function (useAttribution) {
    if (useAttribution === void 0) { useAttribution = true; }
    var postHogWebVitalsCallbacks = useAttribution
        ? {
            onLCP: attribution_1.onLCP,
            onCLS: attribution_1.onCLS,
            onFCP: attribution_1.onFCP,
            onINP: attribution_1.onINP,
        }
        : {
            onLCP: web_vitals_1.onLCP,
            onCLS: web_vitals_1.onCLS,
            onFCP: web_vitals_1.onFCP,
            onINP: web_vitals_1.onINP,
        };
    globals_1.assignableWindow.__PosthogExtensions__ = globals_1.assignableWindow.__PosthogExtensions__ || {};
    globals_1.assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks;
    // we used to put posthogWebVitalsCallbacks on window, and now we put it on __PosthogExtensions__
    // but that means that old clients which lazily load this extension are looking in the wrong place
    // yuck,
    // so we also put it directly on the window
    // when 1.161.1 is the oldest version seen in production we can remove this
    globals_1.assignableWindow.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks;
    return postHogWebVitalsCallbacks;
};
globals_1.assignableWindow.__PosthogExtensions__ = globals_1.assignableWindow.__PosthogExtensions__ || {};
globals_1.assignableWindow.__PosthogExtensions__.loadWebVitalsCallbacks = loadCallbacks;
exports.default = loadCallbacks;
//# sourceMappingURL=web-vitals.js.map