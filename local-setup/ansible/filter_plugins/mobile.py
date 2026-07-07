"""Derive a mobile number that satisfies a country's mobileNumberRegex.

Mirrors digit-mcp's deriveValidMobile() (digit-mcp/src/tools/mdms-tenant.ts)
so tasks that talk to egov-user directly (bypassing MCP's own derivation,
e.g. the HRMS INTERNAL_USER seed) can derive length + allowed leading
digits from mobileNumberRegex instead of requiring them as separate
host_vars fields.
"""
import re


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
    for try_len in sorted(set(range(6, 16)) | {n, n + 1, n - 1}, key=lambda x: abs(x - n)):
        if try_len <= 0:
            continue
        for lead in "0123456789":
            for fill in "0123456789":
                candidate = lead + fill * (try_len - 1)
                if len(candidate) == try_len and matches(candidate):
                    return candidate

    # preferred already failed matches() above -- never return a value known
    # not to satisfy the regex; fall back to a length-only placeholder.
    return "9" * n


class FilterModule(object):
    def filters(self):
        return {"derive_valid_mobile": derive_valid_mobile}
