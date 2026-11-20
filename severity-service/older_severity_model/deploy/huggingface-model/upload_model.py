"""Upload the severity model files to a Hugging Face *model* repo (not a Space).

    HF_TOKEN=hf_xxx python deploy/huggingface-model/upload_model.py <user-or-org>/<repo-name> [--public]

Creates the repo (PRIVATE unless --public) if needed and uploads: catboost_pgr.cbm, label_map.json,
ctype_values.json, preprocess.py and a model card as README.md. Re-run to push a new version.
Needs `pip install huggingface_hub` (already present with sentence-transformers).
"""
import os
import sys
import tempfile
import shutil
from pathlib import Path

from huggingface_hub import HfApi

HERE = Path(__file__).resolve().parent
SVC = HERE.parent.parent


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1 or "/" not in args[0]:
        sys.exit(__doc__)
    repo_id, private = args[0], "--public" not in sys.argv
    token = os.environ.get("HF_TOKEN") or sys.exit("Set HF_TOKEN to a Hugging Face token with write access")

    files = {
        "catboost_pgr.cbm": SVC / "model" / "catboost_pgr.cbm",
        "label_map.json": SVC / "model" / "label_map.json",
        "ctype_values.json": SVC / "model" / "ctype_values.json",
        "preprocess.py": SVC / "app" / "preprocess.py",
        "README.md": HERE / "MODEL_CARD.md",
    }
    missing = [n for n, p in files.items() if not p.exists()]
    if missing:
        sys.exit(f"Missing files: {missing}")

    api = HfApi(token=token)
    api.create_repo(repo_id, repo_type="model", private=private, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, src in files.items():
            shutil.copyfile(src, Path(tmp) / name)
        api.upload_folder(repo_id=repo_id, repo_type="model", folder_path=tmp,
                          commit_message="Upload severity model")
    print(f"Done: https://huggingface.co/{repo_id} ({'private' if private else 'public'})")


if __name__ == "__main__":
    main()
