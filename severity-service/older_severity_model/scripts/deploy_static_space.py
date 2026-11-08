"""Publish static-space/ to a FREE Hugging Face *Static* Space (no Docker, no Gradio, no server).

    HF_TOKEN=hf_xxx python scripts/deploy_static_space.py <user-or-org>/<space-name> [--private]

Creates the Space (PUBLIC unless --private) and uploads the page, the JS and the exported model.
A PRIVATE static Space does not work: the browser's requests for the page's other files get 401.
If the model changed, regenerate it first:  python scripts/export_static_model.py
Re-run to redeploy. Needs `pip install huggingface_hub`.
"""
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

FOLDER = Path(__file__).resolve().parent.parent / "static-space"


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1 or "/" not in args[0]:
        sys.exit(__doc__)
    repo_id, private = args[0], "--private" in sys.argv
    if private:
        print("WARNING: private static Spaces return 401 for severity.js/model files, so the page will not work.")
    token = os.environ.get("HF_TOKEN") or sys.exit("Set HF_TOKEN to a Hugging Face token with write access")
    for needed in ("index.html", "app.js", "severity.js", "model.json", "model.bin", "README.md"):
        if not (FOLDER / needed).exists():
            sys.exit(f"Missing static-space/{needed} (run scripts/export_static_model.py?)")

    api = HfApi(token=token)
    api.create_repo(repo_id, repo_type="space", space_sdk="static", private=private, exist_ok=True)
    api.upload_folder(repo_id=repo_id, repo_type="space", folder_path=str(FOLDER),
                      ignore_patterns=["test/*", "package.json"], commit_message="Deploy severity static Space")
    user, name = repo_id.split("/", 1)
    print(f"Done: https://huggingface.co/spaces/{repo_id} ({'private' if private else 'public'})")
    print(f"App:  https://{user.lower()}-{name.lower()}.static.hf.space")


if __name__ == "__main__":
    main()
