"""Render prompts/system.md from rubric.json so the two cannot drift.

    python labelling/build_prompt.py          # rewrite prompts/system.md
    python labelling/build_prompt.py --check  # exit 1 if system.md is out of date
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def render(rubric: dict) -> str:
    names = ", ".join(l["label"] for l in sorted(rubric["levels"], key=lambda l: l["id"]))
    out = [
        "You label citizen complaints for a municipal grievance system with a severity level.",
        "",
        f"Levels: {names}.",
        "",
        "Principles:",
        *[f"- {p}" for p in rubric["principles"]],
        "",
        "Apply the levels from most to least severe and stop at the first that matches.",
    ]
    for lv in sorted(rubric["levels"], key=lambda l: -l["id"]):
        out += ["", f"{lv['label']}: {lv['meaning']}", *[f"- {c}" for c in lv["criteria"]]]
    return "\n".join(out) + "\n"


def main() -> int:
    text = render(json.loads((HERE / "rubric.json").read_text("utf-8")))
    target = HERE / "prompts" / "system.md"
    if "--check" in sys.argv:
        ok = target.read_text("utf-8").replace("\r\n", "\n") == text
        print("up to date" if ok else "system.md is out of date; run build_prompt.py")
        return 0 if ok else 1
    target.write_text(text, "utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
