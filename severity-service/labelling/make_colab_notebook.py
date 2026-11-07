"""Generate colab_llm_labelling.ipynb from the real rubric prompt and llm_label.py.

    python labelling/make_colab_notebook.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def md(t):
    return {"cell_type": "markdown", "metadata": {}, "source": t.strip("\n").splitlines(True)}


def code(t):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
            "source": t.strip("\n").splitlines(True)}


system = (HERE / "prompts" / "system.md").read_text("utf-8")
script = (HERE / "llm_label.py").read_text("utf-8")
version = (HERE / "prompts" / "VERSION").read_text("utf-8").strip()
FILES = {"prompts/system.md": system, "llm_label.py": script}

FILES_CELL = "import json\nFILES = json.loads(" + repr(json.dumps(FILES, ensure_ascii=False)) + ")"

SETUP = r'''
import os, sys, subprocess
from pathlib import Path
from getpass import getpass

IN_COLAB = "COLAB_RELEASE_TAG" in os.environ or "google.colab" in sys.modules

PROVIDER = "gemini"          # "gemini" or "groq": which free API labels the remaining rows
RUN_ARGS = (["--provider", "groq", "--model", "openai/gpt-oss-120b", "--batch-size", "30", "--rpm", "1"]
            if PROVIDER == "groq" else ["--provider", "gemini", "--model", "gemini-3.1-flash-lite", "--batch-size", "100"])
KEYNAME = "GROQ_API_KEY" if PROVIDER == "groq" else "GEMINI_API_KEY"

if IN_COLAB:
    LAB = Path("/content/labelling")
    for rel, text in FILES.items():                       # write script + prompt from this notebook
        p = LAB / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")
    try:
        from google.colab import userdata
        key = userdata.get(KEYNAME)
    except Exception:
        key = getpass(f"Paste your {KEYNAME}: ")
    os.environ[KEYNAME] = key.strip()
    DATA = Path("/content/complaints_description_only_cleaned.csv")
    if not DATA.exists():
        from google.colab import files
        print("Upload data/complaints_description_only_cleaned.csv from the repo")
        up = files.upload()
        DATA.write_bytes(next(iter(up.values())))
    OUT = Path("/content/output")
    OUT.mkdir(parents=True, exist_ok=True)
    if not (OUT / "llm_labels.csv").exists():             # continue from labels already made
        from google.colab import files
        print("Upload your existing labelling/output/llm_labels.csv to continue (Cancel / skip to start fresh)")
        up = files.upload()
        if up:
            (OUT / "llm_labels.csv").write_bytes(next(iter(up.values())))
else:                                                      # local: use the repo files as they are
    here = Path.cwd().resolve()
    LAB = next(q for q in [here, *here.parents] if (q / "llm_label.py").exists() or (q / "labelling" / "llm_label.py").exists())
    LAB = LAB if (LAB / "llm_label.py").exists() else LAB / "labelling"
    for name in ("complaints_description_only_cleaned.latest.csv", "complaints_description_only_cleaned.csv"):
        DATA = LAB.parent / "data" / name
        if DATA.exists():
            break
    OUT = LAB / "output"                                   # key is read from labelling/.env by the script
OUT.mkdir(parents=True, exist_ok=True)
SCRIPT = LAB / "llm_label.py"


def label(*args):
    """Run llm_label.py and stream its output."""
    p = subprocess.Popen([sys.executable, str(SCRIPT), "--input", str(DATA), *map(str, args)],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    for line in p.stdout:
        print(line, end="")
    p.wait()


print("Colab" if IN_COLAB else "Local", "| script:", SCRIPT, "| data:", DATA)
'''

cells = [
    md(f"""
# Severity labelling with an LLM (Gemini free tier)
Labels the ~58,640 cleaned citizen complaints as **Low / Medium / High / Critical** using the written rubric (v{version}), in resumable batches.

Works in two places, no Google Drive needed:
- **Locally in VS Code** (choose your normal Python kernel): uses the repo's own `labelling/` files and `data/` CSV. Put your key in `labelling/.env`.
- **On Google Colab**: the setup cell writes the script and prompt for you; you upload the CSV and paste the key when asked.
"""),
    code(FILES_CELL),
    code(SETUP),
    code('''
import pandas as pd
df = pd.read_csv(DATA)
print(len(df), "complaints")
df.label.value_counts()
'''),
    md("## Pilot: label a random 500 and compare with the existing labels"),
    code('label("--sample", 500, "--output", OUT / "pilot_random500.csv")'),
    code('''
import matplotlib.pyplot as plt
order = ["Low", "Medium", "High", "Critical"]
p = pd.read_csv(OUT / "pilot_random500.csv").merge(df, on="complaint_id")
print("Exact agreement with existing labels:", round((p.label == p.llm_label).mean(), 3))
print("Marked unclear:", round(p.unclear.mean(), 3))
ct = pd.crosstab(p.label, p.llm_label).reindex(index=order, columns=order, fill_value=0)
display(ct.rename_axis("existing label (rows) vs LLM label (columns)"))
ax = ct.plot(kind="bar", stacked=True, figsize=(7, 4), title="LLM label by existing label")
ax.set_xlabel("existing label"); plt.tight_layout(); plt.show()
'''),
    code('''
# Read some disagreements: which one looks right?
pd.set_option("display.max_colwidth", 140)
p[p.label != p.llm_label][["description", "label", "llm_label", "reason"]].sample(15, random_state=1)
'''),
    md("## Full run\nSaved after every batch. If the free daily quota runs out it stops cleanly; **re-run this cell later and it resumes**."),
    code('label("--output", OUT / "llm_labels.csv", *RUN_ARGS)'),
    md("## Results"),
    code('''
res = pd.read_csv(OUT / "llm_labels.csv").merge(df, on="complaint_id")
print(len(res), "of", len(df), "labelled")
print("Exact agreement with existing labels:", round((res.label == res.llm_label).mean(), 3))
display(res.llm_label.value_counts().reindex(order))
display(pd.crosstab(res.label, res.llm_label).reindex(index=order, columns=order, fill_value=0))
'''),
    code('''
print("Results file:", OUT / "llm_labels.csv")
if IN_COLAB:
    from google.colab import files
    files.download(str(OUT / "llm_labels.csv"))   # Colab disk is wiped at session end: download it
'''),
]
nb = {"cells": cells,
      "metadata": {"colab": {"provenance": []}, "kernelspec": {"name": "python3", "display_name": "Python 3"}},
      "nbformat": 4, "nbformat_minor": 5}
(HERE / "colab_llm_labelling.ipynb").write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", "utf-8", newline="\n")
print("wrote colab_llm_labelling.ipynb")
