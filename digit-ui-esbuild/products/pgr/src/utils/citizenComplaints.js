// The citizen's My Complaints inbox: which complaints a search keeps, in what
// order, and which page of them shows. Rows are plain objects the page builds
// from its search results, already labelled:
//   { id, concern, category, description, createdTime, ... }

/** A complaint's status tone: still open, closed with a resolution, or rejected. */
const CLOSED_STATUSES = ["RESOLVED", "REJECTED", "CLOSEDAFTERREJECTION", "CLOSEDAFTERRESOLUTION"];
const REJECTED_STATUSES = ["REJECTED", "CLOSEDAFTERREJECTION"];

export function statusTone(status) {
  if (REJECTED_STATUSES.includes(status)) return "rejected";
  if (CLOSED_STATUSES.includes(status)) return "closed";
  return "open";
}

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether a row matches the search: its complaint number, or text in its
 * description, subcategory (the Concern) or category. Every word of the
 * query has to appear somewhere, in any order; an empty query keeps all.
 */
export function matchesComplaintQuery(row, query) {
  const words = normalize(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize([row?.id, row?.concern, row?.category, row?.description].join(" "));
  return words.every((word) => haystack.includes(word));
}

/** The rows a search keeps, newest first. */
export function searchComplaints(rows, query) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => matchesComplaintQuery(row, query))
    .sort((a, b) => (b?.createdTime || 0) - (a?.createdTime || 0));
}

/**
 * One page of rows, with the page clamped into range so a search that leaves
 * fewer pages never shows an empty one. Pages are 1-based.
 */
export function pageOf(rows, page, size) {
  const list = Array.isArray(rows) ? rows : [];
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, page || 1), pages);
  const start = (current - 1) * size;
  return { rows: list.slice(start, start + size), page: current, pages, from: list.length ? start + 1 : 0, to: Math.min(start + size, list.length), total: list.length };
}
