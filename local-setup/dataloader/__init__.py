"""DIGIT/PGR tenant bootstrap dataloader.

The loaders do not import this package by name. Every consumer puts THIS
directory on `sys.path` and imports the modules directly:

    sys.path.insert(0, "<...>/dataloader")
    from crs_loader import CRSLoader

That is how `local-setup/scripts/*.py` reach it in the repo, and how the copies
under `/opt/digit/ci-tests/scripts/` reach the library Ansible rsyncs to
`/opt/digit/ci-tests/dataloader/` — they resolve it as `SCRIPT_DIR/../dataloader`,
which is why the two must stay siblings.

Third-party dependencies are pinned in `requirements.txt` next to this file.
"""
