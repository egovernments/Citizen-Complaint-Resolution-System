"""Derive a mobile number that satisfies a country's mobileNumberRegex.

Mirrors digit-mcp's deriveValidMobile() (digit-mcp/src/tools/mdms-tenant.ts)
so tasks that talk to egov-user directly (bypassing MCP's own derivation,
e.g. the HRMS INTERNAL_USER seed) can derive length + allowed leading
digits from mobileNumberRegex instead of requiring them as separate
host_vars fields.
"""
import re


def _seeded_digit_order(seed):
    """Rotate '0123456789' to start at seed's leading digit.

    Two callers deriving a fallback mobile number for the same regex with
    different `preferred` values (e.g. INTERNAL_USER's '9999999999' vs
    ADMIN's '8888888888') should diverge instead of both walking the
    exhaustive lead x fill sweep in the same 0..9 order and returning the
    same first match. Seeding the order from `preferred` makes them diverge
    whenever the regex admits more than one lead/fill combination at a given
    length; regexes with a fixed multi-character literal prefix (e.g.
    '^77[0-9]{6}$') admit exactly one combination regardless of search
    order, so those still collide.
    """
    digits = "0123456789"
    if not seed or seed[0] not in digits:
        return digits
    i = digits.index(seed[0])
    return digits[i:] + digits[:i]


def derive_valid_mobile(regex, length=10, preferred=None):
    try:
        compiled = re.compile(regex) if regex else None
    except re.error:
        compiled = None

    def matches(candidate):
        if not candidate:
            return False
        return compiled.match(candidate) is not None if compiled else True

    if matches(preferred):
        return preferred

    n = length if length and length > 0 else 10
    # Search a wide window around n, closest lengths first, so a tenant whose
    # mobileNumberRegex requires a length far from the hinted default (e.g. 7
    # or 12 digits) still derives a match instead of exhausting n-1/n/n+1 and
    # falling through to an unmatched placeholder.
    lengths = sorted(set(range(6, 16)) | {n, n + 1, n - 1}, key=lambda x: abs(x - n))

    # If the caller's preferred number didn't match outright, first retry
    # candidates that keep its fill digit (e.g. '9' for '9999999999', '8' for
    # '8888888888') and only vary the lead digit. Two callers seeding
    # different usernames with different `preferred` values (INTERNAL_USER
    # vs ADMIN) must not collide on the same derived mobile number just
    # because both preferred values failed the regex and fell through to an
    # identical lead x fill sweep below.
    digit_order = _seeded_digit_order(preferred)

    preferred_fill = preferred[-1] if preferred else None
    if preferred_fill:
        for try_len in lengths:
            if try_len <= 0:
                continue
            for lead in digit_order:
                candidate = lead + preferred_fill * (try_len - 1)
                if len(candidate) == try_len and matches(candidate):
                    return candidate

    for try_len in lengths:
        if try_len <= 0:
            continue
        for lead in digit_order:
            for fill in digit_order:
                candidate = lead + fill * (try_len - 1)
                if len(candidate) == try_len and matches(candidate):
                    return candidate

    # preferred already failed matches() above -- never return a value known
    # not to satisfy the regex; fall back to a length-only placeholder.
    return "9" * n


class FilterModule(object):
    def filters(self):
        return {"derive_valid_mobile": derive_valid_mobile}
