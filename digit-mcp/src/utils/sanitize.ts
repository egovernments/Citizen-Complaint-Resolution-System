/**
 * Response sanitization — neutralize potential prompt injection in user-generated content.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?prior\s+instructions/gi,
  /disregard\s+(all\s+)?previous/gi,
  /system\s*:\s*/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<<\s*SYS\s*>>/gi,
  /<<\s*\/SYS\s*>>/gi,
  /you\s+are\s+now\s+/gi,
  /new\s+instructions?\s*:/gi,
  /override\s+instructions/gi,
  /forget\s+(all\s+)?(your\s+)?instructions/gi,
  /act\s+as\s+if\s+you\s+are\s+a\s+/gi,
  /pretend\s+(you\s+are|to\s+be)\s+/gi,
];

export function sanitizeUserContent(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return '';

  let sanitized = text;
  let modified = false;

  for (const pattern of INJECTION_PATTERNS) {
    const replaced = sanitized.replace(pattern, '[filtered]');
    if (replaced !== sanitized) {
      sanitized = replaced;
      modified = true;
    }
  }

  return modified ? `${sanitized} [sanitized]` : text;
}

export function sanitizeFields<T extends Record<string, unknown>>(
  obj: T,
  fieldNames: string[]
): T {
  const out = { ...obj };
  for (const field of fieldNames) {
    if (typeof out[field] === 'string') {
      (out as Record<string, unknown>)[field] = sanitizeUserContent(out[field] as string);
    }
  }
  return out;
}
