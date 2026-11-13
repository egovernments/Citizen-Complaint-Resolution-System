"""Secret detection, redaction for analysis output, and three-way restoration.

Analysis output (the candidate, the merge workspace) must be safe to hand to
someone else, so every secret-looking value is replaced by ``<REDACTED>``.  At
deployment the markers are filled back in from the unredacted trees on the
server:

* ``base``   — what the deployed version rendered,
* ``live``   — what /opt/digit holds (verified equal to the analysed backup),
* ``target`` — what the new version renders.

Each hidden value is decided like a merged line: equal sides agree; a side
still equal to base did not change it, so the other side wins; when live and
target both changed it, live is kept and the conflict is reported.

Values are identified the same way here and in the analysis' secret findings:
by structural path in JSON and YAML (list elements by their id/name-like key,
not by position), and by ``KEY#n`` in other text.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator

REDACTED = "<REDACTED>"
_SECRET_WORD = re.compile(r"(?i)password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|unseal")
# Keys that name where a secret lives or whether it is used, not the secret.
_NOT_A_VALUE = ("_enabled", "_file", "_host", "_id", "_name", "_path", "_type", "_url")
# `key: value` / `key=value`, optionally as a YAML list item.
ASSIGNMENT = re.compile(r"^(?P<prefix>\s*(?:-\s+)?(?P<key>[A-Za-z0-9_.-]+)\s*[:=]\s*)(?P<value>.*?)\s*$")
_BLOCK_SCALAR = re.compile(r"[|>][-+0-9]*")
SOURCE_CODE_SUFFIXES = {".go", ".java", ".js", ".php", ".py", ".rb", ".rs", ".ts", ".tsx"}
STRUCTURED_SUFFIXES = {".json", ".yml", ".yaml"}
_PLACEHOLDERS = {"<redacted>", "true", "false", "null", "none", "changeme"}
# Keys that identify a list element (a Keycloak client, a Kong route, ...).
_ELEMENT_KEYS = ("id", "clientId", "name", "code", "key", "alias", "username", "realm")


def suffix_of(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    return "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""


def is_secret_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return bool(_SECRET_WORD.search(normalized)) and not normalized.endswith(_NOT_A_VALUE)


def is_secret_value(value: str) -> bool:
    """Long enough to be a real secret, and not a placeholder, expression or code."""
    normalized = value.strip().strip("'\"").strip()
    return (
        len(normalized) >= 6
        and normalized.lower() not in _PLACEHOLDERS
        and not normalized.startswith(("${", "{{", "$("))
        and not re.search(r"\s|[();]", normalized)
        and not re.fullmatch(r"[A-Z][A-Z0-9_]*", normalized)  # a constant's name
    )


def _assignment_value(raw: str, suffix: str) -> str | None:
    """The literal value of an assignment, or None for source-code expressions."""
    if suffix in SOURCE_CODE_SUFFIXES:
        literal = re.fullmatch(r"(['\"])(.*)\1[,;]?", raw)
        return literal.group(2) if literal else None
    return raw.strip().strip("'\"")


def parse_structured(text: str, suffix: str) -> Any:
    """Parsed JSON/YAML, or None for other files and files that do not parse (Jinja)."""
    try:
        if suffix == ".json":
            return json.loads(text)
        if suffix in {".yml", ".yaml"}:
            import yaml

            return yaml.safe_load(text)
    except Exception:
        return None
    return None


def _element_ids(items: list[Any]) -> list[str]:
    """Stable ids for list elements: by an identifying key when every element has a unique one."""
    ids = []
    for index, item in enumerate(items):
        key = next(
            (k for k in _ELEMENT_KEYS if isinstance(item, dict) and isinstance(item.get(k), (str, int))
             and REDACTED not in str(item[k])),
            None,
        )
        ids.append(f"[{key}={item[key]}]" if key else f"[{index}]")
    return ids if len(set(ids)) == len(ids) else [f"[{i}]" for i in range(len(items))]


def leaves(value: Any, path: str = "$", key: str = "") -> Iterator[tuple[str, str, Any]]:
    """(path, key, value) for every scalar, in document order."""
    if isinstance(value, dict):
        for child_key, child in value.items():
            yield from leaves(child, f"{path}.{child_key}", str(child_key))
    elif isinstance(value, list):
        for element_id, child in zip(_element_ids(value), value):
            yield from leaves(child, path + element_id, key)
    else:
        yield path, key, value


def secret_fields(text: str, suffix: str) -> dict[str, str]:
    """{field id: value} for every secret-looking field of one file."""
    parsed = parse_structured(text, suffix)
    if isinstance(parsed, (dict, list)):
        return {
            path: str(value) for path, key, value in leaves(parsed)
            if is_secret_key(key) and isinstance(value, (str, int, float)) and not isinstance(value, bool)
        }
    found: dict[str, str] = {}
    seen: dict[str, int] = {}
    for line in text.splitlines():
        match = ASSIGNMENT.match(line)
        if not match or not is_secret_key(match.group("key")):
            continue
        key = match.group("key")
        seen[key] = seen.get(key, 0) + 1
        value = _assignment_value(match.group("value"), suffix)
        if value is not None:
            found[f"{key}#{seen[key]}"] = value
    return found


def secret_values(fields: Iterable[str]) -> set[str]:
    return {value for value in fields if is_secret_value(value)}


def values_in_structure(value: Any) -> set[str]:
    """Secret values held by secret-named keys of a parsed tenant YAML."""
    return {
        str(leaf) for _, key, leaf in leaves(value)
        if is_secret_key(key) and isinstance(leaf, (str, int, float)) and is_secret_value(str(leaf))
    }


def redact_structure(value: Any, key: str = "") -> Any:
    if isinstance(value, dict):
        return {k: redact_structure(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_structure(v, key) for v in value]
    return REDACTED if is_secret_key(key) else value


class Redactor:
    """Redacts text with a fixed set of known secret values."""

    def __init__(self, known_values: Iterable[str]) -> None:
        # Longest first, so a value containing another is replaced whole.
        self.values = sorted({v for v in known_values if v}, key=len, reverse=True)

    def _replace_known(self, text: str) -> str:
        for value in self.values:
            text = text.replace(value, REDACTED)
        return text

    def redact(self, text: str, suffix: str) -> str:
        if suffix == ".json":
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                pass
            else:
                # Canonical form, so formatting never differs between trees.
                return json.dumps(self._json(parsed), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        out: list[str] = []
        block_indent: int | None = None  # inside a secret block scalar indented deeper than this
        block_marked = False
        for line in text.splitlines(keepends=True):
            body = line.rstrip("\r\n")
            ending = line[len(body):]
            if block_indent is not None:
                indent = len(body) - len(body.lstrip())
                if not body.strip() or indent > block_indent:
                    # The whole block becomes one marker line at its indentation.
                    if body.strip() and not block_marked:
                        out.append(" " * indent + REDACTED + ending)
                        block_marked = True
                    continue
                block_indent = None
            match = ASSIGNMENT.match(body)
            if match and is_secret_key(match.group("key")):
                value = match.group("value")
                if suffix in {".yml", ".yaml"} and _BLOCK_SCALAR.fullmatch(value):
                    block_indent, block_marked = len(body) - len(body.lstrip()), False
                    out.append(line)
                    continue
                if value not in ("", REDACTED) and _assignment_value(value, suffix) is not None:
                    body = match.group("prefix") + REDACTED
            out.append(self._replace_known(body) + ending)
        return "".join(out)

    def _json(self, value: Any, key: str = "") -> Any:
        if isinstance(value, dict):
            return {str(k): self._json(v, str(k)) for k, v in value.items()}
        if isinstance(value, list):
            return [self._json(v, key) for v in value]
        if is_secret_key(key) and value is not None and not isinstance(value, bool):
            return REDACTED
        if isinstance(value, str):
            return self._replace_known(value)
        return value


# ── secret findings (analysis) ──────────────────────────────────────────────


def fingerprint_fields(texts: dict[str, tuple[str, str]], key: bytes) -> dict[str, dict[str, str | None]]:
    """{path: {field: HMAC(value) or None}} for {path: (text, suffix)}.

    The HMAC key lives only in memory for one run, so nothing persisted can be
    used to test guesses of a secret.  None marks a placeholder, not a secret.
    """
    return {
        path: {
            name: hmac.new(key, value.encode(), hashlib.sha256).hexdigest() if is_secret_value(value) else None
            for name, value in secret_fields(text, suffix).items()
        }
        for path, (text, suffix) in texts.items()
    }


def compare_secret_fields(base: dict, live: dict, target: dict) -> dict[str, Any]:
    """Classify every secret field the backup changed relative to the base render."""
    findings = []
    for path, name in sorted({(p, f) for tree in (base, live, target) for p, fs in tree.items() for f in fs}):
        old, local, new = (tree.get(path, {}).get(name, "absent") for tree in (base, live, target))
        if local in (old, new):
            continue
        if old == new:
            findings.append({"path": path, "field": name, "change": "local-only", "severity": "warning"})
        else:
            findings.append({"path": path, "field": name, "change": "both-changed", "severity": "blocker"})
    return {
        "findings": findings,
        "warning_count": sum(f["severity"] == "warning" for f in findings),
        "blocker_count": sum(f["severity"] == "blocker" for f in findings),
    }


# ── three-way restoration (deployment) ──────────────────────────────────────


class RestoreError(ValueError):
    """A marker cannot be filled in unambiguously."""


@dataclass
class Sources:
    """Unredacted text of one path in each tree; None where the tree lacks the file."""

    base: str | None
    live: str | None
    target: str | None
    redactor: Redactor
    conflicts: list[str] = field(default_factory=list)

    def trees(self) -> dict[str, str]:
        return {n: t for n, t in (("base", self.base), ("live", self.live), ("target", self.target)) if t is not None}

    def choose(self, values: dict[str, Any], where: str) -> Any:
        """Merge-style choice among the values each tree holds (missing = the tree has none)."""
        missing = object()
        base, live, target = (values.get(name, missing) for name in ("base", "live", "target"))
        if live is missing and target is missing:
            raise RestoreError(f"{where}: neither live nor target holds a value for this marker")
        if target is missing or live == target:
            return live
        if live is missing or live == base:
            return target
        if target == base:
            return live
        self.conflicts.append(where)
        return live


def restore(candidate: str, path: str, sources: Sources) -> str:
    """Fill every REDACTED marker in candidate from the three unredacted trees."""
    if REDACTED not in candidate:
        return candidate
    suffix = suffix_of(path)
    if suffix in STRUCTURED_SUFFIXES:
        parsed = parse_structured(candidate, suffix)
        if isinstance(parsed, (dict, list)):
            fills = _structured_fills(parsed, path, suffix, sources)
            if suffix == ".json":
                return json.dumps(_fill_json(parsed, fills), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
            # Markers in comments are not in the structure; those go line by line.
            commented = _restore_lines(candidate, path, sources, only=lambda body: body.lstrip().startswith("#"))
            return _fill_text(commented, fills, path)
    try:
        return _restore_lines(candidate, path, sources)
    except RestoreError:
        whole = _restore_whole(candidate, path, sources)  # a multi-line value outside YAML
        if whole is None:
            raise
        return whole


def _structured_fills(parsed: Any, path: str, suffix: str, sources: Sources) -> list[tuple[Any, bool]]:
    """[(fill, whole)] for every marker, in document order: the whole value of a
    marker standing for a scalar, or the text of one marker inside a string."""
    trees = {}
    for name, text in sources.trees().items():
        value = parse_structured(text, suffix)
        if isinstance(value, (dict, list)):
            trees[name] = {p: v for p, _, v in leaves(value)}
    fills: list[tuple[Any, bool]] = []
    for field_path, _, value in leaves(parsed):
        if not (isinstance(value, str) and REDACTED in value):
            continue
        where = f"{path} {field_path}"
        held = {name: leaves_[field_path] for name, leaves_ in trees.items() if field_path in leaves_}
        if value.strip() == REDACTED:
            fills.append((sources.choose(held, where), True))
            continue
        pattern = _template(value)
        matched = {n: m.groups() for n, v in held.items() if isinstance(v, str) and (m := pattern.fullmatch(v))}
        fills += [(part, False) for part in sources.choose(matched, where)]
    return fills


def _fill_json(value: Any, fills: list[tuple[Any, bool]]) -> Any:
    queue = iter(fills)

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, str) and REDACTED in node:
            if node == REDACTED:
                return next(queue)[0]
            parts = node.split(REDACTED)
            return parts[0] + "".join(str(next(queue)[0]) + part for part in parts[1:])
        return node

    return walk(value)


def _fill_text(candidate: str, fills: list[tuple[Any, bool]], path: str) -> str:
    """Put fills into the YAML text marker by marker, keeping its formatting."""
    parts = candidate.split(REDACTED)
    if len(parts) - 1 != len(fills):
        raise RestoreError(f"{path}: {len(parts) - 1} markers in the text but {len(fills)} in its structure")
    out = [parts[0]]
    for (fill, whole), after in zip(fills, parts[1:]):
        indent = out[-1][out[-1].rfind("\n") + 1:]
        if whole and isinstance(fill, str) and "\n" in fill.rstrip("\n") and not indent.strip():
            # A block scalar's marker line: one line per value line, same indentation.
            lines = fill.rstrip("\n").split("\n")
            text = lines[0] + "".join("\n" + (indent + line if line else "") for line in lines[1:])
        elif whole:
            text = _yaml_scalar(fill)
        else:
            text = str(fill)
        out.append(text + after)
    return "".join(out)


def _yaml_scalar(value: Any) -> str:
    """The value as it was if written plain reads back the same; otherwise JSON-quoted (valid YAML)."""
    import yaml

    plain = str(value)
    try:
        if yaml.safe_load(f"k: {plain}") == {"k": value}:
            return plain
    except yaml.YAMLError:
        pass
    return json.dumps(value, ensure_ascii=False)


def _template(redacted: str, multiline: bool = True) -> re.Pattern[str]:
    wildcard = "(.*?)" if multiline else "([^\r\n]*?)"
    return re.compile("\\A" + wildcard.join(re.escape(part) for part in redacted.split(REDACTED)) + "\\Z", re.S)


def _restore_lines(candidate: str, path: str, sources: Sources, only=lambda body: True) -> str:
    lines = candidate.splitlines(keepends=True)
    tree_lines = {name: text.splitlines() for name, text in sources.trees().items()}
    out = []
    for index, line in enumerate(lines):
        body = line.rstrip("\r\n")
        if REDACTED not in body or not only(body):
            out.append(line)
            continue
        where = f"{path}:{index + 1}"
        pattern = _template(body, multiline=False)
        context = (_strip(lines, index - 1), _strip(lines, index + 1))
        values: dict[str, Any] = {}
        for name, source in tree_lines.items():
            hits = [i for i, text in enumerate(source) if pattern.fullmatch(text)]
            if len({source[i] for i in hits}) > 1:
                # The same line more than once: keep the occurrences whose
                # neighbours look most like the candidate's.
                scores = {i: _similarity(source, i, context, sources.redactor) for i in hits}
                hits = [i for i in hits if scores[i] == max(scores.values())]
            if len({source[i] for i in hits}) > 1:
                raise RestoreError(f"{where}: more than one {name} line matches the redacted line")
            if hits:
                values[name] = pattern.fullmatch(source[hits[0]]).groups()
        chosen = sources.choose(values, where)
        parts = body.split(REDACTED)
        out.append(parts[0] + "".join(value + part for value, part in zip(chosen, parts[1:])) + line[len(body):])
    return "".join(out)


def _restore_whole(candidate: str, path: str, sources: Sources) -> str | None:
    pattern = _template(candidate)
    values = {name: m.groups() for name, text in sources.trees().items() if (m := pattern.fullmatch(text))}
    if not values.keys() & {"live", "target"}:
        return None
    chosen = sources.choose(values, path)
    parts = candidate.split(REDACTED)
    return parts[0] + "".join(value + part for value, part in zip(chosen, parts[1:]))


def _strip(lines: list[str], index: int) -> str | None:
    return lines[index].rstrip("\r\n") if 0 <= index < len(lines) else None


def _similarity(source: list[str], index: int, context: tuple[str | None, str | None], redactor: Redactor) -> int:
    """How many of a line's two neighbours match the candidate's, once redacted alike."""
    def at(i: int) -> str | None:
        return redactor.redact(source[i], "") if 0 <= i < len(source) else None

    return (at(index - 1) == context[0]) + (at(index + 1) == context[1])
