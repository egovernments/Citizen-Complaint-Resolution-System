// Offline complaint receipt (PDF) for the citizen surface.
//
// Drawn as structured jsPDF text rather than a DOM raster. `Digit.Download.PDF`
// exists but rasterises an on-screen node with dom-to-image and actually saves
// a `.jpeg` (Download.js) — it needs an attached, laid-out element, so it would
// capture whatever the viewport happened to be showing, mobile truncation and
// all. A receipt has to be generatable from the complaint object alone, at any
// viewport, with selectable text.
//
// jspdf is already unconditionally bundled (packages/libraries imports it for
// Download.js), so this adds no download weight for citizens on slow links.
//
// LOCALIZATION: every string routes through the caller's `tr(key, fallback)` so
// an unseeded key renders readable English instead of a raw CS_ token. That is
// not theoretical here — none of the reused row-label keys are seeded in pt_PT
// today, and pt is the live default on Maputo.
//
// PII: deliberately excludes the timeline, employee names and
// createdBy/lastModifiedBy — a PDF is far more forwardable than a screen, and
// the citizen detail page already hides employee contacts (QA #19).
//
// It DOES carry the complainant's own name, contact and address: this is the
// citizen's own complaint and the receipt is for them. On a CONFIDENTIAL
// complaint those rows are masked to "****" (see CONFIDENTIAL_MASK), matching
// the employee detail page's CCSD-2130 rule, so identity never reaches a
// document that can be forwarded.

import { jsPDF } from "jspdf";

import { complaintLabel, COMPLAINT_LABEL_PREFIX } from "./complaintLabel";

const PAGE_W = 210;
const MARGIN_L = 15;
const MARGIN_T = 15;
const CONTENT_W = 180;
const CONTENT_X1 = 195;
const FOOTER_RULE_Y = 277;
// Body must stop clear of the footer rule, else long content prints over it.
const CONTENT_LIMIT_Y = 271;
const CONTINUATION_TOP_Y = 23;

const LABEL_W = 58;
const VALUE_X = 77;
const VALUE_W = 118;

// jsPDF places the BASELINE at y. Its line height is fontSize * getLineHeightFactor(),
// and the factor is 1.15 by default; 0.3528 converts pt to mm.
const LH = (pt) => pt * 0.3528 * 1.15;

const COLOR = {
  accent: "#C84C0E",
  bandBg: "#FBEEE8",
  rule: "#D6D5D4",
  label: "#505A5F",
  value: "#363636",
  strong: "#0B0C0C",
  muted: "#787878",
};

// Mirrors ComplaintDetails' StatusPill tones so a printed receipt and the screen
// can't drift apart on what "closed" looks like.
const REJECTED_STATUSES = ["REJECTED", "CLOSEDAFTERREJECTION", "CANCELLED"];
const CLOSED_STATUSES = ["RESOLVED", "REJECTED", "CLOSEDAFTERREJECTION", "CLOSEDAFTERRESOLUTION", "CANCELLED"];
const TONES = {
  open: { bg: "#FFF4D7", fg: "#9E5F00", word: "Open" },
  closed: { bg: "#E8F3EE", fg: "#00703C", word: "Closed" },
  rejected: { bg: "#FAE5E2", fg: "#D4351C", word: "Rejected" },
};
const toneOf = (status) => {
  if (REJECTED_STATUSES.includes(status)) return "rejected";
  if (CLOSED_STATUSES.includes(status)) return "closed";
  return "open";
};

// Every value passes through here. splitTextToSize(null) returns the literal
// ["null"] rather than throwing, so without this gate a half-populated complaint
// prints the word "null" onto an official document.
const S = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (Array.isArray(v)) return v.map(S).filter(Boolean).join(", ");
  if (typeof v === "object") return S(v.code ?? v.name ?? "");
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "null" || s === "undefined" ? "" : s;
};

// Em dash reads as "no data"; an empty cell reads as a rendering fault.
const DASH = "—";

// Same sentinel the backend and the employee detail page use for masked values.
const CONFIDENTIAL_MASK = "****";

const isBlank = (s) => !S(s);

