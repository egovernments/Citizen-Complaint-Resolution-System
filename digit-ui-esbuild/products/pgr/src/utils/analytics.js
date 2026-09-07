// Thin, always-safe bridge to the analytics shim (public/analytics.js) plus
// the PGR event catalogue — the ONE place that defines what we track and how
// it is named. Components never call window.DigitAnalytics directly.
//
// The shim is loaded by index.html outside the bundle and may be absent
// (older served bundle, script blocked, analytics disabled) — product code
// must never assume it exists, and a tracking call must never throw into a
// render or a submit handler.
//
// NAMING — one style only (mirrors Matomo's Category / Action / Name):
//   Category: PascalCase noun    — Complaint, Authentication, Navigation,
//                                  Search, Error, Attachment, Workflow
//   Action:   PascalCase outcome — Started, Selected, Submitted, Created,
//                                  Failed, Cancelled, Clicked, Opened,
//                                  Completed, Added, Removed, Rated, Reopened,
//                                  NoResults, ValidationError, ApiError,
//                                  NetworkError, PermissionDenied
//   Name:     short technical detail (a code, a reason, a status bucket).
//
// PII: the shim scrubs every argument again, but callers still must not pass
// identity — no names, no phone numbers, no complaint ids, no user-entered
// text, no tokens. Complaint TYPE codes and HTTP statuses are fine.

/** The catalogue. Add here first; never inline ad-hoc category/action pairs. */
export const EV = {
  // Citizen complaint lifecycle (steps themselves are tracked as real page
  // views — /create-complaint/{complaint-type|location|details} — so there is
  // deliberately NO per-step "reached" event; these are intents and outcomes).
  COMPLAINT_STARTED: { category: "Complaint", action: "Started" },
  COMPLAINT_TYPE_SELECTED: { category: "Complaint", action: "Selected" }, // name: "Type:<code>"
  COMPLAINT_LOCATION_SELECTED: { category: "Complaint", action: "Selected" }, // name: "Location"
  COMPLAINT_SUBMITTED: { category: "Complaint", action: "Submitted" }, // submit clicked, payload valid
  COMPLAINT_CREATED: { category: "Complaint", action: "Created" }, // conversion point (Matomo goal)
  COMPLAINT_FAILED: { category: "Complaint", action: "Failed" }, // name: "Api:<status>" | "Network"
  COMPLAINT_CANCELLED: { category: "Complaint", action: "Cancelled" }, // explicit Back out of step 1
  COMPLAINT_RATED: { category: "Complaint", action: "Rated" }, // value: stars 1-5
  COMPLAINT_REOPENED: { category: "Complaint", action: "Reopened" },

  // Attachments (evidence photos/videos). Never the filename.
  ATTACHMENT_ADDED: { category: "Attachment", action: "Added" }, // name: "<kind>:<sizeBucket>"
  ATTACHMENT_REMOVED: { category: "Attachment", action: "Removed" }, // name: "<kind>"
  ATTACHMENT_FAILED: { category: "Attachment", action: "Failed" }, // name: "TooLarge" | "Api:<status>" | "Network"

  // Employee workflow actions on a complaint.
  WORKFLOW_OPENED: { category: "Workflow", action: "Opened" }, // name: action code
  WORKFLOW_COMPLETED: { category: "Workflow", action: "Completed" },
  WORKFLOW_FAILED: { category: "Workflow", action: "Failed" },

  // Employee inbox search.
  SEARCH_STARTED: { category: "Search", action: "Started" }, // name: "PgrInbox"
  SEARCH_NO_RESULTS: { category: "Search", action: "NoResults" },

  // Failures that explain WHY users don't complete a task.
  VALIDATION_ERROR: { category: "Error", action: "ValidationError" }, // name: reason, e.g. "LocationRequired"
  API_ERROR: { category: "Error", action: "ApiError" }, // name: "<source>:<status>"
  NETWORK_ERROR: { category: "Error", action: "NetworkError" }, // name: "<source>"
  PERMISSION_DENIED: { category: "Error", action: "PermissionDenied" }, // name: "<source>:<status>"
};

/** Track a catalogue event. `name` is the Matomo event Name (short technical
 *  detail, never user-entered text); `value` an optional number. */
export function trackE(event, name, value) {
  try {
    if (!event || !event.category || !event.action) return;
    window?.DigitAnalytics?.trackEvent?.(`${event.category}.${event.action}`, {
      category: event.category,
      action: event.action,
      label: name || "",
      value: typeof value === "number" ? value : undefined,
    });
  } catch (e) {
    /* analytics must never break the page */
  }
}

/** Classify and track a failed API call. Sends only the source label and the
 *  HTTP status — never the response body, never request payloads. */
export function trackApiError(source, err) {
  try {
    const status = err?.response?.status || err?.status;
    if (!status) return trackE(EV.NETWORK_ERROR, source);
    if (status === 401 || status === 403) return trackE(EV.PERMISSION_DENIED, `${source}:${status}`);
    return trackE(EV.API_ERROR, `${source}:${status}`);
  } catch (e) {
    /* analytics must never break the page */
  }
}

/** "Api:<status>" | "Network" — the safe failure detail for outcome events. */
export function failureName(err) {
  const status = err?.response?.status || err?.status;
  return status ? `Api:${status}` : "Network";
}

/** Bucketed file size — coarse on purpose (an exact size is fingerprintable). */
export function sizeBucket(bytes) {
  if (!(bytes >= 0)) return "unknown";
  if (bytes < 512 * 1024) return "lt500KB";
  if (bytes < 1024 * 1024) return "500KB-1MB";
  if (bytes < 2 * 1024 * 1024) return "1-2MB";
  if (bytes < 5 * 1024 * 1024) return "2-5MB";
  return "gt5MB";
}

/** Virtual pageview for screens the router never sees (e.g. the /response
 *  outcome states). Prefer a real route where one exists. */
export function trackPage(virtualPath, title) {
  try {
    window?.DigitAnalytics?.trackPageView?.(virtualPath, title);
  } catch (e) {
    /* analytics must never break the page */
  }
}

/** Low-level escape hatch — prefer trackE with a catalogue entry. Kept for
 *  compatibility with earlier call sites. */
export function trackEvent(name, props) {
  try {
    window?.DigitAnalytics?.trackEvent?.(name, props);
  } catch (e) {
    /* analytics must never break the page */
  }
}
