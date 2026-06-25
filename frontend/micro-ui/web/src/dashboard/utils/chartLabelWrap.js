/** Approximate monospace width per character at 10px axis labels. */
export const CHART_LABEL_CHAR_WIDTH_PX = 6.5;
export const CHART_AXIS_LABEL_FONT_SIZE_PX = 10;
export const CHART_AXIS_LABEL_LINE_HEIGHT_PX = 12;

export function wrapChartLabelToLines(
  text,
  maxWidthPx,
  { charWidthPx = CHART_LABEL_CHAR_WIDTH_PX, maxLines = 4 } = {}
) {
  const normalized = String(text ?? "").trim() || "—";
  if (!maxWidthPx || maxWidthPx <= 0) return [normalized];

  const maxCharsPerLine = Math.max(4, Math.floor(maxWidthPx / charWidthPx) - 1);
  if (normalized.length <= maxCharsPerLine) return [normalized];

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const sourceTokens = tokens.length ? tokens : [normalized];
  const lines = [];

  const pushLine = (line) => {
    if (line) lines.push(line);
  };

  const splitLongToken = (token) => {
    let rest = token;
    while (rest.length > maxCharsPerLine && lines.length < maxLines) {
      pushLine(rest.slice(0, maxCharsPerLine));
      rest = rest.slice(maxCharsPerLine);
    }
    return rest;
  };

  let current = "";

  for (const rawToken of sourceTokens) {
    if (lines.length >= maxLines) break;

    let token = rawToken;
    if (token.length > maxCharsPerLine) {
      if (current) {
        pushLine(current);
        current = "";
        if (lines.length >= maxLines) break;
      }
      token = splitLongToken(token);
      if (!token) continue;
    }

    if (!current) {
      current = token;
      continue;
    }

    const candidate = `${current} ${token}`;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      pushLine(current);
      current = token;
    }
  }

  if (current && lines.length < maxLines) {
    pushLine(current);
  }

  if (!lines.length) {
    return [normalized.slice(0, maxCharsPerLine)];
  }

  return lines.slice(0, maxLines);
}

/** Apex renders string[] as multiline tspans; a single line stays a string. */
export function formatWrappedChartLabel(text, maxWidthPx, options) {
  const lines = wrapChartLabelToLines(text, maxWidthPx, options);
  return lines.length === 1 ? lines[0] : lines;
}

export function estimateMaxWrappedLabelHeight(
  labels,
  maxWidthPx,
  { lineHeightPx = CHART_AXIS_LABEL_LINE_HEIGHT_PX, maxLines = 4 } = {}
) {
  if (!labels?.length) {
    return lineHeightPx + 4;
  }

  const lineCount = Math.max(
    1,
    ...labels.map((label) => wrapChartLabelToLines(label, maxWidthPx, { maxLines }).length)
  );

  return lineCount * lineHeightPx + 4;
}