export const RECEIPT_FALLBACKS = {
  downloadLabel: "Download Receipt",
  nextTitle: "What happens next",
  nextTrack: "Keep this complaint number — you need it to ask about your complaint.",
  nextUpdate: "You can track the status any time under My Complaints.",
  nextHelpline: "Helpline",
  complainantTitle: "Complainant Details",
  complainantName: "Complainant Name",
  complainantContact: "Contact Number",
  errorLabel: "Could not generate the receipt. Please try again.",
  title: "Complaint Receipt",
  classification: "Classification",
  systemGenerated: "This is a system-generated document and does not require a signature.",
  generatedOn: "Generated on",
  municipality: "Municipality",
};

// English fallbacks for the reused detail-row label keys. These keys exist in
// en_IN but not pt_PT, so without a fallback a Portuguese receipt would print
// the raw key. Reproduced verbatim including the three real typos in the
// source keys (ADDTIONAL, LANDMARK__DETAILS, the employee-prefixed ES_).
const ROW_LABEL_FALLBACKS = {
  CS_COMPLAINT_DETAILS_COMPLAINT_NO: "Complaint No.",
  CS_COMPLAINT_DETAILS_APPLICATION_STATUS: "Status",
  CS_ADDCOMPLAINT_COMPLAINT_TYPE: "Complaint Type",
  CS_ADDCOMPLAINT_COMPLAINT_SUB_TYPE: "Complaint Sub Type",
  CS_COMPLAINT_ADDTIONAL_DETAILS: "Additional Details",
  CS_COMPLAINT_FILED_DATE: "Filed Date",
  CS_COMPLAINT_LANDMARK__DETAILS: "Landmark",
  ES_CREATECOMPLAINT_ADDRESS: "Address",
  CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS: "Complaint Details",
  CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS: "Additional Details",
};

