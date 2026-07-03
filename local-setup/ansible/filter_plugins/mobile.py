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
    for try_len in (n, n + 1, n - 1):
        if try_len <= 0:
            continue
        for lead in "0123456789":
            for fill in "0123456789":
                candidate = lead + fill * (try_len - 1)
                if len(candidate) == try_len and matches(candidate):
                    return candidate

    return preferred or ("9" * n)


class FilterModule(object):
    def filters(self):
        return {"derive_valid_mobile": derive_valid_mobile}
