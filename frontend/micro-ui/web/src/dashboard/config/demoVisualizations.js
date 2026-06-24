/**
 * Legacy demo visualizations — all replaced by live analytics widgets.
 * Kept for saved-layout migration helpers only.
 */

export const DEMO_VIZ_WIDGETS = [];

export const DEMO_VIZ_IDS = new Set();

export function isDemoVizWidget() {
  return false;
}

export function isDemoTableWidget() {
  return false;
}

export function hasCustomChrome() {
  return false;
}

export const DEMO_VIZ_DATA = {};

export const DEMO_VIZ_LAYOUT_DEFAULTS = {};

export const DEMO_VIZ_DEFAULT_LAYOUT = [];