// "CS_COMPLAINT_FILED_DATE" -> "Filed Date": last-resort label for a key we
// don't know and that isn't seeded, so a row is never labelled with a raw token.
const prettifyKey = (key) =>
  String(key || "")
    .replace(/^(CS|ES|CORE|PGR)_/, "")
    .replace(/^(COMPLAINT_DETAILS|ADDCOMPLAINT|CREATECOMPLAINT|COMPLAINT)_/, "")
    .replace(/_+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Read a tenant brand colour off the live CSS custom properties so the receipt
 * follows per-tenant MDMS branding instead of pinning one municipality's orange.
 * A PDF has no CSS cascade, so the value has to be resolved to a literal here.
 */
const brandAccent = () => {
  try {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-primary-2")
      .trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : COLOR.accent;
  } catch (e) {
    return COLOR.accent;
  }
};

/**
 * Fetch the tenant logo as a data URI.
 *
 * Deliberately NOT addImage(url) — jsPDF resolves a remote URL with a synchronous
 * XHR and throws on a cross-origin filestore — and NOT canvas.toDataURL, which
 * taints on a cross-origin image and raises SecurityError. fetch + FileReader
 * fails cleanly instead, and the caller then omits the logo and reflows.
 */
export const fetchLogoDataUri = async (url, { timeoutMs = 4000 } = {}) => {
  if (!url || typeof fetch !== "function") return null;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { signal: controller?.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\/(png|jpe?g)$/i.test(blob.type || "")) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Render the receipt.
 *
 * Accepts a PARTIAL model on purpose: the success screen has only the created
 * ServiceWrapper (no details map, no classification, no boundary chain), so it
 * degrades to a shorter document rather than firing MDMS/boundary fetches that
 * would break the offline guarantee.
 */
export const buildComplaintReceipt = ({
  service,
  details,
  classification,
  extendedRows,
  tenantName,
  logoDataUri,
  generatedOn,
  helpline,
  t,
  tr,
}) => {
  const translate = typeof t === "function" ? t : (k) => k;
  const label = typeof tr === "function" ? tr : (k, fb) => fb;
  const accent = brandAccent();

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const setFont = (size, style, color) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  const wrap = (txt, w, size, style) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    const s = S(txt);
    if (!s) return [];
    // Width <= 0 makes splitTextToSize degenerate to one character per line.
    return doc.splitTextToSize(s, Math.max(10, w));
  };
  const widthOf = (txt, size, style) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    return doc.getTextWidth(S(txt));
  };
  const rule = (y) => {
    doc.setDrawColor(COLOR.rule);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_L, y, CONTENT_X1, y);
  };
  const ensure = (h, y) => {
    if (y + h > CONTENT_LIMIT_Y) {
      doc.addPage();
      return CONTINUATION_TOP_Y;
    }
    return y;
  };

  let y = MARGIN_T;

  // --- accent bar + letterhead (page 1) ---
  doc.setFillColor(accent);
  doc.rect(0, 0, PAGE_W, 3, "F");

  let textX = MARGIN_L;
  let textW = CONTENT_W;
  if (logoDataUri) {
    try {
      doc.addImage(logoDataUri, MARGIN_L, MARGIN_T, 22, 22, undefined, "FAST");
      textX = MARGIN_L + 26;
      textW = CONTENT_W - 26;
    } catch (e) {
      // Unreadable/undecodable image: fall through with the full-width layout.
      textX = MARGIN_L;
      textW = CONTENT_W;
    }
  }

  const LOGO_H = 22;
  const nameLines = wrap(tenantName || label("CS_COMMON_CITY", RECEIPT_FALLBACKS.municipality), textW, 13, "bold").slice(0, 2);
  // Vertically centre the name block against the logo, so a one-line name sits
  // on the logo's midline instead of floating at its top edge.
  const nameH = nameLines.length * LH(13);
  const nameTop = logoDataUri ? MARGIN_T + Math.max(0, (LOGO_H - nameH) / 2) : MARGIN_T;
  setFont(13, "bold", COLOR.strong);
  nameLines.forEach((ln, i) => doc.text(ln, textX, nameTop + 4.6 + i * LH(13)));
  const nameBottom = nameTop + nameH;
  y = Math.max(nameBottom, logoDataUri ? MARGIN_T + LOGO_H : nameBottom) + 6;

  // --- document title ---
  const titleLines = wrap(label("PGR_RECEIPT_TITLE", RECEIPT_FALLBACKS.title), CONTENT_W, 16, "bold").slice(0, 2);
  setFont(16, "bold", accent);
  titleLines.forEach((ln, i) => doc.text(ln, MARGIN_L, y + 5.6 + i * LH(16)));
  y += titleLines.length * LH(16) + 5;

  // --- complaint id band: the one thing a citizen quotes at a counter ---
  const complaintId = S(service?.serviceRequestId);
  const status = S(service?.applicationStatus);
  if (complaintId) {
    const bandH = 16;
    doc.setFillColor(COLOR.bandBg);
    doc.rect(MARGIN_L, y, CONTENT_W, bandH, "F");
    doc.setFillColor(accent);
    doc.rect(MARGIN_L, y, 1.5, bandH, "F");

    setFont(8.5, "normal", COLOR.label);
    doc.text(
      S(label("CS_COMPLAINT_DETAILS_COMPLAINT_NO", ROW_LABEL_FALLBACKS.CS_COMPLAINT_DETAILS_COMPLAINT_NO)).toUpperCase(),
      MARGIN_L + 4,
      y + 5.5
    );

    // The ID is one unbreakable token, so it must shrink rather than wrap.
    let idSize = 17;
    const idBudget = CONTENT_W - 8 - (status ? CONTENT_W / 2 : 0);
    while (idSize > 10 && widthOf(complaintId, idSize, "bold") > idBudget) idSize -= 0.5;
    setFont(idSize, "bold", COLOR.strong);
    doc.text(complaintId, MARGIN_L + 4, y + 12.5);

    // Status sits inside the band, vertically centred on the right: it
    // describes the identifier next to it, and on its own line it read as a
    // stray chip floating between sections.
    if (status) {
      const tone = TONES[toneOf(status)];
      const pillText = S(label(`CS_COMMON_${status}`, tone.word));
      let pillSize = 9;
      // The ID needs room to shrink into, so bound the pill to half the band.
      const maxPillW = CONTENT_W / 2;
      while (pillSize > 7 && widthOf(pillText, pillSize, "bold") + 10 > maxPillW) pillSize -= 0.5;
      const pillW = Math.min(widthOf(pillText, pillSize, "bold") + 10, maxPillW);
      const pillH = 7;
      const px = CONTENT_X1 - 4 - pillW;
      doc.setFillColor(tone.bg);
      doc.roundedRect(px, y + (bandH - pillH) / 2, pillW, pillH, 3.5, 3.5, "F");
      setFont(pillSize, "bold", tone.fg);
      doc.text(pillText, px + 5, y + (bandH - pillH) / 2 + 4.8);
    }
    y += bandH + 7;
  }

  // --- section + row primitives ---
  const heading = (text) => {
    // Reserve the heading AND a minimum first row, so a heading can never be
    // the last thing on a page with its rows orphaned overleaf.
    y = ensure(LH(11) + 7 + 11, y);
    const lines = wrap(text, CONTENT_W, 11, "bold").slice(0, 1);
    if (!lines.length) return;
    setFont(11, "bold", accent);
    doc.text(lines[0], MARGIN_L, y + 4);
    rule(y + 6.2);
    y += LH(11) + 5.5;
  };

  // Usable height on a fresh page. A block taller than this can never be made to
  // fit by starting a new page, so it must flow line by line instead.
  const PAGE_BODY_H = CONTENT_LIMIT_Y - CONTINUATION_TOP_Y;

  const row = (labelText, valueText) => {
    const labelLines = wrap(labelText, LABEL_W, 9.5, "normal");
    let valueLines = wrap(valueText, VALUE_W, 10, "normal");
    if (!valueLines.length) valueLines = [DASH];
    const rowH = Math.max(labelLines.length * LH(9.5), valueLines.length * LH(10)) + 3.2;

    // A pathological value (e.g. a pasted address blob) can exceed a whole page.
    // ensure() only moves to a fresh page once, so drawing it as one block would
    // run through the footer and off the sheet — flow it instead, keeping the
    // label on the first page and continuing the value across pages.
    if (rowH > PAGE_BODY_H) {
      y = ensure(LH(9.5) + LH(10), y);
      setFont(9.5, "normal", COLOR.label);
      labelLines.forEach((ln, i) => doc.text(ln, MARGIN_L, y + 3.4 + i * LH(9.5)));
      y += labelLines.length * LH(9.5);
      for (const ln of valueLines) {
        y = ensure(LH(10), y);
        setFont(10, "normal", COLOR.value);
        doc.text(ln, VALUE_X, y + 3.4);
        y += LH(10);
      }
      y += 3;
      rule(y);
      y += 2.5;
      return;
    }

    y = ensure(rowH + 2.5, y);
    setFont(9.5, "normal", COLOR.label);
    labelLines.forEach((ln, i) => doc.text(ln, MARGIN_L, y + 3.4 + i * LH(9.5)));
    setFont(10, "normal", COLOR.value);
    valueLines.forEach((ln, i) => doc.text(ln, VALUE_X, y + 3.4 + i * LH(10)));
    rule(y + rowH);
    y += rowH + 2.5;
  };

  // Long free text spans the full width, emitted one line at a time so an
  // unbounded description flows across pages instead of forcing an oversized
  // single block (which could never fit and would loop).
  const textBlock = (labelText, valueText) => {
    const value = S(valueText);
    if (!value) return;
    y = ensure(LH(9.5) + LH(10) + 5, y);
    setFont(9.5, "normal", COLOR.label);
    doc.text(S(labelText), MARGIN_L, y + 3.4);
    y += LH(9.5) + 1.5;
    const lines = wrap(value, CONTENT_W, 10, "normal");
    setFont(10, "normal", COLOR.value);
    for (const ln of lines) {
      y = ensure(LH(10), y);
      setFont(10, "normal", COLOR.value);
      doc.text(ln, MARGIN_L, y + 3.4);
      y += LH(10);
    }
    y += 3;
    rule(y);
    y += 2.5;
  };

  // --- what happens next: the receipt's job for a first-time filer is to say
  // what this number is for and where to look next. Static text, so it always
  // renders even on a complaint with almost no data.
  const guidance = [
    S(label("PGR_RECEIPT_NEXT_TRACK", RECEIPT_FALLBACKS.nextTrack)),
    S(label("PGR_RECEIPT_NEXT_UPDATE", RECEIPT_FALLBACKS.nextUpdate)),
    helpline ? `${S(label("CS_COMMON_HELPLINE", RECEIPT_FALLBACKS.nextHelpline))}: ${helpline}` : "",
  ].filter(Boolean);
  if (guidance.length) {
    heading(label("PGR_RECEIPT_NEXT_TITLE", RECEIPT_FALLBACKS.nextTitle));
    setFont(10, "normal", COLOR.value);
    for (const g of guidance) {
      const lines = wrap(`•  ${g}`, CONTENT_W, 10, "normal");
      for (const ln of lines) {
        y = ensure(LH(10), y);
        setFont(10, "normal", COLOR.value);
        doc.text(ln, MARGIN_L, y + 3.4);
        y += LH(10);
      }
      y += 1.2;
    }
    y += 2.5;
  }

  // --- classification (only when the tenant runs a hierarchy) ---
  const hasClassification = Array.isArray(classification) && classification.length > 0;
  if (hasClassification) {
    heading(label("PGR_RECEIPT_CLASSIFICATION", RECEIPT_FALLBACKS.classification));
    classification.forEach((r) => row(S(r?.label), S(r?.value)));
  }

  // --- complaint details ---
  // Iterate the map the detail page renders rather than a hardcoded key list, so
  // a tenant Customizations override stays in parity with the screen.
  // Values in the details map are themselves localization keys. t() echoes an
  // unseeded key back, so each family needs its own readable fallback or the
  // receipt prints a raw CS_/COMPLAINT_HIERARCHY token on a document a citizen
  // hands to an official.
  const resolveValue = (raw) => {
    const s = S(raw);
    if (!s) return "";
    if (s.startsWith(COMPLAINT_LABEL_PREFIX)) {
      // complaintLabel falls back to the MDMS node name, then the bare code.
      return S(complaintLabel(translate, s.slice(COMPLAINT_LABEL_PREFIX.length)));
    }
    const translated = S(translate(s));
    if (translated && translated !== s) return translated;
    if (s.startsWith("CS_COMMON_")) {
      // Same tone vocabulary the pill uses, so the two can't disagree.
      const bare = s.slice("CS_COMMON_".length);
      if (bare === "null" || bare === "undefined") return "";
      return TONES[toneOf(bare)].word;
    }
    // Not a key at all (free text, a date, an id) - print it as-is.
    return s;
  };

  // CCSD-2130: the backend masks extendedAttributes on a confidential complaint
  // but NOT service.citizen, which pgr-services enriches from egov-user. The
  // address row is composed partly from citizen.correspondenceAddress, so it has
  // to be masked here alongside the name/contact rows.
  const isConfidential = service?.extendedAttributes?.isConfidential === true;
  const maskIfConfidential = (v) => (isConfidential ? CONFIDENTIAL_MASK : S(v));
  const CITIZEN_DERIVED_KEYS = new Set(["ES_CREATECOMPLAINT_ADDRESS"]);

  const detailKeys = details && typeof details === "object" ? Object.keys(details) : [];
  // When the hierarchy renders, its levels replace the flat type rows. Matched by
  // KEY, never by comparing translated label text — the on-screen version compares
  // English strings and so duplicates these rows under pt_MZ.
  const FLAT_TYPE_KEYS = new Set(["CS_ADDCOMPLAINT_COMPLAINT_TYPE", "CS_ADDCOMPLAINT_COMPLAINT_SUB_TYPE"]);
  const shownKeys = detailKeys.filter((k) => !(hasClassification && FLAT_TYPE_KEYS.has(k)));
  // Description gets its own full-width block below.
  const DESC_KEY = "CS_COMPLAINT_ADDTIONAL_DETAILS";

  if (shownKeys.length) {
    heading(label("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS", ROW_LABEL_FALLBACKS.CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS));
    shownKeys
      .filter((k) => k !== DESC_KEY)
      .forEach((k) => {
        const raw = details[k];
        const resolved = Array.isArray(raw)
          ? raw.map((item) => resolveValue(item)).filter(Boolean).join(", ")
          : resolveValue(raw);
        const value = CITIZEN_DERIVED_KEYS.has(k) ? maskIfConfidential(resolved) : resolved;
        row(S(label(k, ROW_LABEL_FALLBACKS[k] || prettifyKey(k))), value);
      });
  }

  if (detailKeys.includes(DESC_KEY) && !isBlank(details[DESC_KEY])) {
    textBlock(S(label(DESC_KEY, ROW_LABEL_FALLBACKS[DESC_KEY])), S(details[DESC_KEY]));
  }

  // --- complainant details ---
  // Mirrors the employee detail card, with the same CCSD-2130 masking. This is
  // the citizen's OWN receipt, so their name/contact is appropriate to print —
  // but a confidential complaint must not carry the complainant's identity onto
  // a document that can be forwarded.
  const complainantRows = [
    [label("COMPLAINTS_COMPLAINANT_NAME", RECEIPT_FALLBACKS.complainantName), maskIfConfidential(service?.citizen?.name)],
    [label("COMPLAINTS_COMPLAINANT_CONTACT_NUMBER", RECEIPT_FALLBACKS.complainantContact), maskIfConfidential(service?.citizen?.mobileNumber)],
  ].filter(([, v]) => S(v));
  if (complainantRows.length) {
    heading(label("ES_CREATECOMPLAINT_PROVIDE_COMPLAINANT_DETAILS", RECEIPT_FALLBACKS.complainantTitle));
    complainantRows.forEach(([l, v]) => row(S(l), S(v)));
  }

  // --- additional information (extended attributes; already masked by backend) ---
  if (Array.isArray(extendedRows) && extendedRows.length > 0) {
    heading(label("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS", ROW_LABEL_FALLBACKS.CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS));
    extendedRows.forEach((r) => row(S(r?.label), S(r?.value)));
  }

  // --- watermark + footer on every page ---
  // Second pass: the page total is only known once the content has flowed.
  const total = doc.getNumberOfPages();

  // Faint centred crest behind the content. Drawn at low alpha via a graphics
  // state so it tints rather than obscures; any failure (no logo, no GState
  // support, undecodable image) simply skips it — a watermark must never cost
  // the citizen their receipt.
  if (logoDataUri && typeof doc.setGState === "function" && typeof doc.GState === "function") {
    const WM = 110;
    const wmX = (PAGE_W - WM) / 2;
    const wmY = (297 - WM) / 2;
    for (let p = 1; p <= total; p++) {
      try {
        doc.setPage(p);
        doc.setGState(new doc.GState({ opacity: 0.06 }));
        doc.addImage(logoDataUri, wmX, wmY, WM, WM, `wm${p}`, "FAST");
        doc.setGState(new doc.GState({ opacity: 1 }));
      } catch (e) {
        try {
          doc.setGState(new doc.GState({ opacity: 1 }));
        } catch (e2) {
          /* nothing further to restore */
        }
        break;
      }
    }
  }

  const note = S(label("PGR_RECEIPT_SYSTEM_GENERATED", RECEIPT_FALLBACKS.systemGenerated));
  const stamp = S(generatedOn);
  const footerLeft = stamp
    ? `${note}  ${S(label("PGR_RECEIPT_GENERATED_ON", RECEIPT_FALLBACKS.generatedOn))}: ${stamp}`
    : note;
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    rule(FOOTER_RULE_Y);
    const lines = wrap(footerLeft, 150, 8, "normal").slice(0, 1);
    setFont(8, "normal", COLOR.muted);
    if (lines.length) doc.text(lines[0], MARGIN_L, FOOTER_RULE_Y + 4.5);
    // Numeric form is locale-neutral, so it needs no key.
    doc.text(`${p} / ${total}`, CONTENT_X1, FOOTER_RULE_Y + 4.5, { align: "right" });
  }

  return doc;
};

/** Build and save the receipt. Returns true on success. */
export const downloadComplaintReceipt = (model) => {
  const doc = buildComplaintReceipt(model);
  const id = S(model?.service?.serviceRequestId) || "complaint";
  doc.save(`${id}.pdf`);
  return true;
};
