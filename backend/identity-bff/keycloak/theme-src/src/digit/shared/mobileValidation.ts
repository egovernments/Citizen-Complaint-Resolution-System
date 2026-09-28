/**
 * A port of digit-ui-esbuild/packages/libraries/src/constants/mobileValidation.js
 * (the parts the citizen login uses). The phone step derives its always-visible
 * hint, its max length and its validity check from the tenant's
 * `MobileNumberValidation.mobileNumberRegex`, exactly as SelectMobileNumber.js
 * does, so the text under the field reads the same as in digit-ui.
 */

/** digit-ui's bare-metal fallback when neither MDMS nor globalConfigs has a rule. */
export const DEFAULT_MOBILE_PATTERN = "^[6-9][0-9]{9}$";
export const DEFAULT_MOBILE_PREFIX = "+91";

export type Translate = (key: string, fallback: string) => string;

export function extractAllowedStartingDigits(pattern: string | undefined): string[] | null {
    if (!pattern) return null;
    const s = pattern.replace(/^\^/, "").replace(/\$$/, "");
    let i = 0;
    while (i < s.length) {
        let content: string | null = null;
        let atomEnd: number;
        if (s[i] === "[") {
            const end = s.indexOf("]", i + 1);
            if (end === -1) break;
            content = s.slice(i + 1, end);
            atomEnd = end + 1;
        } else if (s[i] === "\\") {
            atomEnd = i + 2;
        } else {
            content = s[i]!;
            atomEnd = i + 1;
        }
        if (atomEnd < s.length && s[atomEnd] === "?") {
            i = atomEnd + 1;
            continue;
        }
        if (!content) {
            i = atomEnd;
            continue;
        }
        const digits: string[] = [];
        let ci = 0;
        while (ci < content.length) {
            if (ci + 2 < content.length && content[ci + 1] === "-") {
                const from = content.charCodeAt(ci);
                const to = content.charCodeAt(ci + 2);
                for (let code = from; code <= to; code++) digits.push(String.fromCharCode(code));
                ci += 3;
            } else {
                digits.push(content[ci]!);
                ci++;
            }
        }
        const onlyDigits = digits.every(d => /^[0-9]$/.test(d));
        return onlyDigits && digits.length > 0 ? digits : null;
    }
    return null;
}

export function buildMobileErrorMessage(pattern: string | undefined, t?: Translate): string {
    const tr: Translate = typeof t === "function" ? t : (_key, fallback) => fallback;

    const base = tr("ERR_INVALID_MOBILE_NUMBER", "Please enter a valid mobile number");
    if (!pattern) return base;

    const { min, max } = computeMobileLengths(pattern);
    const startDigits = extractAllowedStartingDigits(pattern);

    const digits = tr("MOBILE_VALIDATION_DIGITS", "digits");
    const atLeast = tr("MOBILE_VALIDATION_AT_LEAST", "at least");

    const lenPart =
        min === max ? `${min} ${digits}` : max === -1 ? `${atLeast} ${min} ${digits}` : `${min}-${max} ${digits}`;

    let startPart = "";
    if (startDigits && startDigits.length > 0) {
        const unique = [...new Set(startDigits)];
        const sw = tr("MOBILE_VALIDATION_STARTING_WITH", "starting with");
        startPart = `, ${sw} ${unique.join(", ")}`;
    }

    return `${base} (${lenPart}${startPart})`;
}

function splitAlternation(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "[") {
            const e = s.indexOf("]", i + 1);
            if (e !== -1) i = e;
        } else if (s[i] === "(") depth++;
        else if (s[i] === ")") depth--;
        else if (s[i] === "|" && depth === 0) {
            parts.push(s.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(s.slice(start));
    return parts;
}

function computeFragmentLengths(s: string): { min: number; max: number } {
    let min = 0;
    let max = 0;
    let i = 0;
    while (i < s.length) {
        let atomEnd = i;
        let baseMin = 1;
        let baseMax = 1;

        if (s[i] === "[") {
            const end = s.indexOf("]", i + 1);
            atomEnd = end === -1 ? i + 1 : end + 1;
        } else if (s[i] === "\\") {
            atomEnd = i + 2;
        } else if (s[i] === "(") {
            let depth = 1;
            atomEnd = i + 1;
            while (atomEnd < s.length && depth > 0) {
                if (s[atomEnd] === "(") depth++;
                else if (s[atomEnd] === ")") depth--;
                atomEnd++;
            }
            let inner = s.slice(i + 1, atomEnd - 1);
            if (/^\?[=!]/.test(inner) || /^\?<[=!]/.test(inner)) {
                baseMin = 0;
                baseMax = 0;
            } else {
                if (inner.startsWith("?:")) inner = inner.slice(2);
                else if (inner.startsWith("?")) inner = inner.slice(1);
                const alts = splitAlternation(inner);
                if (alts.length > 1) {
                    const lens = alts.map(computeFragmentLengths);
                    baseMin = Math.min(...lens.map(l => l.min));
                    const maxes = lens.map(l => l.max);
                    baseMax = maxes.includes(-1) ? Infinity : Math.max(...maxes);
                } else {
                    const g = computeFragmentLengths(inner);
                    baseMin = g.min;
                    baseMax = g.max === -1 ? Infinity : g.max;
                }
            }
        } else {
            atomEnd = i + 1;
        }

        let repMin = 1;
        let repMax = 1;
        let qi = atomEnd;
        if (qi < s.length) {
            if (s[qi] === "?") {
                repMin = 0;
                repMax = 1;
                qi++;
            } else if (s[qi] === "*") {
                repMin = 0;
                repMax = Infinity;
                qi++;
            } else if (s[qi] === "+") {
                repMin = 1;
                repMax = Infinity;
                qi++;
            } else if (s[qi] === "{") {
                const end = s.indexOf("}", qi);
                if (end !== -1) {
                    const parts = s.slice(qi + 1, end).split(",");
                    repMin = parseInt(parts[0]!, 10) || 0;
                    repMax = parts.length > 1 ? (parts[1]!.trim() ? parseInt(parts[1]!, 10) : Infinity) : repMin;
                    qi = end + 1;
                }
            }
        }

        min += baseMin * repMin;
        max += baseMax === Infinity || repMax === Infinity ? Infinity : baseMax * repMax;
        i = qi;
    }
    return { min, max: isFinite(max) ? max : -1 };
}

export function computeMobileLengths(pattern: string | undefined): { min: number; max: number } {
    if (!pattern) return { min: 0, max: -1 };
    const s = pattern.replace(/^\^/, "").replace(/\$$/, "");
    return computeFragmentLengths(s);
}
